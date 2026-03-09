/**
 * Anthropic / Claude Data Export Parser — Time Capsule
 *
 * Every timestamp and every piece of stored data surfaces as an event.
 *
 * Full field inventory from export structure:
 *
 * conversations.json → array of:
 *   uuid, name, summary, created_at*, updated_at*, account.uuid
 *   chat_messages[] →
 *     uuid, sender, created_at*, updated_at*, text
 *     attachments[] → file_name, file_size, file_type, extracted_content
 *     files[]       → file_name
 *     content[]     →
 *       type              ("text" or "thinking")
 *       text
 *       thinking          (extended thinking text, only on thinking blocks)
 *       start_timestamp*
 *       stop_timestamp*
 *       flags
 *       cut_off           (boolean — generation was cut short)
 *       citations[]
 *       summaries[]       → summary (text)
 *       alternative_display_type
 *
 * users.json → uuid, full_name, email_address, verified_phone_number
 *   (no timestamps — not surfaced as events)
 *
 * * = timestamp field → becomes an event
 */

const AnthropicParser = (() => {

    const SOURCE       = 'anthropic';
    const SOURCE_LABEL = 'Claude';
    const SOURCE_COLOR = '#D97757';
    const SOURCE_ICON  = '🤖';
  
    let _eventId = 0;
    function makeId() { return `anthropic_${++_eventId}`; }
  
    function toSeconds(str) {
      if (!str) return null;
      const d = new Date(str);
      if (isNaN(d.getTime())) return null;
      const ts = Math.floor(d.getTime() / 1000);
      if (ts < 946684800 || ts > 2e9) return null;
      return ts;
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
        title: title || 'Claude interaction',
        description: description || undefined,
        timestamp: ts,
        date: new Date(ts * 1000),
        category,
        dataInsight,
      };
    }
  
    function clean(str) {
      if (!str || typeof str !== 'string') return '';
      return str.replace(/\s+/g, ' ').trim();
    }
  
    // ─── Parser ────────────────────────────────────────────────────────────────
    function parseConversations(json) {
      if (!Array.isArray(json)) return [];
      const events = [];
      function push(e) { if (e) events.push(e); }
  
      for (const convo of json) {
        const name = convo.name || 'Unnamed conversation';
  
        // ── Conversation: created_at ───────────────────────────────────────────
        push(makeEvent({
          type: 'conversation_created',
          icon: '💬',
          title: `Started a Claude conversation: "${name}"`,
          timestamp: convo.created_at,
          category: 'AI',
          dataInsight:
            'Anthropic stores the exact moment you started this conversation, along with its name.',
        }));
  
        // ── Conversation: updated_at ───────────────────────────────────────────
        push(makeEvent({
          type: 'conversation_updated',
          icon: '🔄',
          title: `Conversation updated: "${name}"`,
          timestamp: convo.updated_at,
          category: 'AI',
          dataInsight:
            'Anthropic stores the last time this conversation record was updated.',
        }));
  
        // ── Messages ───────────────────────────────────────────────────────────
        const messages = Array.isArray(convo.chat_messages) ? convo.chat_messages : [];
  
        for (const msg of messages) {
          const sender      = msg.sender || 'unknown';
          const isHuman     = sender === 'human';
          const isAssistant = sender === 'assistant' || sender === 'ai';
  
          const contentBlocks  = Array.isArray(msg.content)      ? msg.content      : [];
          const attachments    = Array.isArray(msg.attachments)   ? msg.attachments  : [];
          const files          = Array.isArray(msg.files)         ? msg.files        : [];
  
          const rawText = typeof msg.text === 'string' ? clean(msg.text) : '';
  
          if (isHuman) {
  
            // ── Human message: created_at ────────────────────────────────────
            push(makeEvent({
              type: 'human_message_created',
              icon: '✍️',
              title: `Sent a message in "${name}"`,
              description: rawText,
              timestamp: msg.created_at,
              category: 'AI',
              dataInsight:
                'Anthropic stores the full text and timestamp of every message you send to Claude.',
            }));
  
            // ── Human message: updated_at ────────────────────────────────────
            push(makeEvent({
              type: 'human_message_updated',
              icon: '✏️',
              title: `Human message record updated in "${name}"`,
              description: rawText,
              timestamp: msg.updated_at,
              category: 'AI',
              dataInsight:
                'Anthropic stores an updated_at timestamp on every message, recording when it was last modified.',
            }));
  
            // ── Attachments ───────────────────────────────────────────────────
            // Attachments have no timestamp of their own — we use the message timestamp
            for (const att of attachments) {
              const sizeStr = att.file_size
                ? ` (${(att.file_size / 1024).toFixed(1)}KB)`
                : '';
              push(makeEvent({
                type: 'attachment_sent',
                icon: '📎',
                title: `Sent attachment in "${name}": ${att.file_name || 'unknown file'}`,
                description: att.file_type
                  ? `Type: ${att.file_type}${sizeStr}${att.extracted_content ? ' — content was extracted and stored by Anthropic' : ''}`
                  : undefined,
                timestamp: msg.created_at,
                category: 'AI',
                dataInsight:
                  'Anthropic stores every file you attach to a message — including the file name, type, size, and the full extracted text content of the file. This means the contents of documents you share with Claude are retained in your export.',
              }));
            }
  
            // ── Files ─────────────────────────────────────────────────────────
            for (const f of files) {
              push(makeEvent({
                type: 'file_in_message',
                icon: '🗂️',
                title: `File referenced in message in "${name}": ${f.file_name || 'unknown'}`,
                timestamp: msg.created_at,
                category: 'AI',
                dataInsight:
                  'Anthropic records file references attached to messages.',
              }));
            }
  
            // ── Content blocks ────────────────────────────────────────────────
            contentBlocks.forEach((block, i) => {
              const blockLabel = contentBlocks.length > 1 ? ` (block ${i + 1})` : '';
              const blockType  = block.type || 'text';
              const blockText  = clean(block.text || '');
              const thinkingText = clean(block.thinking || '');
  
              // start_timestamp
              push(makeEvent({
                type: 'human_content_start',
                icon: '⌨️',
                title: `Message input started in "${name}"${blockLabel}`,
                description: blockText || rawText,
                timestamp: block.start_timestamp,
                category: 'AI',
                dataInsight:
                  'Anthropic records a start_timestamp on each content block.',
              }));
  
              // stop_timestamp
              push(makeEvent({
                type: 'human_content_stop',
                icon: '📨',
                title: `Message input completed in "${name}"${blockLabel}`,
                description: blockText || rawText,
                timestamp: block.stop_timestamp,
                category: 'AI',
                dataInsight:
                  'Anthropic records the exact moment you finished submitting this message block.',
              }));
  
              // cut_off flag — note it on the stop event if true
              if (block.cut_off === true) {
                push(makeEvent({
                  type: 'content_cut_off',
                  icon: '✂️',
                  title: `Message block was cut off in "${name}"${blockLabel}`,
                  timestamp: block.stop_timestamp || block.start_timestamp,
                  category: 'AI',
                  dataInsight:
                    'Anthropic records a cut_off flag when a content block was truncated.',
                }));
              }
            });
  
          } else if (isAssistant) {
  
            // ── Assistant message: created_at ────────────────────────────────
            push(makeEvent({
              type: 'assistant_message_created',
              icon: '🤖',
              title: `Claude responded in "${name}"`,
              description: rawText,
              timestamp: msg.created_at,
              category: 'AI',
              dataInsight:
                'Anthropic stores the full text and timestamp of every response Claude generates.',
            }));
  
            // ── Assistant message: updated_at ────────────────────────────────
            push(makeEvent({
              type: 'assistant_message_updated',
              icon: '🔁',
              title: `Claude response record updated in "${name}"`,
              description: rawText,
              timestamp: msg.updated_at,
              category: 'AI',
              dataInsight:
                'Anthropic stores an updated_at on every assistant message.',
            }));
  
            // ── Content blocks ────────────────────────────────────────────────
            contentBlocks.forEach((block, i) => {
              const blockLabel   = contentBlocks.length > 1 ? ` (block ${i + 1})` : '';
              const blockType    = block.type || 'text';
              const isThinking   = blockType === 'thinking';
              const blockText    = clean(block.text || '');
              const thinkingText = clean(block.thinking || '');
  
              // start_timestamp
              push(makeEvent({
                type: isThinking ? 'thinking_started' : 'generation_started',
                icon: isThinking ? '🧠' : '⚙️',
                title: isThinking
                  ? `Claude started thinking in "${name}"${blockLabel}`
                  : `Claude started generating a response in "${name}"${blockLabel}`,
                description: isThinking ? thinkingText : blockText,
                timestamp: block.start_timestamp,
                category: 'AI',
                dataInsight: isThinking
                  ? 'Anthropic stores Claude\'s internal extended thinking — the reasoning process Claude works through before responding. This is stored with its own start and stop timestamps.'
                  : 'Anthropic records the exact moment Claude began generating this response block.',
              }));
  
              // stop_timestamp
              push(makeEvent({
                type: isThinking ? 'thinking_finished' : 'generation_finished',
                icon: isThinking ? '💡' : '✅',
                title: isThinking
                  ? `Claude finished thinking in "${name}"${blockLabel}`
                  : `Claude finished generating a response in "${name}"${blockLabel}`,
                description: isThinking ? thinkingText : blockText,
                timestamp: block.stop_timestamp,
                category: 'AI',
                dataInsight: isThinking
                  ? 'Anthropic stores when Claude\'s thinking block completed, alongside the full thinking text.'
                  : 'Anthropic records the exact moment Claude finished generating this response.',
              }));
  
              // cut_off flag
              if (block.cut_off === true) {
                push(makeEvent({
                  type: 'generation_cut_off',
                  icon: '✂️',
                  title: `Claude response was cut off in "${name}"${blockLabel}`,
                  timestamp: block.stop_timestamp || block.start_timestamp,
                  category: 'AI',
                  dataInsight:
                    'Anthropic records when a response block was cut short — capturing incomplete generations.',
                }));
              }
  
              // summaries — no timestamp of their own, emitted at block stop time
              const summaries = Array.isArray(block.summaries) ? block.summaries : [];
              if (summaries.length > 0 && (block.stop_timestamp || block.start_timestamp)) {
                const summaryTexts = summaries.map(s => s.summary).filter(Boolean).join(' | ');
                push(makeEvent({
                  type: 'block_summarised',
                  icon: '📋',
                  title: `Anthropic auto-summarised a response block in "${name}"${blockLabel}`,
                  description: summaryTexts,
                  timestamp: block.stop_timestamp || block.start_timestamp,
                  category: 'AI',
                  dataInsight:
                    'Anthropic automatically generates summaries of response blocks and stores them alongside the full content. These summaries are used internally to manage long conversations.',
                }));
              }
            });
          }
        }
      }
  
      return events;
    }
  
    // ─── Entry point ──────────────────────────────────────────────────────────
    function parse(files) {
      _eventId = 0;
      const allEvents = [];
  
      for (const { path, json } of files) {
        const p = path.replace(/\\/g, '/').toLowerCase();
        try {
          if (p.endsWith('conversations.json')) {
            allEvents.push(...parseConversations(json));
          }
          // projects.json — always empty
          // users.json — uuid, name, email, phone; no timestamps
        } catch (err) {
          console.warn(`[Anthropic] Error parsing ${path}:`, err);
        }
      }
  
      return allEvents;
    }
  
    return {
      id: 'anthropic',
      label: 'Claude',
      icon: '🤖',
      color: SOURCE_COLOR,
      parse,
      instructions: `
        <ol>
          <li>Go to <strong>claude.ai → Settings → Privacy &amp; data → Export data</strong></li>
          <li>Click <strong>Request data export</strong> — Anthropic will email you when it's ready</li>
          <li>Download and <strong>unzip</strong> the archive</li>
          <li>Click below and select the <strong>unzipped folder</strong> (it will contain a <code>data-…-batch-0000</code> subfolder)</li>
        </ol>
      `,
    };
  })();