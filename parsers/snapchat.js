/**
 * Snapchat Parser
 * 
 * Extracts events from Snapchat's JSON data export.
 * Focuses on snaps, chats, friends, memories, stories, and account updates.
 */

const SnapchatParser = {
    id: 'snapchat',
    label: 'Snapchat',
    icon: '👻',
    color: '#E0DE00', // Slightly readable yellow on dark theme, or native #FFFC00
    acceptType: 'folder',
    instructions: `
        <ol>
            <li>Log in to <strong>accounts.snapchat.com</strong> and go to <strong>My Data</strong>.</li>
            <li>Request a data export in <strong>JSON format</strong>.</li>
            <li>Once ready, download and extract the <code>.zip</code> file.</li>
            <li>Select the extracted folder below (it should contain a <code>json/</code> directory).</li>
        </ol>
    `,

    parse(files) {
        const events = [];

        // Snapchat dates are typically "2023-01-25 15:30:00 UTC"
        const parseSnapDate = (dateStr) => {
            if (!dateStr) return null;
            let str = dateStr.replace(' UTC', 'Z');

            // Handle hourly truncations if any (e.g., "2023-01-25 15")
            if (/\s\d{2}$/.test(str)) str += ':00:00Z';
            else if (/\s\d{2}:$/.test(str)) str += '00:00Z';

            const d = new Date(str);
            if (!isNaN(d.getTime())) return d;

            // Fallback
            const fallback = new Date(dateStr);
            if (!isNaN(fallback.getTime())) return fallback;

            return null;
        };

        const addEvent = (date, type, icon, title, description = '') => {
            if (!date) return;
            events.push({
                source: this.id,
                sourceLabel: this.label,
                sourceIcon: this.icon,
                sourceColor: this.color,
                timestamp: date.getTime(),
                date: date,
                year: date.getFullYear(),
                type,
                icon,
                title,
                description: description ? String(description) : ''
            });
        };

        for (const file of files) {
            const path = file.path.toLowerCase();
            const data = file.json;
            if (!data) continue;

            try {
                // 1. Snaps History
                if (path.endsWith('snap_history.json')) {
                    for (const [username, snaps] of Object.entries(data)) {
                        if (!Array.isArray(snaps)) continue;
                        for (const s of snaps) {
                            const date = parseSnapDate(s.Created);
                            const verb = s.IsSender ? 'Sent snap to' : 'Received snap from';
                            const mediaType = s['Media Type'] ? ` (${s['Media Type'].toLowerCase()})` : '';
                            addEvent(date, 'snap', '📸', `${verb} ${username}${mediaType}`);
                        }
                    }
                }

                // 2. Chat History
                else if (path.endsWith('chat_history.json')) {
                    for (const [username, chats] of Object.entries(data)) {
                        if (!Array.isArray(chats)) continue;
                        for (const c of chats) {
                            const date = parseSnapDate(c.Created);
                            let verb = "Chatted with";
                            if (c.From && c.From === username) verb = "Received chat from";
                            else if (c.From) verb = "Sent chat to";

                            const contentStr = c.Content ? c.Content : (c["Media Type"] || 'Media');
                            addEvent(date, 'chat', '💬', `${verb} ${username}`, contentStr);
                        }
                    }
                }

                // 3. Friends
                else if (path.endsWith('friends.json')) {
                    if (Array.isArray(data.Friends)) {
                        for (const f of data.Friends) {
                            const date = parseSnapDate(f['Creation Timestamp']);
                            const name = f['Display Name'] ? `${f['Display Name']} (${f.Username})` : f.Username;
                            const src = f.Source ? ` via ${f.Source}` : '';
                            addEvent(date, 'friend', '🤝', `Became friends with ${name}${src}`);
                        }
                    }
                    if (Array.isArray(data['Friend Requests Sent'])) {
                        for (const f of data['Friend Requests Sent']) {
                            const date = parseSnapDate(f['Creation Timestamp']);
                            const name = f['Display Name'] ? `${f['Display Name']} (${f.Username})` : f.Username;
                            addEvent(date, 'friend_req', '📨', `Sent friend request to ${name}`);
                        }
                    }
                    if (Array.isArray(data['Deleted Friends'])) {
                        for (const f of data['Deleted Friends']) {
                            const date = parseSnapDate(f['Creation Timestamp']);
                            const name = f['Display Name'] ? `${f['Display Name']} (${f.Username})` : f.Username;
                            addEvent(date, 'friend_del', '🚫', `Deleted friend ${name}`);
                        }
                    }
                    if (Array.isArray(data['Blocked Users'])) {
                        for (const f of data['Blocked Users']) {
                            const date = parseSnapDate(f['Creation Timestamp']);
                            const name = f['Display Name'] ? `${f['Display Name']} (${f.Username})` : f.Username;
                            addEvent(date, 'friend_block', '🛑', `Blocked user ${name}`);
                        }
                    }
                    if (Array.isArray(data['Hidden Friend Suggestions'])) {
                        for (const f of data['Hidden Friend Suggestions']) {
                            const date = parseSnapDate(f['Creation Timestamp']);
                            const name = f['Display Name'] ? `${f['Display Name']} (${f.Username})` : f.Username;
                            addEvent(date, 'friend_hide', '🙈', `Hid friend suggestion for ${name}`);
                        }
                    }
                }

                // 4. Story History
                else if (path.endsWith('story_history.json')) {
                    if (Array.isArray(data['Your Story Views'])) {
                        for (const s of data['Your Story Views']) {
                            const date = parseSnapDate(s['Story Date']);
                            addEvent(date, 'story', '📖', `Your story got ${s['Story Views'] || 0} views`);
                        }
                    }
                    if (Array.isArray(data['Friend and Public Story Views'])) {
                        for (const s of data['Friend and Public Story Views']) {
                            const date = parseSnapDate(s['View Date']);
                            const type = s['Media Type'] ? s['Media Type'].toLowerCase() : 'story';
                            addEvent(date, 'story_view', '👀', `Viewed a ${type} story`);
                        }
                    }
                }

                // 5. Memories
                else if (path.endsWith('memories_history.json')) {
                    if (Array.isArray(data['Saved Media'])) {
                        for (const m of data['Saved Media']) {
                            const date = parseSnapDate(m.Date);
                            const type = m['Media Type'] ? m['Media Type'].toLowerCase() : 'media';
                            addEvent(date, 'memory', '🖼️', `Saved a ${type} to Memories`);
                        }
                    }
                }

                // 6. Account History
                else if (path.endsWith('account_history.json')) {
                    const mappings = [
                        { key: 'Display Name Change', icon: '👤', msg: 'Changed display name to' },
                        { key: 'Email Change', icon: '📧', msg: 'Changed email address' },
                        { key: 'Mobile Number Change', icon: '📱', msg: 'Changed mobile number' },
                        { key: 'Password Change', icon: '🔑', msg: 'Changed password' },
                        { key: 'Snapchat Linked to Bitmoji', icon: '😎', msg: 'Linked Bitmoji' }
                    ];
                    for (const map of mappings) {
                        if (Array.isArray(data[map.key])) {
                            for (const item of data[map.key]) {
                                const date = parseSnapDate(item.Date);
                                let extra = '';
                                if (map.key === 'Display Name Change' && item['Display Name']) extra = ` ${item['Display Name']}`;
                                addEvent(date, 'account', map.icon, `${map.msg}${extra}`);
                            }
                        }
                    }
                }

                // 7. Snap Map
                else if (path.endsWith('snap_map_places_history.json')) {
                    if (Array.isArray(data['Snap Map Places History'])) {
                        for (const p of data['Snap Map Places History']) {
                            const date = parseSnapDate(p.Date);
                            addEvent(date, 'map', '📍', `Visited ${p.Place}`);
                        }
                    }
                }

                // 8. Search History
                else if (path.endsWith('search_history.json')) {
                    if (Array.isArray(data[""])) {
                        for (const s of data[""]) {
                            const dStr = s['Date and time (hourly)'] || s['Date'];
                            const date = parseSnapDate(dStr);
                            if (s['Search Term']) {
                                addEvent(date, 'search', '🔍', `Searched for "${s['Search Term']}"`);
                            }
                        }
                    }
                }

                // 9. AI Chat
                else if (path.endsWith('snapchat_ai.json')) {
                    if (Array.isArray(data['My AI Content'])) {
                        for (const c of data['My AI Content']) {
                            const date = parseSnapDate(c.Timestamp);
                            const type = c.Type ? c.Type.toLowerCase() : 'message';
                            addEvent(date, 'ai_chat', '🤖', `AI interacted (${type})`, c.Content);
                        }
                    }
                    if (Array.isArray(data['My AI Memory'])) {
                        for (const m of data['My AI Memory']) {
                            const date = parseSnapDate(m.Timestamp);
                            addEvent(date, 'ai_memory', '🧠', `AI remembered something about you`, m.Memory);
                        }
                    }
                }

                // 10. Talk History (Calls & Games)
                else if (path.endsWith('talk_history.json')) {
                    const keys = ['Outgoing Calls', 'Incoming Calls', 'Completed Calls', 'Chat Sessions', 'Game Sessions'];
                    for (const key of keys) {
                        if (Array.isArray(data[key])) {
                            for (const item of data[key]) {
                                // Assuming 'Creation Timestamp' or 'Date' might be an issue. Fallback checks:
                                const tStr = item['Creation Timestamp'] || item['Date'] || item['Timestamp'];
                                if (tStr) {
                                    const date = parseSnapDate(tStr);
                                    addEvent(date, 'call', '📞', `${key.replace('s', '')} action`);
                                }
                            }
                        }
                    }
                }

            } catch (err) {
                console.warn(`Error processing Snapchat file ${path}:`, err);
            }
        }

        return events;
    }
};
