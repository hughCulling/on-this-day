/**
 * Facebook Data Export Parser
 * Converts Facebook JSON export files into unified TimeCapsule events.
 *
 * Unified Event shape:
 * {
 *   id: string,
 *   source: 'facebook',
 *   type: string,
 *   icon: string,
 *   title: string,
 *   description?: string,
 *   timestamp: number,   // Unix seconds
 *   date: Date,
 *   category: string,
 *   dataInsight?: string // "what FB collected" context
 * }
 */

const FacebookParser = (() => {

  const SOURCE = 'facebook';
  const SOURCE_LABEL = 'Facebook';
  const SOURCE_COLOR = '#1877F2';
  const SOURCE_ICON = '📘';

  let _eventId = 0;
  function makeId() { return `fb_${++_eventId}`; }

  /** Decode Facebook's mangled UTF-8 strings (they double-encode unicode) */
  function decodeText(str) {
    if (typeof str !== 'string') return str;
    try {
      return decodeURIComponent(escape(str));
    } catch {
      return str;
    }
  }

  /** Normalise a timestamp to Unix seconds */
  function toSeconds(ts) {
    if (ts === null || ts === undefined || ts === '') return null;

    if (typeof ts === 'string') {
      const trimmed = ts.trim();
      if (!trimmed) return null;
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) return null;
        return Math.floor(parsed / 1000);
      }
      ts = Number(trimmed);
    }

    if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
    const n = Math.floor(ts);
    if (n <= 0) return null;

    // microseconds
    if (n > 1e15) return Math.floor(n / 1e6);
    // milliseconds
    if (n > 1e12) return Math.floor(n / 1e3);
    // unix seconds
    if (n > 1e8) return n;
    return null;
  }

  function makeEvent({ id, type, icon, title, description, timestamp, category, dataInsight }) {
    const ts = toSeconds(timestamp);
    if (!ts || ts < 0) return null;
    return {
      id: id || makeId(),
      source: SOURCE,
      sourceLabel: SOURCE_LABEL,
      sourceColor: SOURCE_COLOR,
      sourceIcon: SOURCE_ICON,
      type,
      icon,
      title: decodeText(title) || 'Untitled',
      description: description ? decodeText(description) : undefined,
      timestamp: ts,
      date: new Date(ts * 1000),
      category,
      dataInsight,
    };
  }

  // ─── Individual file parsers ────────────────────────────────────────────────

  function parseComments(json) {
    const events = [];
    const items = json?.comments_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'comment',
        icon: '💬',
        title: item.title || 'Left a comment',
        description: item.data?.[0]?.comment?.comment,
        timestamp: item.timestamp,
        category: 'Social',
        dataInsight: 'Facebook logs every comment you post, including the exact time.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseLikesAndReactions(json) {
    const events = [];
    const items = Array.isArray(json) ? json : [];
    for (const item of items) {
      const reaction = item.data?.[0]?.reaction?.reaction || 'Like';
      const reactionEmoji = {
        'LIKE': '👍', 'LOVE': '❤️', 'HAHA': '😂',
        'WOW': '😮', 'SAD': '😢', 'ANGRY': '😡',
        'CARE': '🤗',
      }[reaction?.toUpperCase()] || '❤️';
      const e = makeEvent({
        type: 'reaction',
        icon: reactionEmoji,
        title: item.title || `Reacted to something`,
        timestamp: item.timestamp,
        category: 'Social',
        dataInsight: `Facebook records every reaction you give, including the reaction type (${reaction}).`,
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseGroupMembership(json) {
    const events = [];
    const items = json?.groups_joined_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'group_join',
        icon: '👥',
        title: item.title || 'Joined a group',
        timestamp: item.timestamp,
        category: 'Groups',
        dataInsight: 'Facebook stores a full record of every group you have joined or left.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parsePagesLiked(json) {
    const events = [];
    const items = json?.page_likes_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'page_like',
        icon: '👍',
        title: `Liked the page: ${item.name}`,
        timestamp: item.timestamp,
        category: 'Pages',
        dataInsight: 'Facebook keeps a permanent record of every Page you have liked.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parsePagesFollowed(json) {
    const events = [];
    const items = json?.pages_followed_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'page_follow',
        icon: '➕',
        title: item.title || 'Followed a page/profile',
        timestamp: item.timestamp,
        category: 'Pages',
        dataInsight: 'Facebook logs every page and profile you follow.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parsePagesUnfollowed(json) {
    const events = [];
    const items = json?.pages_unfollowed_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'page_unfollow',
        icon: '➖',
        title: item.title || 'Unfollowed a page/profile',
        timestamp: item.timestamp,
        category: 'Pages',
        dataInsight: 'Facebook also tracks when you unfollow pages.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseEventInvitations(json) {
    const events = [];
    const items = json?.events_invited_v2 || [];
    for (const item of items) {
      const startEvent = makeEvent({
        type: 'event_invite',
        icon: '📅',
        title: `Invited to: ${item.name}`,
        description: item.start_timestamp
          ? `Event started: ${new Date(toSeconds(item.start_timestamp) * 1000).toLocaleDateString()}`
          : undefined,
        timestamp: item.start_timestamp,
        category: 'Events',
        dataInsight: 'Facebook stores all event invitations you have received.',
      });
      if (startEvent) events.push(startEvent);

      if (item.end_timestamp) {
        const endEvent = makeEvent({
          type: 'event_invite_end',
          icon: '🏁',
          title: `Event ended: ${item.name}`,
          timestamp: item.end_timestamp,
          category: 'Events',
          dataInsight: 'Facebook also stores the end time of invited events.',
        });
        if (endEvent) events.push(endEvent);
      }
    }
    return events;
  }

  function parseEventResponses(json) {
    const events = [];
    const interested = json?.event_responses_v2?.events_interested || [];
    for (const item of interested) {
      const startEvent = makeEvent({
        type: 'event_interest',
        icon: '⭐',
        title: `Marked interested in: ${item.name}`,
        timestamp: item.start_timestamp,
        category: 'Events',
        dataInsight: 'Facebook tracks which events you expressed interest in.',
      });
      if (startEvent) events.push(startEvent);

      if (item.end_timestamp) {
        const endEvent = makeEvent({
          type: 'event_interest_end',
          icon: '🏁',
          title: `Event you were interested in ended: ${item.name}`,
          timestamp: item.end_timestamp,
          category: 'Events',
          dataInsight: 'Facebook stores the end time for events you engage with.',
        });
        if (endEvent) events.push(endEvent);
      }
    }
    return events;
  }

  function parseFriends(json) {
    const events = [];
    const items = json?.friends_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'friend_added',
        icon: '🤝',
        title: `Became friends with ${item.name}`,
        timestamp: item.timestamp,
        category: 'Friends',
        dataInsight: 'Facebook records every friendship connection with an exact timestamp.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseFriendRequests(json) {
    const events = [];
    const items = json?.sent_requests_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'friend_request',
        icon: '📨',
        title: `Sent a friend request to ${item.name}`,
        timestamp: item.timestamp,
        category: 'Friends',
        dataInsight: 'Facebook stores every friend request you have ever sent.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseRejectedRequests(json) {
    const events = [];
    const items = json?.rejected_requests_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'friend_rejected',
        icon: '🚫',
        title: `Declined a friend request from ${item.name}`,
        timestamp: item.timestamp,
        category: 'Friends',
        dataInsight: 'Facebook even tracks friend requests you declined.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseFollowing(json) {
    const events = [];
    const items = json?.following_v3 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'followed',
        icon: '➕',
        title: `Followed ${item.name}`,
        timestamp: item.timestamp,
        category: 'Friends',
        dataInsight: 'Facebook records everyone you have followed.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseSearchHistory(json) {
    const events = [];
    const items = json?.searches_v2 || [];
    for (const item of items) {
      const query = item.data?.[0]?.text || item.title || 'Unknown search';
      const e = makeEvent({
        type: 'search',
        icon: '🔍',
        title: `Searched for: "${query}"`,
        timestamp: item.timestamp,
        category: 'Search',
        dataInsight: 'Facebook stores the complete text of every search you have made.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseNotifications(json) {
    const events = [];
    const items = json?.notifications_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'notification',
        icon: '🔔',
        title: item.text || 'Received a notification',
        timestamp: item.timestamp,
        category: 'Activity',
        dataInsight: 'Facebook logs every notification it sent you, with exact timestamp.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseProfileUpdates(json) {
    const events = [];
    const items = json?.profile_updates_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'profile_update',
        icon: '✏️',
        title: item.title || 'Updated your profile',
        timestamp: item.timestamp,
        category: 'Profile',
        dataInsight: 'Facebook keeps a full history of every change you make to your profile.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseConnectedApps(json) {
    const events = [];
    const items = json?.installed_apps_v2 || [];
    for (const item of items) {
      const connected = makeEvent({
        type: 'app_connected',
        icon: '🔗',
        title: `Connected app: ${item.name}`,
        description: item.category ? `Category: ${item.category}` : undefined,
        timestamp: item.added_timestamp,
        category: 'Apps',
        dataInsight: 'Facebook records every third-party app you connect to your account.',
      });
      if (connected) events.push(connected);

      if (item.removed_timestamp) {
        const removed = makeEvent({
          type: 'app_disconnected',
          icon: '🔌',
          title: `Disconnected app: ${item.name}`,
          timestamp: item.removed_timestamp,
          category: 'Apps',
          dataInsight: 'Facebook also records when connected apps are removed.',
        });
        if (removed) events.push(removed);
      }
    }
    return events;
  }

  function parseMessages(json, conversationTitle) {
    const events = [];
    const messages = json?.messages || [];
    const title = json?.title || conversationTitle || 'a conversation';
    const participants = json?.participants?.map(p => decodeText(p.name)) || [];
    const otherPeople = participants.filter(n => !n.toLowerCase().includes('hugh'));
    const nameStr = otherPeople.length > 0 ? otherPeople.join(' & ') : title;

    for (const msg of messages) {
      const ts = toSeconds(msg.timestamp_ms);
      if (!ts) continue;
      const e = makeEvent({
        type: 'message',
        icon: '💌',
        title: `Messaged ${nameStr}`,
        description: msg.content ? decodeText(msg.content).slice(0, 120) : 'Message event',
        timestamp: ts,
        category: 'Messages',
        dataInsight: 'Facebook/Messenger stores every individual message timestamp, content, and participants.',
      });
      if (e) events.push(e);

      const photos = Array.isArray(msg.photos) ? msg.photos : [];
      const videos = Array.isArray(msg.videos) ? msg.videos : [];
      const audios = Array.isArray(msg.audio_files) ? msg.audio_files : [];
      const files = [...photos, ...videos, ...audios];

      for (const media of files) {
        const mediaTs = toSeconds(media?.creation_timestamp);
        if (!mediaTs) continue;
        const mediaEvent = makeEvent({
          type: 'message_media',
          icon: '🖼️',
          title: `Shared media in conversation with ${nameStr}`,
          description: media?.uri ? decodeText(media.uri) : undefined,
          timestamp: mediaTs,
          category: 'Messages',
          dataInsight: 'Messenger tracks creation timestamps for media attached to chats.',
        });
        if (mediaEvent) events.push(mediaEvent);
      }
    }
    return events;
  }

  function parseAdvertisers(json) {
    const events = [];
    const items = Array.isArray(json) ? json : [];
    for (const item of items) {
      const name = item.label_values?.find(lv => lv.label === 'Advertiser name')?.value;
      const e = makeEvent({
        type: 'advertiser_interaction',
        icon: '🎯',
        title: `Tracked by advertiser: ${name || 'Unknown'}`,
        timestamp: item.timestamp,
        category: 'Ads & Tracking',
        dataInsight: 'This advertiser\'s website or app sent your activity data to Facebook on this date. You may not have been on Facebook at the time.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseLogins(json) {
    const events = [];
    const items = json?.account_accesses_v2 || [];
    for (const item of items) {
      const isLogout = item.action === 'logout';
      const e = makeEvent({
        type: isLogout ? 'logout' : 'login',
        icon: isLogout ? '🚪' : '🔐',
        title: isLogout ? 'Logged out of Facebook' : 'Logged into Facebook',
        description: item.site ? `From: ${item.site}` : undefined,
        timestamp: item.timestamp,
        category: 'Security',
        dataInsight: 'Facebook records every login with your IP address, browser, and location.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseReelsSavedAudio(json) {
    const events = [];
    const items = json?.shorts_saved_audio_v2 || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'reel_audio',
        icon: '🎵',
        title: item.title || 'Saved audio from a Reel',
        timestamp: item.timestamp,
        category: 'Reels',
        dataInsight: 'Facebook logs every audio track you save from Reels.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function parseAvatarItems(json) {
    const events = [];
    const items = json?.avatar_marketplace_avatar_items || [];
    for (const item of items) {
      const e = makeEvent({
        type: 'avatar_item',
        icon: '🎭',
        title: `Acquired avatar item: ${item.item || 'Unknown'}`,
        description: item.type ? `Type: ${item.type}` : undefined,
        timestamp: item.acquisition_time,
        category: 'Profile',
        dataInsight: 'Facebook records every avatar customisation you have made.',
      });
      if (e) events.push(e);
    }
    return events;
  }

  function keyLooksLikeTimestamp(key) {
    const k = String(key).toLowerCase();
    return (
      k.includes('timestamp') ||
      k.endsWith('_time') ||
      k.endsWith('_date') ||
      k.includes('created') ||
      k.includes('updated') ||
      k.includes('last_active') ||
      k.includes('last_activity') ||
      k.includes('last_visit') ||
      k.includes('verification_time')
    );
  }

  function humanizeKey(key) {
    return String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function iconForPath(path) {
    const p = path.toLowerCase();
    if (p.includes('security') || p.includes('login')) return '🔐';
    if (p.includes('ads_information')) return '🎯';
    if (p.includes('/messages/')) return '💬';
    if (p.includes('/posts/')) return '📝';
    if (p.includes('/groups/')) return '👥';
    if (p.includes('/pages/')) return '📄';
    if (p.includes('payments')) return '💳';
    if (p.includes('marketplace')) return '🛍️';
    if (p.includes('preferences')) return '⚙️';
    if (p.includes('friends')) return '🤝';
    return '🧾';
  }

  function categoryForPath(path) {
    const p = path.toLowerCase();
    if (p.includes('security') || p.includes('login')) return 'Security';
    if (p.includes('ads_information')) return 'Ads & Tracking';
    if (p.includes('/messages/')) return 'Messages';
    if (p.includes('/posts/')) return 'Posts';
    if (p.includes('/groups/')) return 'Groups';
    if (p.includes('/pages/')) return 'Pages';
    if (p.includes('payments')) return 'Payments';
    if (p.includes('marketplace')) return 'Marketplace';
    if (p.includes('preferences')) return 'Preferences';
    if (p.includes('friends')) return 'Connections';
    return 'Metadata';
  }

  function summariseObject(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const candidates = [
      obj.title, obj.name, obj.label, obj.action, obj.type, obj.site, obj.value, obj.item, obj.place,
      obj.description,
    ].filter(Boolean).map(v => decodeText(String(v)));
    if (Array.isArray(obj.label_values)) {
      for (const lv of obj.label_values) {
        if (lv?.label || lv?.value) {
          candidates.push(`${decodeText(String(lv.label || 'Label'))}: ${decodeText(String(lv.value || ''))}`.trim());
        }
      }
    }
    return candidates[0] || '';
  }

  function parseGenericTimestamped(relativePath, json) {
    const events = [];
    const p = relativePath.replace(/\\/g, '/');

    function walk(node, breadcrumb = []) {
      if (Array.isArray(node)) {
        for (const child of node) walk(child, breadcrumb);
        return;
      }
      if (!node || typeof node !== 'object') return;

      const objectSummary = summariseObject(node);
      for (const [key, value] of Object.entries(node)) {
        if (keyLooksLikeTimestamp(key)) {
          const ts = toSeconds(value);
          if (ts) {
            const pathKey = breadcrumb.length ? `${breadcrumb.join('.')}.${key}` : key;
            const event = makeEvent({
              type: 'timestamp_record',
              icon: iconForPath(p),
              title: `${humanizeKey(key)} recorded`,
              description: objectSummary || `From ${p}`,
              timestamp: ts,
              category: categoryForPath(p),
              dataInsight: `Timestamp extracted from ${p} at "${pathKey}".`,
            });
            if (event) events.push(event);
          }
        }
        walk(value, breadcrumb.concat(key));
      }
    }

    walk(json, []);
    return events;
  }

  // ─── File routing ────────────────────────────────────────────────────────────

  /**
   * Given a relative file path and its parsed JSON, return an array of events.
   */
  function routeFile(relativePath, json) {
    const p = relativePath.replace(/\\/g, '/').toLowerCase();

    // Comments
    if (p.endsWith('comments_and_reactions/comments.json')) return parseComments(json);

    // Likes/Reactions (both files)
    if (p.match(/likes_and_reactions(_\d+)?\.json$/)) return parseLikesAndReactions(json);

    // Groups
    if (p.endsWith('groups/your_group_membership_activity.json')) return parseGroupMembership(json);

    // Pages
    if (p.endsWith("pages/pages_you've_liked.json")) return parsePagesLiked(json);
    if (p.endsWith('pages/pages_and_profiles_you_follow.json')) return parsePagesFollowed(json);
    if (p.endsWith("pages/pages_and_profiles_you've_unfollowed.json")) return parsePagesUnfollowed(json);

    // Events
    if (p.endsWith('events/event_invitations.json')) return parseEventInvitations(json);
    if (p.endsWith('events/your_event_responses.json')) return parseEventResponses(json);

    // Friends
    if (p.endsWith('friends/your_friends.json')) return parseFriends(json);
    if (p.endsWith('friends/sent_friend_requests.json')) return parseFriendRequests(json);
    if (p.endsWith('friends/rejected_friend_requests.json')) return parseRejectedRequests(json);
    if (p.endsWith("followers/who_you've_followed.json")) return parseFollowing(json);

    // Search
    if (p.endsWith('search/your_search_history.json')) return parseSearchHistory(json);

    // Notifications
    if (p.endsWith('notifications/notifications.json')) return parseNotifications(json);

    // Profile
    if (p.endsWith('profile_information/profile_update_history.json')) return parseProfileUpdates(json);

    // Connected apps
    if (p.endsWith('connected_apps_and_websites.json')) return parseConnectedApps(json);

    // Reels
    if (p.endsWith("reels/audio_you've_saved.json")) return parseReelsSavedAudio(json);

    // Avatar
    if (p.endsWith('avatars_store/avatar_items.json')) return parseAvatarItems(json);

    // Messages (inbox, message_requests, e2ee_cutover)
    if (p.match(/messages\/(inbox|message_requests|e2ee_cutover)\/.+\/message_\d+\.json$/)) {
      const title = json?.title;
      return parseMessages(json, title);
    }

    // Advertisers
    if (p.endsWith("advertisers_you've_interacted_with.json")) return parseAdvertisers(json);

    // Logins
    if (p.endsWith('logins_and_logouts.json')) return parseLogins(json);

    return [];
  }

  /**
   * Main entry: parse an array of { path, json } file objects
   * Returns a flat array of events.
   */
  function parse(files) {
    _eventId = 0;
    const allEvents = [];
    const fingerprints = new Set();

    function pushUnique(events) {
      for (const e of events) {
        const fp = `${e.type}|${e.timestamp}|${e.title}|${e.description || ''}`;
        if (fingerprints.has(fp)) continue;
        fingerprints.add(fp);
        allEvents.push(e);
      }
    }

    for (const { path, json } of files) {
      try {
        const events = routeFile(path, json);
        pushUnique(events);

        if (!events.length) {
          pushUnique(parseGenericTimestamped(path, json));
        }
      } catch (err) {
        console.warn(`[Facebook] Error parsing ${path}:`, err);
      }
    }
    return allEvents;
  }

  return {
    id: 'facebook',
    label: 'Facebook',
    icon: '📘',
    color: SOURCE_COLOR,
    parse,
    instructions: `
      <ol>
        <li>Go to <strong>Facebook → Settings → Your Facebook Information → Download Your Information</strong></li>
        <li>Select <strong>JSON</strong> format and your desired date range</li>
        <li>Request the download and wait for Facebook to prepare it (can take minutes to hours)</li>
        <li>Download and <strong>unzip</strong> the file on your computer</li>
        <li>Click the button below and select the <strong>unzipped folder</strong></li>
      </ol>
    `,
  };
})();
