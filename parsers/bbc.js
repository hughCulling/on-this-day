/**
 * BBC Data Export Parser — Time Capsule
 *
 * Parses all four CSV files from a BBC account data export:
 *
 *   Activity-from-*.csv         — page visits, media playback, searches, clicks (~5k rows)
 *   BBC-Account-information.csv — account registration & update dates
 *   Interaction.csv             — bookmarks, saves, ratings, votes (~200 rows)
 *   Messages-from-the-BBC.csv  — emails/notifications sent by the BBC
 *
 * Timestamp fields:
 *   Activity:    "Visit Start Time UTC" [0],  "Event Start Time UTC" [23]
 *   Account:     "Registration date" [0],      "Account last update date" [2]
 *   Interaction: "Date/Time" [3]
 *   Messages:    "Date" [0]
 */

const BBCParser = (() => {

    const SOURCE       = 'bbc';
    const SOURCE_LABEL = 'BBC';
    const SOURCE_COLOR = '#BB1919'; // BBC red
    const SOURCE_ICON  = '📺';
  
    let _eventId = 0;
    function makeId() { return `bbc_${++_eventId}`; }
  
    // ─── Timestamp parsing ────────────────────────────────────────────────────
    // BBC uses UTC strings like "2021-06-15 14:32:00" or "15/06/2021 14:32"
    function toSeconds(str) {
      if (!str || typeof str !== 'string') return null;
      const s = str.trim();
      if (!s) return null;
  
      // Try direct parse first (handles ISO and many others)
      let d = new Date(s);
      if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  
      // "DD/MM/YYYY HH:MM:SS" or "DD/MM/YYYY HH:MM"
      const dmyMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})([ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
      if (dmyMatch) {
        const [, dd, mm, yyyy, , hh = '00', min = '00', sec = '00'] = dmyMatch;
        d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}Z`);
        if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
      }
  
      // "YYYY-MM-DD HH:MM:SS" with space (not T)
      const isoSpace = s.replace(' ', 'T') + (s.includes(':') && s.split(':').length < 3 ? ':00Z' : 'Z');
      d = new Date(isoSpace);
      if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  
      return null;
    }
  
    function makeEvent({ type, icon, title, description, timestamp, category, dataInsight }) {
      const ts = toSeconds(timestamp);
      if (!ts) return null;
      return {
        id: makeId(),
        source: SOURCE,
        sourceLabel: SOURCE_LABEL,
        sourceColor: SOURCE_COLOR,
        sourceIcon: SOURCE_ICON,
        type,
        icon,
        title: title || 'BBC activity',
        description: description || undefined,
        timestamp: ts,
        date: new Date(ts * 1000),
        category,
        dataInsight,
      };
    }
  
    // ─── CSV splitting ────────────────────────────────────────────────────────
    function splitLine(line) {
      const result = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
          result.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      result.push(cur);
      return result;
    }
  
    function parseRows(text) {
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) return { headers: [], rows: [] };
      const headers = splitLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = splitLine(line).map(c => c.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });
        rows.push(row);
      }
      return { headers, rows };
    }
  
    // ─── Activity file ────────────────────────────────────────────────────────
    // Columns used:
    //   Visit Start Time UTC [0]    — primary timestamp
    //   Event Start Time UTC [23]   — secondary timestamp (media events)
    //   Destination [2]             — section/area of BBC visited
    //   URL [3]                     — page URL
    //   Page Name [24]              — clean page name
    //   Page Title [25]             — full page title
    //   Device Type [6]             — desktop / mobile / tablet
    //   Operating System [7]
    //   Web Browser [8]
    //   Visitor City [19]
    //   Visitor Country [21]
    //   Keywords In Search [31]     — search queries
    //   Media Content [32]          — media title
    //   Media Content Type [33]     — audio / video
    //   Media Content Action [34]   — play / pause / complete etc
    //   Playback Time [35]          — seconds of playback
    //   Clicks Made [29]
    //   Click Section [30]
    //   App Name [28]               — iPlayer, Sounds, News etc
    function parseActivity(text) {
      const { rows } = parseRows(text);
      const events = [];
  
      for (const row of rows) {
        const visitTime  = row['Visit Start Time UTC'];
        const eventTime  = row['Event Start Time UTC'];
        const destination = row['Destination'] || '';
        const url        = row['URL'] || '';
        const pageName   = row['Page Name'] || '';
        const pageTitle  = row['Page Title'] || '';
        const search     = row['Keywords In Search'] || '';
        const media      = row['Media Content'] || '';
        const mediaType  = row['Media Content Type'] || '';
        const mediaAction = row['Media Content Action'] || '';
        const playback   = row['Playback Time'] || '';
        const device     = row['Device Type'] || '';
        const os         = row['Operating System and Version'] || '';
        const browser    = row['Web Browser and Version'] || '';
        const city       = row['Visitor City'] || '';
        const country    = row['Visitor Country'] || '';
        const appName    = row['App Name'] || '';
        const clicks     = row['Clicks Made'] || '';
        const clickSection = row['Click Section'] || '';
  
        // Build a readable location/device string for dataInsight
        const locationStr = [city, country].filter(Boolean).join(', ');
        const deviceStr   = [device, os, browser].filter(Boolean).join(' / ');
  
        // ── Visit event (Visit Start Time UTC) ─────────────────────────────
        if (visitTime) {
          // Determine what kind of visit this was
          const isSearch  = Boolean(search);
          const isMedia   = Boolean(media);
          const label     = pageTitle || pageName || destination || appName || 'BBC page';
  
          let icon, type, title, category;
  
          if (isSearch) {
            icon     = '🔍';
            type     = 'search';
            title    = `Searched BBC for: "${search}"`;
            category = 'Search';
          } else if (isMedia && mediaAction) {
            const actionEmoji = {
              'play':     '▶️',
              'pause':    '⏸️',
              'complete': '✅',
              'start':    '▶️',
              'stop':     '⏹️',
              'buffer':   '⏳',
              'seek':     '⏩',
              'error':    '⚠️',
            }[mediaAction.toLowerCase()] || '🎬';
            icon     = actionEmoji;
            type     = 'media_action';
            title    = `${mediaAction} — ${media}`;
            category = mediaType.toLowerCase().includes('audio') ? 'BBC Sounds' : 'BBC iPlayer';
          } else if (appName && appName.toLowerCase().includes('sound')) {
            icon     = '🎵';
            type     = 'sounds_visit';
            title    = `Visited BBC Sounds: ${label}`;
            category = 'BBC Sounds';
          } else if (appName && appName.toLowerCase().includes('iplayer')) {
            icon     = '📺';
            type     = 'iplayer_visit';
            title    = `Visited BBC iPlayer: ${label}`;
            category = 'BBC iPlayer';
          } else if (appName && appName.toLowerCase().includes('news')) {
            icon     = '📰';
            type     = 'news_visit';
            title    = `Read BBC News: ${label}`;
            category = 'BBC News';
          } else {
            icon     = '🌐';
            type     = 'page_visit';
            title    = `Visited ${label}`;
            category = 'BBC Activity';
          }
  
          const descParts = [];
          if (locationStr) descParts.push(`Location: ${locationStr}`);
          if (deviceStr)   descParts.push(`Device: ${deviceStr}`);
          if (url)         descParts.push(`URL: ${url}`);
  
          const e = makeEvent({
            type,
            icon,
            title,
            description: descParts.join(' · ') || undefined,
            timestamp: visitTime,
            category,
            dataInsight:
              `The BBC records every page visit with a precise UTC timestamp, your device type (${device || 'unknown'}), browser, operating system, internet service provider, and approximate location (${locationStr || 'unknown'}). This data is stored from the moment you first used a BBC service.`,
          });
          if (e) events.push(e);
        }
  
        // ── Event time (Event Start Time UTC) — separate from visit ──────────
        // Only emit if different field has a value and it represents a distinct
        // moment (e.g. when media actually started, separate from page load)
        if (eventTime && eventTime !== visitTime && media) {
          const e = makeEvent({
            type: 'media_event',
            icon: '🎬',
            title: `Media event — ${media || 'BBC content'}`,
            description: [mediaAction, mediaType, playback ? `${playback}s played` : ''].filter(Boolean).join(' · ') || undefined,
            timestamp: eventTime,
            category: mediaType.toLowerCase().includes('audio') ? 'BBC Sounds' : 'BBC iPlayer',
            dataInsight:
              'The BBC records a separate Event Start Time for media interactions — capturing the exact moment playback actions occur, distinct from when the page was loaded.',
          });
          if (e) events.push(e);
        }
      }
  
      return events;
    }
  
    // ─── Account information file ─────────────────────────────────────────────
    // Columns: Registration date [0], Account last update date [2]
    // Plus demographic data stored: Gender, DOB, Postcode, Sociodemographic category etc
    function parseAccountInfo(text) {
      const { rows } = parseRows(text);
      const events = [];
  
      for (const row of rows) {
        const regDate    = row['Registration date'];
        const updateDate = row['Account last update date'];
        const site       = row['Site of registration'] || '';
        const nation     = row['Nation'] || '';
        const socioGroup = row['Sociodemographic group'] || '';
        const socioType  = row['Sociodemographic type'] || '';
        const socioCategory = row['Sociodemographic category'] || '';
  
        // ── Registration date ───────────────────────────────────────────────
        const e1 = makeEvent({
          type: 'account_registered',
          icon: '📝',
          title: `Registered a BBC account${site ? ` on ${site}` : ''}`,
          description: [nation, socioGroup, socioType, socioCategory].filter(Boolean).join(' · ') || undefined,
          timestamp: regDate,
          category: 'Account',
          dataInsight:
            'The BBC stores your registration date and site, along with significant demographic information: your gender, date of birth, postcode, hometown, sociodemographic category/group/type, nation, audience viewing region, and constituency. This demographic profile is used to understand and segment their audience.',
        });
        if (e1) events.push(e1);
  
        // ── Account last update date ────────────────────────────────────────
        const e2 = makeEvent({
          type: 'account_updated',
          icon: '✏️',
          title: 'BBC account was last updated',
          timestamp: updateDate,
          category: 'Account',
          dataInsight:
            'The BBC records the last time your account information was modified.',
        });
        if (e2) events.push(e2);
      }
  
      return events;
    }
  
    // ─── Interaction file ─────────────────────────────────────────────────────
    // Columns: Activity [0], URL/Application/Section [1], Title/item type [2], Date/Time [3]
    function parseInteraction(text) {
      const { rows } = parseRows(text);
      const events = [];
  
      for (const row of rows) {
        const activity = row['Activity'] || '';
        const target   = row['URL/Application/Section'] || '';
        const title    = row['Title/item type'] || '';
        const dateTime = row['Date/Time'];
  
        const actLower = activity.toLowerCase();
  
        let icon, type, eventTitle, category;
  
        if (actLower.includes('bookmark') || actLower.includes('save')) {
          icon       = '🔖';
          type       = 'bookmark';
          eventTitle = `Bookmarked: ${title || target}`;
          category   = 'Interactions';
        } else if (actLower.includes('rating') || actLower.includes('rate')) {
          icon       = '⭐';
          type       = 'rating';
          eventTitle = `Rated: ${title || target}`;
          category   = 'Interactions';
        } else if (actLower.includes('vote')) {
          icon       = '🗳️';
          type       = 'vote';
          eventTitle = `Voted: ${title || target}`;
          category   = 'Interactions';
        } else if (actLower.includes('follow') || actLower.includes('subscri')) {
          icon       = '➕';
          type       = 'follow';
          eventTitle = `Followed/subscribed: ${title || target}`;
          category   = 'Interactions';
        } else if (actLower.includes('comment')) {
          icon       = '💬';
          type       = 'comment';
          eventTitle = `Commented on: ${title || target}`;
          category   = 'Interactions';
        } else if (actLower.includes('share')) {
          icon       = '↗️';
          type       = 'share';
          eventTitle = `Shared: ${title || target}`;
          category   = 'Interactions';
        } else if (actLower.includes('search')) {
          icon       = '🔍';
          type       = 'search_interaction';
          eventTitle = `Searched: ${title || target}`;
          category   = 'Search';
        } else {
          icon       = '🖱️';
          type       = 'interaction';
          eventTitle = activity ? `${activity}: ${title || target}` : `Interacted with: ${title || target}`;
          category   = 'Interactions';
        }
  
        const e = makeEvent({
          type,
          icon,
          title: eventTitle,
          description: target !== eventTitle ? target : undefined,
          timestamp: dateTime,
          category,
          dataInsight:
            'The BBC records specific interactions you take — bookmarks, ratings, votes, follows and comments — with exact timestamps. This reveals your content preferences and engagement patterns in detail.',
        });
        if (e) events.push(e);
      }
  
      return events;
    }
  
    // ─── Messages from the BBC ────────────────────────────────────────────────
    // Columns: Date [0], Activity [1], From Email [2], Email Subject [3],
    //          Browser [4], Client [5], Operating System [6], Device [7]
    function parseMessages(text) {
      const { rows } = parseRows(text);
      const events = [];
  
      for (const row of rows) {
        const date     = row['Date'];
        const activity = row['Activity'] || 'Message';
        const subject  = row['Email Subject'] || '';
        const client   = row['Client'] || '';
        const device   = row['Device'] || '';
        const os       = row['Operating System'] || '';
  
        const actLower = activity.toLowerCase();
        let icon = '📧';
        if (actLower.includes('sms') || actLower.includes('text')) icon = '📱';
        else if (actLower.includes('push') || actLower.includes('notif'))  icon = '🔔';
  
        const e = makeEvent({
          type: 'bbc_message',
          icon,
          title: subject ? `BBC message: "${subject}"` : `BBC sent you a message (${activity})`,
          description: [client, device, os].filter(Boolean).join(' · ') || undefined,
          timestamp: date,
          category: 'Messages',
          dataInsight:
            'The BBC logs every communication they send you — emails, push notifications, SMS — including the subject, delivery channel, your device, browser, and operating system at the time.',
        });
        if (e) events.push(e);
      }
  
      return events;
    }
  
    // ─── Entry point ──────────────────────────────────────────────────────────
    // Called once per CSV file with (text, filename)
    function parseCSV(text, filename = '') {
      const name = (filename || '').toLowerCase();
  
      if (name.includes('activity'))    return parseActivity(text);
      if (name.includes('account'))     return parseAccountInfo(text);
      if (name.includes('interaction')) return parseInteraction(text);
      if (name.includes('messages'))    return parseMessages(text);
  
      // Unknown BBC file — try to find any date/time column and extract what we can
      console.warn(`[BBC] Unrecognised file: ${filename}`);
      return [];
    }
  
    return {
      id: 'bbc',
      label: 'BBC',
      icon: '📺',
      color: SOURCE_COLOR,
      acceptType: 'csv',
      parseCSV,
      instructions: `
        <ol>
          <li>Go to <strong>myaccount.bbc.co.uk → Your data → Download your data</strong></li>
          <li>Request your data export — the BBC will email you when it's ready</li>
          <li>Download and unzip the archive</li>
          <li>Select <strong>all the CSV files</strong> inside (hold Cmd to select multiple files)</li>
        </ol>
      `,
    };
  })();