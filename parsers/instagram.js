/**
 * Instagram Data Parser — Time Capsule
 *
 * Parses Instagram data exports and returns unified event objects.
 * Instagram JSON files use two timestamp styles:
 *   - Unix seconds (int):  most activity files + messages thread path
 *   - Unix milliseconds:   messages[].timestamp_ms
 *   - Date strings:        string_map_data "Time" / "Saved on" / "Change date"
 */

const InstagramParser = {
    id: 'instagram',
    label: 'Instagram',
    icon: '📸',
    color: '#E1306C',

    instructions: `
    <ol>
      <li>Open Instagram in a browser and go to <strong>Settings → Account → Download your data</strong></li>
      <li>Select <strong>JSON</strong> format (not HTML)</li>
      <li>Choose <strong>All time</strong> as the date range</li>
      <li>Request the download — Instagram will email you when it's ready (usually within 48 hours)</li>
      <li>Download and unzip the folder</li>
      <li>Select the entire unzipped folder above</li>
    </ol>
  `,

    // ─── Entry point ───────────────────────────────────────────────────────────
    parse(files) {
        const events = [];
        for (const { path, json } of files) {
            const norm = path.replace(/\\/g, '/').toLowerCase();
            try {
                const parsed = this.routeFile(norm, json);
                if (parsed) events.push(...parsed);
            } catch (e) {
                console.warn('[Instagram] Error parsing', path, e);
            }
        }
        return events;
    },

    // ─── Router ────────────────────────────────────────────────────────────────
    routeFile(norm, json) {
        // Comments
        if (norm.includes('comments/post_comments')) return this.parseComments(json);

        // Likes
        if (norm.includes('likes/liked_posts')) return this.parseLikedPosts(json);
        if (norm.includes('likes/liked_comments')) return this.parseLikedComments(json);

        // Story interactions
        if (norm.includes('story_interactions/story_likes')) return this.parseStoryInteraction(json, 'story_activities_story_likes', 'Story liked', '❤️', 'Stories');
        if (norm.includes('story_interactions/polls')) return this.parseStoryInteraction(json, 'story_activities_polls', 'Answered a story poll', '📊', 'Stories');
        if (norm.includes('story_interactions/quizzes')) return this.parseStoryInteraction(json, 'story_activities_quizzes', 'Answered a story quiz', '🎯', 'Stories');
        if (norm.includes('story_interactions/emoji_sliders')) return this.parseStoryInteraction(json, 'story_activities_emoji_sliders', 'Used a story emoji slider', '😄', 'Stories');

        // Saved
        if (norm.includes('saved/saved_posts')) return this.parseSavedPosts(json);

        // Messages — inbox and message_requests, all message_N.json files
        if (norm.includes('/messages/inbox/') && norm.endsWith('.json') && norm.includes('/message_')) {
            return this.parseMessages(json, 'inbox');
        }
        if (norm.includes('/messages/message_requests/') && norm.endsWith('.json') && norm.includes('/message_')) {
            return this.parseMessages(json, 'request');
        }

        // Connections
        if (norm.includes('followers_and_following/following.json')) return this.parseFollowing(json);
        if (norm.includes('followers_and_following/followers_1.json')) return this.parseFollowers(json);
        if (norm.includes('followers_and_following/recently_unfollowed')) return this.parseUnfollowed(json);
        if (norm.includes('followers_and_following/pending_follow_requests')) return this.parsePendingFollowRequests(json);

        // Security
        if (norm.includes('login_and_profile_creation/login_activity')) return this.parseLogins(json);
        if (norm.includes('login_and_profile_creation/logout_activity')) return this.parseLogouts(json);
        if (norm.includes('login_and_profile_creation/password_change')) return this.parsePasswordChanges(json);

        // Searches
        if (norm.includes('recent_searches/word_or_phrase_searches')) return this.parseWordSearches(json);
        if (norm.includes('recent_searches/profile_searches')) return this.parseProfileSearches(json);

        // Link history
        if (norm.includes('link_history/link_history.json')) return this.parseLinkHistory(json);

        // Ads
        if (norm.includes('ads_and_topics/ads_viewed.json')) return this.parseAdsViewed(json);

        // Profile changes
        if (norm.includes('personal_information/profile_changes')) return this.parseProfileChanges(json);

        // Avatar items
        if (norm.includes('avatars_store/avatar_items')) return this.parseAvatarItems(json);

        return null;
    },

    // ─── Helpers ───────────────────────────────────────────────────────────────
    /** Normalise timestamp to Unix seconds */
    toSeconds(ts) {
        if (!ts) return null;
        const n = Number(ts);
        if (isNaN(n)) return null;
        return n > 1e10 ? Math.round(n / 1000) : n;
    },

    /** Parse Instagram "Time" date strings like "2023-05-15 14:30:00 UTC" */
    parseTimeString(str) {
        if (!str) return null;
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
    },

    /** Decode Meta's double-encoded UTF-8 strings */
    decode(str) {
        if (!str || typeof str !== 'string') return str;
        try {
            return decodeURIComponent(escape(str));
        } catch {
            return str;
        }
    },

    /** Build a unified event object */
    makeEvent({ type, icon, title, description = '', timestamp, category, dataInsight = '' }) {
        const ts = this.toSeconds(timestamp);
        if (!ts || ts < 1e8) return null;
        return {
            source: this.id,
            sourceLabel: this.label,
            sourceIcon: this.icon,
            sourceColor: this.color,
            type, icon, category,
            title: this.decode(title),
            description: this.decode(description),
            timestamp: ts,
            date: new Date(ts * 1000),
            dataInsight,
        };
    },

    // ─── Comments ──────────────────────────────────────────────────────────────
    parseComments(json) {
        // Top-level array of comment objects
        const items = Array.isArray(json) ? json : [];
        return items.flatMap(item => {
            const smd = item.string_map_data || {};
            const text = smd['Comment']?.value || '';
            const owner = smd['Media Owner']?.value || 'someone';
            const ts = smd['Time']?.timestamp;
            const e = this.makeEvent({
                type: 'comment', icon: '💬',
                title: `Commented on ${this.decode(owner)}'s post`,
                description: text,
                timestamp: ts,
                category: 'Comments',
                dataInsight: 'Instagram records every comment you make, including exact timestamp, the account you commented on, and the comment text. This data is used to personalise your feed and measure engagement.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Liked posts ───────────────────────────────────────────────────────────
    parseLikedPosts(json) {
        // Top-level array: [{timestamp, label_values: [{label, value, href}]}]
        const items = Array.isArray(json) ? json : [];
        return items.flatMap(item => {
            const ts = item.timestamp;
            const lv = (item.label_values || [])[0] || {};
            const account = lv.value || lv.label || 'a post';
            const e = this.makeEvent({
                type: 'like', icon: '❤️',
                title: `Liked ${this.decode(account)}'s post`,
                timestamp: ts,
                category: 'Likes',
                dataInsight: 'Instagram logs every post you like with a timestamp. This helps them understand your interests and is used to build your advertising profile — every like feeds their recommendation engine.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Liked comments ────────────────────────────────────────────────────────
    parseLikedComments(json) {
        const items = (json.likes_comment_likes || []);
        return items.flatMap(item => {
            const sld = item.string_list_data || [];
            const first = sld[0] || {};
            const ts = first.timestamp;
            const account = item.title || first.value || 'a comment';
            const e = this.makeEvent({
                type: 'comment_like', icon: '👍',
                title: `Liked ${this.decode(account)}'s comment`,
                timestamp: ts,
                category: 'Likes',
            });
            return e ? [e] : [];
        });
    },

    // ─── Story interactions (generic) ─────────────────────────────────────────
    parseStoryInteraction(json, key, titleText, icon, category) {
        const items = (json[key] || []);
        return items.flatMap(item => {
            const sld = item.string_list_data || [];
            const first = sld[0] || {};
            const ts = first.timestamp;
            const account = item.title || first.value || 'someone';
            const e = this.makeEvent({
                type: key, icon,
                title: `${titleText} by ${this.decode(account)}`,
                timestamp: ts,
                category,
                dataInsight: 'Instagram records every story interaction — likes, polls, sliders and quizzes — with timestamps. Poll and quiz responses reveal your opinions and preferences, which are shared with advertisers.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Saved posts ───────────────────────────────────────────────────────────
    parseSavedPosts(json) {
        const items = (json.saved_saved_media || []);
        return items.flatMap(item => {
            const savedOn = item.string_map_data?.['Saved on'];
            const ts = this.parseTimeString(savedOn);
            const account = item.title || 'post';
            const e = this.makeEvent({
                type: 'saved_post', icon: '🔖',
                title: `Saved a post by ${this.decode(account)}`,
                timestamp: ts,
                category: 'Saved',
                dataInsight: 'Everything you save on Instagram is stored and used to refine your interest profile for ad targeting.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Messages ──────────────────────────────────────────────────────────────
    parseMessages(json, type) {
        if (!json.messages || !json.title) return [];
        const threadName = this.decode(json.title);
        const isRequest = type === 'request';

        // Group messages by calendar day so we show one event per day per thread
        const byDay = new Map();
        for (const msg of json.messages) {
            if (!msg.timestamp_ms) continue;
            const ts = Math.round(msg.timestamp_ms / 1000);
            if (ts < 1e8) continue;
            const d = new Date(ts * 1000);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            if (!byDay.has(key) || byDay.get(key).ts > ts) {
                // Keep earliest message of the day for the timestamp (shows morning)
                byDay.set(key, { ts, count: 0, sample: msg.content || '' });
            }
            byDay.get(key).count++;
        }

        return Array.from(byDay.values()).flatMap(({ ts, count, sample }) => {
            const e = this.makeEvent({
                type: isRequest ? 'message_request' : 'message',
                icon: isRequest ? '📨' : '💬',
                title: isRequest
                    ? `Message request from ${threadName}`
                    : `Messaged in "${threadName}"`,
                description: count > 1 ? `${count} messages` : this.decode(sample).slice(0, 80),
                timestamp: ts,
                category: 'Messages',
                dataInsight: 'Instagram stores the full content of your DMs, who you messaged, when, and how often. This data is used to improve features but also reveals your closest relationships.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Following ─────────────────────────────────────────────────────────────
    parseFollowing(json) {
        const items = (json.relationships_following || []);
        return items.flatMap(item => {
            const sld = item.string_list_data || [];
            const first = sld[0] || {};
            const ts = first.timestamp;
            const account = item.title || first.value || 'someone';
            const e = this.makeEvent({
                type: 'follow', icon: '➕',
                title: `Started following ${this.decode(account)}`,
                timestamp: ts,
                category: 'Connections',
                dataInsight: 'Instagram records every account you follow along with the exact timestamp. Your following list reveals your interests, social circles, and content preferences — all valuable for ad targeting.',
            });
            return e ? [e] : [];
        });
    },

    // ─── New followers ─────────────────────────────────────────────────────────
    parseFollowers(json) {
        const items = Array.isArray(json) ? json : [];
        return items.flatMap(item => {
            const sld = item.string_list_data || [];
            const first = sld[0] || {};
            const ts = first.timestamp;
            const account = item.title || first.value || 'someone';
            const e = this.makeEvent({
                type: 'new_follower', icon: '👤',
                title: `${this.decode(account)} followed you`,
                timestamp: ts,
                category: 'Connections',
            });
            return e ? [e] : [];
        });
    },

    // ─── Unfollowed ────────────────────────────────────────────────────────────
    parseUnfollowed(json) {
        const items = (json.relationships_unfollowed_users || []);
        return items.flatMap(item => {
            const sld = item.string_list_data || [];
            const first = sld[0] || {};
            const ts = first.timestamp;
            const account = item.title || first.value || 'someone';
            const e = this.makeEvent({
                type: 'unfollow', icon: '➖',
                title: `Unfollowed ${this.decode(account)}`,
                timestamp: ts,
                category: 'Connections',
            });
            return e ? [e] : [];
        });
    },

    // ─── Pending follow requests ───────────────────────────────────────────────
    parsePendingFollowRequests(json) {
        const items = (json.relationships_follow_requests_sent || []);
        return items.flatMap(item => {
            const sld = item.string_list_data || [];
            const first = sld[0] || {};
            const ts = first.timestamp;
            const account = item.title || first.value || 'someone';
            const e = this.makeEvent({
                type: 'follow_request', icon: '📩',
                title: `Sent follow request to ${this.decode(account)}`,
                timestamp: ts,
                category: 'Connections',
            });
            return e ? [e] : [];
        });
    },

    // ─── Logins ────────────────────────────────────────────────────────────────
    parseLogins(json) {
        const items = (json.account_history_login_history || []);
        return items.flatMap(item => {
            const smd = item.string_map_data || {};
            const ts = this.parseTimeString(smd['Time']);
            const ip = smd['IP address'] || '';
            const ua = smd['User agent'] || '';
            const e = this.makeEvent({
                type: 'login', icon: '🔐',
                title: 'Logged in to Instagram',
                description: ip ? `IP: ${ip}` : '',
                timestamp: ts,
                category: 'Security',
                dataInsight: `Instagram logs every login with your IP address, device user-agent, and the exact time. This data can reveal your location history and which devices you use.${ua ? ` Device: ${ua.slice(0, 60)}` : ''}`,
            });
            return e ? [e] : [];
        });
    },

    // ─── Logouts ───────────────────────────────────────────────────────────────
    parseLogouts(json) {
        const items = (json.account_history_logout_history || []);
        return items.flatMap(item => {
            const smd = item.string_map_data || {};
            const ts = this.parseTimeString(smd['Time']);
            const e = this.makeEvent({
                type: 'logout', icon: '🚪',
                title: 'Logged out of Instagram',
                timestamp: ts,
                category: 'Security',
            });
            return e ? [e] : [];
        });
    },

    // ─── Password changes ──────────────────────────────────────────────────────
    parsePasswordChanges(json) {
        const items = (json.account_history_password_change_history || []);
        return items.flatMap(item => {
            const smd = item.string_map_data || {};
            const ts = this.parseTimeString(smd['Time']);
            const e = this.makeEvent({
                type: 'password_change', icon: '🔑',
                title: 'Changed Instagram password',
                timestamp: ts,
                category: 'Security',
                dataInsight: 'Instagram logs every password change with timestamp. Combined with login history, this can reveal security events.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Word/phrase searches ──────────────────────────────────────────────────
    parseWordSearches(json) {
        const items = (json.searches_keyword || []);
        return items.flatMap(item => {
            const smd = item.string_map_data || {};
            const ts = this.parseTimeString(smd['Time']);
            const query = smd['Search'] || item.title || '';
            const e = this.makeEvent({
                type: 'search', icon: '🔍',
                title: `Searched for "${this.decode(query)}"`,
                timestamp: ts,
                category: 'Searches',
                dataInsight: 'Instagram keeps a record of every search you perform. Your search history reveals exactly what topics, people, and products you were curious about at any point in time.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Profile searches ──────────────────────────────────────────────────────
    parseProfileSearches(json) {
        const items = (json.searches_user || []);
        return items.flatMap(item => {
            const sld = item.string_list_data || [];
            const first = sld[0] || {};
            const ts = first.timestamp;
            const account = item.title || first.value || 'a profile';
            const e = this.makeEvent({
                type: 'profile_search', icon: '👀',
                title: `Searched for profile: ${this.decode(account)}`,
                timestamp: ts,
                category: 'Searches',
                dataInsight: 'Instagram records when you search for specific profiles — revealing who you were looking up and when.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Link history ──────────────────────────────────────────────────────────
    parseLinkHistory(json) {
        const items = Array.isArray(json) ? json : [];
        return items.flatMap(item => {
            const ts = item.timestamp;
            const lv = (item.label_values || []).find(l => l.label === 'URL' || l.value) || {};
            const url = lv.value || lv.label || 'a link';
            const e = this.makeEvent({
                type: 'link_click', icon: '🔗',
                title: `Opened a link in Instagram`,
                description: url.length > 60 ? url.slice(0, 60) + '…' : url,
                timestamp: ts,
                category: 'Browsing',
                dataInsight: 'Instagram\'s built-in browser records every link you open inside the app — including the full URL, which can reveal external websites you visited, articles you read, and products you browsed.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Ads viewed ────────────────────────────────────────────────────────────
    parseAdsViewed(json) {
        const items = Array.isArray(json) ? json : [];
        return items.flatMap(item => {
            const ts = item.timestamp;
            const lv = (item.label_values || [])[0] || {};
            const advertiser = lv.label || lv.value || 'an advertiser';
            const e = this.makeEvent({
                type: 'ad_viewed', icon: '📢',
                title: `Saw an ad from ${this.decode(advertiser)}`,
                timestamp: ts,
                category: 'Ads & Tracking',
                dataInsight: 'Instagram logs every ad you see — who showed it to you, and when. This is proof of the ad targeting system at work: the advertisers shown here chose to target you based on your profile, interests, and behaviour.',
            });
            return e ? [e] : [];
        });
    },

    // ─── Profile changes ───────────────────────────────────────────────────────
    parseProfileChanges(json) {
        const items = (json.profile_profile_change || []);
        return items.flatMap(item => {
            const smd = item.string_map_data || {};
            const ts = this.parseTimeString(smd['Change date']);
            const field = smd['Changed'] || 'profile';
            const prev = smd['Previous value'] || '';
            const e = this.makeEvent({
                type: 'profile_update', icon: '✏️',
                title: `Updated ${this.decode(field)} on Instagram`,
                description: prev ? `Previously: ${this.decode(prev)}` : '',
                timestamp: ts,
                category: 'Profile',
            });
            return e ? [e] : [];
        });
    },

    // ─── Avatar items ──────────────────────────────────────────────────────────
    parseAvatarItems(json) {
        const items = (json.ig_avatar_marketplace_avatar_items || []);
        return items.flatMap(item => {
            const ts = item.acquisition_time;
            const name = item.item || item.type || 'item';
            const e = this.makeEvent({
                type: 'avatar_item', icon: '🎨',
                title: `Acquired avatar item: ${this.decode(name)}`,
                timestamp: ts,
                category: 'Profile',
            });
            return e ? [e] : [];
        });
    },
};
