/**
 * Metro Bank CSV Parser — Time Capsule
 *
 * Parses Metro Bank transaction CSV exports.
 * Expected columns (no header row guaranteed):
 *   0: Date         DD/MM/YYYY
 *   1: Description  Transaction description / merchant name
 *   2: Type         e.g. CARD PAYMENT, DIRECT DEBIT, FASTER PAYMENT, etc.
 *   3: Money In     Credit amount (may be empty)
 *   4: Money Out    Debit amount (may be empty)
 *   5: Balance      Running balance
 *
 * Rows whose first column doesn't match DD/MM/YYYY are skipped (metadata lines).
 */

const MetroBankParser = {
    id: 'metrobank',
    label: 'Metro Bank',
    icon: '🏦',
    color: '#CC0000',
    acceptType: 'csv',   // signals to the UI to use a file picker, not a folder picker

    instructions: `
    <ol>
      <li>Log in to your Metro Bank online banking at <strong>metrobankonline.co.uk</strong></li>
      <li>Go to <strong>Accounts → Statements</strong></li>
      <li>Choose the date range — select <strong>the widest range available</strong> for the best results</li>
      <li>Click <strong>Export / Download</strong> and choose <strong>CSV</strong> format</li>
      <li>If you have multiple statement files, use the script we used earlier to merge them, or upload one at a time</li>
      <li>Select your CSV file above</li>
    </ol>
  `,

    // ─── Entry point ───────────────────────────────────────────────────────────
    /** Called with the raw CSV text string */
    parseCSV(csvText) {
        const lines = csvText.split(/\r?\n/);
        const events = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const cols = this.splitCSVLine(line);
            if (cols.length < 5) continue;

            // Only process rows whose first column is a valid DD/MM/YYYY date
            const dateStr = cols[0].trim().replace(/^"|"$/g, '');
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) continue;

            const desc = (cols[1] || '').trim().replace(/^"|"$/g, '');
            const type = (cols[2] || '').trim().replace(/^"|"$/g, '');
            const moneyIn = this.parseAmount(cols[3]);
            const moneyOut = this.parseAmount(cols[4]);
            // cols[5] is balance — we don't use it for events

            const ts = this.parseDateUK(dateStr);
            if (!ts) continue;

            const isCredit = moneyIn > 0;
            const amount = isCredit ? moneyIn : moneyOut;
            const category = this.categorise(desc, type, isCredit);
            const icon = this.iconFor(category, isCredit);
            const title = this.buildTitle(desc, type, amount, isCredit);

            events.push({
                source: this.id,
                sourceLabel: this.label,
                sourceIcon: this.icon,
                sourceColor: this.color,
                type: 'transaction',
                icon,
                category,
                title,
                description: type ? type.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '',
                timestamp: ts,
                date: new Date(ts * 1000),
                dataInsight: isCredit
                    ? 'Your bank records every payment in — whether it\'s your salary, a transfer, or a refund — along with the exact amount and date. This data maps your income history over years.'
                    : 'Your bank records every penny you spend — the merchant name, exact amount, transaction type and date. Combined over years this reveals your habits, lifestyle and recurring commitments.',
            });
        }

        return events;
    },

    // ─── CSV line splitting ────────────────────────────────────────────────────
    /** Handles quoted fields that may contain commas */
    splitCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    },

    // ─── Helpers ───────────────────────────────────────────────────────────────
    parseAmount(str) {
        if (!str) return 0;
        const n = parseFloat(str.replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? 0 : n;
    },

    /** Convert DD/MM/YYYY to Unix seconds (noon UTC to avoid timezone edge cases) */
    parseDateUK(dateStr) {
        const [dd, mm, yyyy] = dateStr.split('/').map(Number);
        if (!dd || !mm || !yyyy) return null;
        const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
        return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
    },

    buildTitle(desc, type, amount, isCredit) {
        const amtStr = amount > 0 ? ` £${amount.toFixed(2)}` : '';
        const cleanDesc = desc || type || 'Transaction';
        if (isCredit) return `Received${amtStr} — ${cleanDesc}`;
        return `Spent${amtStr} at ${cleanDesc}`;
    },
};
