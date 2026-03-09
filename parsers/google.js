// ============================================================
//  GoogleParser — full rewrite covering all Takeout sources
//  Handles: hughculling01@gmail.com, pestigebumda@gmail.com,
//           20206905@hope.ac.uk  (and any similar structure)
//
//  Called by app.js as: parse(text, relativeFilePath)
//  Returns: Event[]  (empty array for unrecognised files)
// ============================================================

const GoogleParser = (() => {

    // ── Date helpers ────────────────────────────────────────────────────────────
  
    // Handles Google's MDL format: "Jan 15, 2023, 3:42:16 PM GMT+5:30"
    function parseMDLDate(str) {
      if (!str) return null;
      str = str.trim().replace(' at ', ' ');
      let d = new Date(str);
      if (!isNaN(d)) return d.toISOString();
      // Strip abbreviated timezone tokens Date() doesn't grok (BST, EST, PDT…)
      const cleaned = str.replace(/\s+[A-Z]{2,5}(?:[+-]\d{1,2}(?::\d{2})?)?$/, '');
      d = new Date(cleaned);
      return isNaN(d) ? null : d.toISOString();
    }
  
    function parseISO(str) {
      if (!str) return null;
      const d = new Date(str);
      return isNaN(d) ? null : d.toISOString();
    }
  
    // ICS compact format: 20230115T144216Z  or  20230115T144216  or  20230115
    function parseICSDate(str) {
      if (!str || str.length < 8) return null;
      const y  = str.slice(0, 4);
      const mo = str.slice(4, 6);
      const dy = str.slice(6, 8);
      if (str.length === 8) return new Date(`${y}-${mo}-${dy}T00:00:00Z`).toISOString();
      const h  = str.slice(9, 11);
      const mi = str.slice(11, 13);
      const s  = str.slice(13, 15);
      const z  = str.endsWith('Z') ? 'Z' : '';
      const d  = new Date(`${y}-${mo}-${dy}T${h}:${mi}:${s}${z}`);
      return isNaN(d) ? null : d.toISOString();
    }
  
    // ── CSV helpers ──────────────────────────────────────────────────────────────
  
    function splitCSVLine(line) {
      const result = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if (c === ',' && !inQuote) {
          result.push(cur); cur = '';
        } else cur += c;
      }
      result.push(cur);
      return result;
    }
  
    function csvToRows(text) {
      const lines = text.split('\n');
      if (lines.length < 2) return [];
      const headers = splitCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const vals = splitCSVLine(line);
        const row = {};
        headers.forEach((h, idx) => {
          row[h] = (vals[idx] ?? '').replace(/^"|"$/g, '').trim();
        });
        rows.push(row);
      }
      return rows;
    }
  
    // Case-insensitive key lookup on a row object
    function rowGet(row, key) {
      const k = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
      return k ? row[k] : '';
    }
  
    // ── Nested object path ───────────────────────────────────────────────────────
  
    function dig(obj, path) {
      return path.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : null), obj) ?? null;
    }
  
    // ── MDL Activity HTML parser ─────────────────────────────────────────────────
    //  Handles My Activity/*.html and YouTube history/*.html
    //  Structure: .outer-cell > .mdl-grid > .header-cell + .content-cell (×2)
    //             Left content-cell = description, right = timestamp
  
    function parseMDLActivityHTML(html, sourceLabel) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const events = [];
  
      for (const cell of doc.querySelectorAll('.outer-cell')) {
        const sectionEl = cell.querySelector('.mdl-typography--title, .header-cell p');
        const section = sectionEl ? sectionEl.textContent.trim() : sourceLabel;
        const contentCells = cell.querySelectorAll('.content-cell');
  
        // Pairs: [0]=content [1]=timestamp, [2]=content [3]=timestamp, …
        for (let i = 0; i + 1 < contentCells.length; i += 2) {
          const leftCell  = contentCells[i];
          const rightCell = contentCells[i + 1];
  
          const dateText = rightCell.textContent.trim();
          const isoDate  = parseMDLDate(dateText);
          if (!isoDate) continue;
  
          const boldEl   = leftCell.querySelector('b');
          const title    = boldEl
            ? boldEl.textContent.trim()
            : leftCell.textContent.trim().split('\n')[0].trim();
  
          const fullText = leftCell.textContent.replace(/\s+/g, ' ').trim();
          const links    = Array.from(leftCell.querySelectorAll('a'))
            .map(a => a.href).filter(Boolean);
  
          const eventTitle = title ? `${sourceLabel}: ${title}` : sourceLabel;
  
          events.push({
            date: isoDate,
            type: 'activity',
            platform: 'google',
            title: eventTitle,
            description: fullText,
            dataInsight: `Google recorded this ${section} activity with timestamp, description, and any associated URLs.`,
            preview() {
              let out = fullText;
              if (links.length) out += '\n\nLinks:\n' + links.join('\n');
              return out;
            }
          });
        }
      }
      return events;
    }
  
    // ── ICS Calendar parser ──────────────────────────────────────────────────────
  
    function parseICS(text) {
      const events = [];
      // Unfold continued lines
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const unfolded = [];
      for (const line of lines) {
        if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
          unfolded[unfolded.length - 1] += line.slice(1);
        } else {
          unfolded.push(line);
        }
      }
  
      let inEvent = false;
      let cur = {};
      for (const line of unfolded) {
        if (line === 'BEGIN:VEVENT') { inEvent = true; cur = {}; continue; }
        if (line === 'END:VEVENT') {
          inEvent = false;
          if (cur.DTSTART) {
            const isoDate = parseICSDate(cur.DTSTART);
            if (isoDate) {
              const isoEnd  = cur.DTEND ? parseICSDate(cur.DTEND) : null;
              const summary = cur.SUMMARY || 'Calendar event';
              const desc    = (cur.DESCRIPTION || '').replace(/\\n/g, '\n').replace(/\\,/g, ',');
              const loc     = cur.LOCATION || '';
              events.push({
                date: isoDate,
                type: 'calendar_event',
                platform: 'google',
                title: `Calendar: ${summary}`,
                description: [summary, desc, loc ? `📍 ${loc}` : ''].filter(Boolean).join('\n'),
                dataInsight: 'Google Calendar stored this event with start/end times, title, description, and location.',
                preview() {
                  let out = `Summary: ${summary}`;
                  if (isoEnd)  out += `\nEnd: ${isoEnd}`;
                  if (desc)    out += `\nDescription: ${desc}`;
                  if (loc)     out += `\nLocation: ${loc}`;
                  if (cur.ORGANIZER) out += `\nOrganiser: ${cur.ORGANIZER}`;
                  return out;
                }
              });
            }
          }
          cur = {};
          continue;
        }
        if (!inEvent) continue;
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key   = line.slice(0, colonIdx).split(';')[0].toUpperCase();
        const value = line.slice(colonIdx + 1);
        cur[key] = value;
      }
      return events;
    }
  
    // ── Tasks JSON parser ────────────────────────────────────────────────────────
  
    function parseTasks(text) {
      const events = [];
      let data;
      try { data = JSON.parse(text); } catch { return []; }
      for (const item of (data.items || [])) {
        const title = item.title || 'Task';
        const notes = item.notes || '';
        if (item.create_time) {
          const isoDate = parseISO(item.create_time);
          if (isoDate) events.push({
            date: isoDate,
            type: 'task_created',
            platform: 'google',
            title: `Task created: ${title}`,
            description: notes ? `${title} — ${notes}` : title,
            dataInsight: 'Google Tasks stored this task with its creation timestamp, title, and notes.',
            preview: () => `Title: ${title}\nCreated: ${item.create_time}\nUpdated: ${item.updated ?? 'N/A'}\nNotes: ${notes || 'none'}`
          });
        }
        if (item.updated && item.updated !== item.create_time) {
          const isoDate = parseISO(item.updated);
          if (isoDate) events.push({
            date: isoDate,
            type: 'task_updated',
            platform: 'google',
            title: `Task updated: ${title}`,
            description: notes ? `${title} — ${notes}` : title,
            dataInsight: 'Google Tasks stored every update to this task with an exact timestamp.',
            preview: () => `Title: ${title}\nCreated: ${item.create_time ?? 'N/A'}\nUpdated: ${item.updated}\nNotes: ${notes || 'none'}`
          });
        }
      }
      return events;
    }
  
    // ── Timeline Settings JSON parser ────────────────────────────────────────────
  
    function parseTimelineSettings(text) {
      const events = [];
      let data;
      try { data = JSON.parse(text); } catch { return []; }
  
      const fields = [
        ['createdTime',                                                      'Timeline settings record created'],
        ['modifiedTime',                                                     'Timeline settings last modified'],
        ['storeVisitControl.updateTime',                                     'Store-visit tracking setting changed'],
        ['retentionControl.updateTime',                                      'Retention period setting changed'],
        ['timelineDeletionTime',                                             'Timeline history deleted'],
        ['latestTimelineSettingChange.timelineEnabledModificationTime',      'Timeline enabled/disabled'],
        ['latestLocationReportingSettingChange.reportingEnabledModificationTime', 'Location reporting setting changed'],
        ['timelineEditUploadsControl.updateTime',                            'Timeline upload setting changed'],
        ['googleOpinionRewardsControl.updateTime',                          'Google Opinion Rewards setting changed'],
      ];
  
      for (const [path, label] of fields) {
        const val = dig(data, path);
        if (!val) continue;
        const isoDate = parseISO(val);
        if (!isoDate) continue;
        events.push({
          date: isoDate,
          type: 'timeline_setting',
          platform: 'google',
          title: `Google Timeline: ${label}`,
          description: label,
          dataInsight: 'Google Timeline records every change to your location-history settings — revealing exactly when you turned tracking on or off.',
          preview: () => `Event: ${label}\nTimestamp: ${val}\n\nFull settings snapshot:\n${JSON.stringify(data, null, 2)}`
        });
      }
  
      // Device entries (hope.ac.uk account has these)
      for (const device of (data.deviceSettings || [])) {
        if (!device.deviceCreationTime) continue;
        const isoDate = parseISO(device.deviceCreationTime);
        if (!isoDate) continue;
        events.push({
          date: isoDate,
          type: 'timeline_device',
          platform: 'google',
          title: 'Google Timeline: Device registered for location tracking',
          description: 'A device was registered to report location history',
          dataInsight: 'Google Timeline records when each device was first enrolled in location-history reporting.',
          preview: () => JSON.stringify(device, null, 2)
        });
      }
  
      return events;
    }
  
    // ── Access Log CSV parser ────────────────────────────────────────────────────
  
    function parseAccessLog(text) {
      const events = [];
      for (const row of csvToRows(text)) {
        const ts = row['Activity Timestamp'];
        if (!ts) continue;
        const isoDate = parseISO(ts);
        if (!isoDate) continue;
        const product    = row['Product Name']      || '';
        const subProduct = row['Sub-Product Name']  || '';
        const actType    = row['Activity Type']     || '';
        const city       = row['Activity City']     || '';
        const country    = row['Activity Country']  || '';
        const label      = [product, subProduct].filter(Boolean).join(' › ');
        const where      = [city, country].filter(Boolean).join(', ');
        events.push({
          date: isoDate,
          type: 'account_access',
          platform: 'google',
          title: `Google Account Access: ${label || actType}`,
          description: [actType, label, where ? `from ${where}` : ''].filter(Boolean).join(' — '),
          dataInsight: 'Google logs every account access with product, IP-derived location, user-agent, and activity type.',
          preview: () => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')
        });
      }
      return events;
    }
  
    // ── Google Pay CSV parser ────────────────────────────────────────────────────
    //  Covers both "Money remittances and requests" and "Money sends and requests"
  
    function parseGooglePay(text) {
      const events = [];
      for (const row of csvToRows(text)) {
        const ts = row['Time'];
        if (!ts) continue;
        const isoDate = parseISO(ts);
        if (!isoDate) continue;
        const desc   = row['Description']     || 'Transaction';
        const amount = row['Amount']          || '';
        const status = row['Status']          || '';
        const memo   = row['Memo']            || '';
        events.push({
          date: isoDate,
          type: 'payment',
          platform: 'google',
          title: `Google Pay: ${desc}${amount ? '  ' + amount : ''}`,
          description: [desc, memo, status].filter(Boolean).join(' — '),
          dataInsight: 'Google Pay stores every transaction with timestamp, description, amount, payment method, and status.',
          preview: () => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')
        });
      }
      return events;
    }
  
    // ── Google Shopping reviews ──────────────────────────────────────────────────
  
    function parseShoppingReviews(text, kind) {
      const events = [];
      for (const row of csvToRows(text)) {
        const ts = row['Creation Timestamp'];
        if (!ts) continue;
        const isoDate = parseISO(ts);
        if (!isoDate) continue;
        const rating  = row['Rating']   || '';
        const title   = row['Title']    || '';
        const comment = row['Comment']  || '';
        const label   = kind === 'merchant' ? 'Merchant review' : 'Product review';
        events.push({
          date: isoDate,
          type: 'review',
          platform: 'google',
          title: `Google Shopping: ${label}${rating ? ' (' + rating + '★)' : ''}`,
          description: [title, comment].filter(Boolean).join(' — ') || label,
          dataInsight: 'Google Shopping stored this review with rating, text, and creation timestamp.',
          preview: () => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')
        });
      }
      return events;
    }
  
    // ── YouTube Comments ─────────────────────────────────────────────────────────
  
    function parseYouTubeComments(text) {
      const events = [];
      for (const row of csvToRows(text)) {
        const ts = rowGet(row, 'Comment Create Timestamp');
        if (!ts) continue;
        const isoDate = parseISO(ts);
        if (!isoDate) continue;
        const comment = rowGet(row, 'Comment Text') || '';
        const price   = rowGet(row, 'Price')        || '';
        events.push({
          date: isoDate,
          type: 'yt_comment',
          platform: 'google',
          title: `YouTube Comment${price ? ' 💰 ' + price : ''}`,
          description: comment || '(comment text not available)',
          dataInsight: 'YouTube stored every comment you posted with exact creation timestamp, video/post context, and any Super Chat amount.',
          preview: () => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')
        });
      }
      return events;
    }
  
    // ── YouTube Live Chats ───────────────────────────────────────────────────────
  
    function parseYouTubeLiveChats(text) {
      const events = [];
      for (const row of csvToRows(text)) {
        const ts = rowGet(row, 'Live Chat Create Timestamp');
        if (!ts) continue;
        const isoDate = parseISO(ts);
        if (!isoDate) continue;
        const msg   = rowGet(row, 'Live Chat Text') || '';
        const price = rowGet(row, 'Price')          || '';
        events.push({
          date: isoDate,
          type: 'yt_livechat',
          platform: 'google',
          title: `YouTube Live Chat${price ? ' 💰 ' + price : ''}`,
          description: msg || '(message text not available)',
          dataInsight: 'YouTube stored every live chat message with timestamp, video context, and any Super Chat amount.',
          preview: () => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')
        });
      }
      return events;
    }
  
    // ── YouTube Playlists (playlists.csv) ────────────────────────────────────────
  
    function parseYouTubePlaylists(text) {
      const events = [];
      for (const row of csvToRows(text)) {
        const createTs  = rowGet(row, 'Playlist Create Timestamp') || rowGet(row, 'Playlist create timestamp');
        const updateTs  = rowGet(row, 'Playlist Update Timestamp') || rowGet(row, 'Playlist update timestamp');
        const title     = rowGet(row, 'Playlist Title (Original)') || rowGet(row, 'Playlist title (original)') || 'Playlist';
        const visibility = rowGet(row, 'Playlist Visibility') || rowGet(row, 'Playlist visibility') || '';
  
        if (createTs) {
          const isoDate = parseISO(createTs);
          if (isoDate) events.push({
            date: isoDate,
            type: 'yt_playlist_created',
            platform: 'google',
            title: `YouTube Playlist created: ${title}`,
            description: `Created${visibility ? ' (' + visibility + ')' : ''} playlist: ${title}`,
            dataInsight: 'YouTube stored the exact creation timestamp, visibility, and settings for each playlist.',
            preview: () => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')
          });
        }
        if (updateTs && updateTs !== createTs) {
          const isoDate = parseISO(updateTs);
          if (isoDate) events.push({
            date: isoDate,
            type: 'yt_playlist_updated',
            platform: 'google',
            title: `YouTube Playlist updated: ${title}`,
            description: `Updated playlist: ${title}`,
            dataInsight: 'YouTube stored the exact timestamp of every playlist modification.',
            preview: () => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')
          });
        }
      }
      return events;
    }
  
    // ── YouTube Playlist Videos (*-videos.csv, * videos.csv) ─────────────────────
  
    function parseYouTubePlaylistVideos(text, playlistName) {
      const events = [];
      for (const row of csvToRows(text)) {
        const ts = rowGet(row, 'Playlist Video Creation Timestamp') || rowGet(row, 'Playlist video creation timestamp');
        if (!ts) continue;
        const isoDate = parseISO(ts);
        if (!isoDate) continue;
        const videoId = rowGet(row, 'Video ID') || rowGet(row, 'video id') || '';
        events.push({
          date: isoDate,
          type: 'yt_playlist_video_added',
          platform: 'google',
          title: `YouTube: Video added to "${playlistName}"`,
          description: `Added video${videoId ? ' (' + videoId + ')' : ''} to "${playlistName}"`,
          dataInsight: 'YouTube stores the exact timestamp when each video was added to a playlist.',
          preview: () => `Playlist: ${playlistName}\nVideo ID: ${videoId}\nAdded: ${ts}`
        });
      }
      return events;
    }
  
    // ── Google Account Change History HTML ───────────────────────────────────────
  
    function parseChangeHistory(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const events = [];
      let headers = [];
  
      for (const row of doc.querySelectorAll('tr')) {
        const ths = row.querySelectorAll('th');
        if (ths.length) {
          headers = Array.from(ths).map(th => th.textContent.trim());
          continue;
        }
        const tds   = row.querySelectorAll('td');
        if (!tds.length) continue;
        const cells = Array.from(tds).map(td => td.textContent.trim());
  
        // Find which cell is a parseable date
        let isoDate = null;
        let dateStr = '';
        for (const val of cells) {
          if (val.length < 6) continue;
          const d = new Date(val);
          if (!isNaN(d)) { isoDate = d.toISOString(); dateStr = val; break; }
        }
        if (!isoDate) continue;
  
        const desc = cells.filter(c => c !== dateStr).join(' — ');
        events.push({
          date: isoDate,
          type: 'account_change',
          platform: 'google',
          title: `Google Account: ${desc || 'Account change'}`,
          description: desc,
          dataInsight: 'Google Account maintains a full audit log of every change to your account settings, each with an exact timestamp.',
          preview: () => (headers.length
            ? headers.map((h, i) => `${h}: ${cells[i] ?? ''}`).join('\n')
            : cells.join('\n'))
        });
      }
      return events;
    }
  
    // ── Source label from file path ──────────────────────────────────────────────
  
    function sourceLabel(filename) {
      const f = filename.toLowerCase().replace(/\\/g, '/');
      if (f.includes('/my activity/search/'))       return 'Google Search';
      if (f.includes('/my activity/youtube/'))      return 'YouTube Activity';
      if (f.includes('/my activity/maps/'))         return 'Google Maps Activity';
      if (f.includes('/my activity/image search/')) return 'Google Image Search';
      if (f.includes('/my activity/gmail/'))        return 'Gmail Activity';
      if (f.includes('/my activity/ads/'))          return 'Google Ads Activity';
      if (f.includes('/my activity/developers/'))   return 'Google Developers Activity';
      if (f.includes('/my activity/flights/'))      return 'Google Flights Activity';
      if (f.includes('/my activity/help/'))         return 'Google Help Activity';
      if (f.includes('/my activity/shopping/'))     return 'Google Shopping Activity';
      if (f.includes('/my activity/video search/')) return 'Google Video Search';
      if (f.includes('/my activity/takeout/'))      return 'Google Takeout Activity';
      if (f.includes('watch-history'))              return 'YouTube Watch History';
      if (f.includes('search-history'))            return 'YouTube Search History';
      return 'Google Activity';
    }
  
    // ── Router: parse(text, filename) ───────────────────────────────────────────
  
    return {
      id: 'google',
      label: 'Google',
      icon: '🔍',
      color: '#4285f4',
      acceptType: 'folder',
      instructions: 'Select your Google Takeout export folder — the folder that contains Takeout, Takeout-2, etc. If you have multiple Google accounts, load each account folder one at a time.',
  
      parse(text, filename) {
        if (!filename || typeof text !== 'string') return [];
  
        const f     = filename.toLowerCase().replace(/\\/g, '/');
        const fname = f.split('/').pop();   // basename, already lowercase
  
        // Stamp helper — called on the result of every sub-parser
        const stamp = events => events.map(e => Object.assign(e, {
          source:      'google',
          sourceLabel: 'Google',
          sourceIcon:  '🔍',
          sourceColor: '#4285f4',
        }));
  
        // ── My Activity HTML (all subdirectories) ────────────────────────────────
        if ((fname === 'my activity.html' || fname === 'myactivity.html')
            && f.includes('/my activity/')) {
          return stamp(parseMDLActivityHTML(text, sourceLabel(filename)));
        }
  
        // ── YouTube watch / search history HTML ─────────────────────────────────
        if (fname === 'watch-history.html' || fname === 'search-history.html') {
          return stamp(parseMDLActivityHTML(text, sourceLabel(filename)));
        }
  
        // ── Calendar ICS ─────────────────────────────────────────────────────────
        if (fname.endsWith('.ics')) {
          return stamp(parseICS(text));
        }
  
        // ── Google Tasks JSON ─────────────────────────────────────────────────────
        if (fname === 'tasks.json' && f.includes('/tasks/')) {
          return stamp(parseTasks(text));
        }
  
        // ── Timeline Settings JSON ────────────────────────────────────────────────
        if (fname === 'settings.json' && f.includes('/timeline/')) {
          return stamp(parseTimelineSettings(text));
        }
  
        // ── Access Log CSV ────────────────────────────────────────────────────────
        if (f.includes('/access log activity/') && fname.startsWith('activities')) {
          return stamp(parseAccessLog(text));
        }
  
        // ── Google Pay CSV (both account naming variants) ─────────────────────────
        if (f.includes('/google pay/') && fname.endsWith('.csv')
            && (fname.includes('money remittances') || fname.includes('money sends'))) {
          return stamp(parseGooglePay(text));
        }
  
        // ── Google Shopping reviews ───────────────────────────────────────────────
        if (fname === 'merchant reviews.csv') return stamp(parseShoppingReviews(text, 'merchant'));
        if (fname === 'product reviews.csv')  return stamp(parseShoppingReviews(text, 'product'));
  
        // ── YouTube comments ──────────────────────────────────────────────────────
        if (fname === 'comments.csv' && f.includes('youtube')) {
          return stamp(parseYouTubeComments(text));
        }
  
        // ── YouTube live chats ────────────────────────────────────────────────────
        if (fname === 'live chats.csv' && f.includes('youtube')) {
          return stamp(parseYouTubeLiveChats(text));
        }
  
        // ── YouTube playlists.csv ─────────────────────────────────────────────────
        if (fname === 'playlists.csv' && f.includes('youtube')) {
          return stamp(parseYouTubePlaylists(text));
        }
  
        // ── YouTube playlist video files (*-videos.csv / * videos.csv) ────────────
        //    e.g. "Watch later videos.csv", "beats-videos.csv", "Tunes-videos.csv"
        if (f.includes('youtube') && fname.endsWith('.csv')
            && (fname.endsWith('-videos.csv') || fname.endsWith(' videos.csv'))) {
          // Recover original-case playlist name from filename
          const origFname = filename.split('/').pop().split('\\').pop();
          const playlistName = origFname
            .replace(/-[Vv]ideos\.csv$/, '')
            .replace(/ [Vv]ideos\.csv$/, '');
          return stamp(parseYouTubePlaylistVideos(text, playlistName));
        }
  
        // ── Google Account Change History HTML ────────────────────────────────────
        if (fname.endsWith('.changehistory.html')) {
          return stamp(parseChangeHistory(text));
        }
  
        return [];
      }
    };
  })();