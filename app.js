/**
 * Time Capsule — Main App Logic
 */

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    allEvents: [],          // All loaded events across all platforms
    activeFilters: new Set(), // Active platform filters
    selectedDate: new Date(), // Currently selected date
    loadedPlatforms: {},    // platform id -> { label, icon, color, count }
};

const PARSERS = {
    facebook: FacebookParser,
    instagram: InstagramParser,
    snapchat: SnapchatParser,
    metrobank: MetroBankParser,
    google: GoogleParser,
    anthropic: AnthropicParser,
    bbc: BBCParser,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const screens = {
    landing: document.getElementById('screen-landing'),
    upload: document.getElementById('screen-upload'),
    results: document.getElementById('screen-results'),
};

// ─── Screen navigation ────────────────────────────────────────────────────────
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// ─── Landing ─────────────────────────────────────────────────────────────────
document.getElementById('btn-get-started').addEventListener('click', () => {
    showScreen('upload');
});

document.getElementById('btn-back-upload').addEventListener('click', () => {
    showScreen('landing');
});

document.getElementById('btn-back-results').addEventListener('click', () => {
    showScreen('upload');
});

// ─── Platform selection ───────────────────────────────────────────────────────
let selectedPlatform = null;

document.querySelectorAll('.platform-card:not(.coming-soon)').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.platform-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedPlatform = card.dataset.platform;
        showUploadPanel(selectedPlatform);
    });
});

function showUploadPanel(platformId) {
    const parser = PARSERS[platformId];
    if (!parser) return;

    const panel = document.getElementById('upload-panel');
    const instruction = document.getElementById('upload-instruction');
    const isCsv = parser.acceptType === 'csv';

    instruction.innerHTML = `
    <div class="instruction-header">
      <span class="platform-icon-lg">${parser.icon}</span>
      <h3>How to get your ${parser.label} data</h3>
    </div>
    ${parser.instructions}
  `;

    // Switch upload zone label based on type
    document.querySelector('.upload-primary').textContent = isCsv
        ? 'Click to select your CSV file'
        : 'Click to select your export folder';
    document.querySelector('.upload-secondary').textContent = isCsv
        ? 'or drag and drop the CSV file here'
        : 'or drag and drop the folder here';

    // Toggle input mode: CSV = single file, JSON = folder
    if (isCsv) {
        folderInput.removeAttribute('webkitdirectory');
        folderInput.setAttribute('multiple', '');
        folderInput.setAttribute('accept', '.csv');
    } else {
        folderInput.setAttribute('webkitdirectory', '');
        folderInput.setAttribute('multiple', '');
        folderInput.setAttribute('accept', '.json');
    }

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── File upload ──────────────────────────────────────────────────────────────
const folderInput = document.getElementById('folder-input');
const uploadZone = document.getElementById('upload-zone');

uploadZone.addEventListener('click', () => folderInput.click());

uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
});

folderInput.addEventListener('change', e => {
    handleFiles(e.target.files);
    // Reset input so same folder can be re-selected
    folderInput.value = '';
});

async function handleFiles(fileList) {
    if (!selectedPlatform) {
        alert('Please select a platform first.');
        return;
    }

    const parser = PARSERS[selectedPlatform];
    const isCsv = parser.acceptType === 'csv';

    // Show progress
    const progress = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    progress.classList.remove('hidden');
    uploadZone.classList.add('hidden');

    let newEvents = [];

    if (isCsv) {
        // ── CSV path ──────────────────────────────────────────────────────────
        const csvFiles = Array.from(fileList).filter(
            f => f.name.endsWith('.csv') || f.name.endsWith('.CSV')
        );
        if (csvFiles.length === 0) {
            alert('No CSV file found. Please select a .csv file.');
            progress.classList.add('hidden');
            uploadZone.classList.remove('hidden');
            return;
        }
        let done = 0;
        for (const file of csvFiles) {
            try {
                const text = await readFileAsText(file);
                progressText.textContent = `Parsing ${file.name}…`;
                await sleep(0);
                const events = parser.parseCSV(text, file.name);                newEvents.push(...events);
            } catch (err) {
                console.warn(`Could not parse ${file.name}:`, err);
            }
            done++;
            progressFill.style.width = `${Math.round((done / csvFiles.length) * 100)}%`;
        }
    } else {
        // ── JSON or HTML folder path ───────────────────────────────────────────
        const isGoogle = parser.id === 'google';

        const GOOGLE_EXTS = ['.html', '.json', '.ics', '.csv'];
        let validFiles;
        if (isGoogle) {
            validFiles = Array.from(fileList).filter(f =>
                GOOGLE_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
            );
        } else {
            validFiles = Array.from(fileList).filter(f => f.name.endsWith('.json'));
        }

        if (validFiles.length === 0) {
            alert(`No valid files found for ${parser.label}. Make sure you selected the correct folder.`);
            progress.classList.add('hidden');
            uploadZone.classList.remove('hidden');
            return;
        }

        if (isGoogle) {
            let done = 0;
            for (const file of validFiles) {
                try {
                    const text = await file.text();
                    const relativePath = file.webkitRelativePath || file.name;
                    progressText.textContent = `Parsing ${file.name}…`;
                    await sleep(0);
                    const events = parser.parse(text, relativePath);
                    newEvents.push(...events);
                } catch (err) {
                    console.warn(`Could not parse ${file.name}:`, err);
                }
                done++;
                progressFill.style.width = `${Math.round((done / validFiles.length) * 100)}%`;
                if (done % 10 === 0) await sleep(0);
            }
        } else {
            const parsedFiles = [];
            let done = 0;
            for (const file of validFiles) {
                try {
                    const text = await readFileAsText(file);
                    const json = JSON.parse(text);
                    const relativePath = file.webkitRelativePath || file.name;
                    parsedFiles.push({ path: relativePath, json });
                } catch (err) {
                    console.warn(`Could not parse ${file.name}:`, err);
                }
                done++;
                const pct = Math.round((done / validFiles.length) * 100);
                progressFill.style.width = `${pct}%`;
                progressText.textContent = `Reading files… ${done} / ${validFiles.length}`;
                if (done % 20 === 0) await sleep(0);
            }
            progressText.textContent = 'Parsing events…';
            await sleep(0);
            newEvents = parser.parse(parsedFiles);
        }
    }

    // Normalise every event: stamp source fields, convert date string → Date object
    const stampedEvents = newEvents.map(e => {
        const d = (e.date instanceof Date) ? e.date : new Date(e.date);
        return Object.assign(e, {
            source:      e.source      || parser.id,
            sourceLabel: e.sourceLabel || parser.label,
            sourceIcon:  e.sourceIcon  || parser.icon,
            sourceColor: e.sourceColor || parser.color,
            date:        d,
            timestamp:   d.getTime(),
        });
    }).filter(e => !isNaN(e.date.getTime()));

    // Google accumulates across multiple account uploads; others replace on re-upload
    if (parser.id !== 'google') {
        state.allEvents = state.allEvents.filter(e => e.source !== parser.id);
    }
    state.allEvents.push(...stampedEvents);

    const prevCount = parser.id === 'google' ? (state.loadedPlatforms['google']?.count ?? 0) : 0;
    state.loadedPlatforms[parser.id] = {
        label: parser.label,
        icon: parser.icon,
        color: parser.color,
        count: prevCount + stampedEvents.length,
    };
    state.activeFilters.add(parser.id);

    progress.classList.add('hidden');
    uploadZone.classList.remove('hidden');

    updateLoadedPlatformsList();
    updateStatusBadge(parser.id, prevCount + stampedEvents.length);

    const viewBtn = document.getElementById('btn-view-results');
    viewBtn.style.display = 'block';
    viewBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// function readFileAsText(file) {
//     return new Promise((resolve, reject) => {
//         const reader = new FileReader();
//         reader.onload = e => resolve(e.target.result);
//         reader.onerror = reject;
//         reader.readAsText(file, 'utf-8');
//     });
// }
function readFileAsText(file) {
    return file.text();
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function updateStatusBadge(platformId, count) {
    const el = document.getElementById(`status-${platformId}`);
    if (el) {
        el.textContent = `✓ ${count.toLocaleString()} events`;
        el.className = 'platform-status loaded';
    }
}

function updateLoadedPlatformsList() {
    const container = document.getElementById('loaded-platforms');
    container.innerHTML = '';
    for (const [id, info] of Object.entries(state.loadedPlatforms)) {
        const div = document.createElement('div');
        div.className = 'loaded-platform-tag';
        div.innerHTML = `
      <span>${info.icon} ${info.label}</span>
      <span class="event-count">${info.count.toLocaleString()} events loaded</span>
    `;
        container.appendChild(div);
    }
}

// ─── View results ─────────────────────────────────────────────────────────────
document.getElementById('btn-view-results').addEventListener('click', () => {
    buildResultsScreen();
    showScreen('results');
});

// ─── Results screen ───────────────────────────────────────────────────────────
function buildResultsScreen() {
    buildFilterChips();
    setupDatePicker();
    renderTimeline();
}

function buildFilterChips() {
    const container = document.getElementById('filter-chips');
    container.innerHTML = '';
    for (const [id, info] of Object.entries(state.loadedPlatforms)) {
        const chip = document.createElement('button');
        chip.className = 'filter-chip active';
        chip.dataset.platform = id;
        chip.style.setProperty('--chip-color', info.color);
        chip.innerHTML = `${info.icon} ${info.label}`;
        chip.addEventListener('click', () => {
            if (state.activeFilters.has(id)) {
                state.activeFilters.delete(id);
                chip.classList.remove('active');
            } else {
                state.activeFilters.add(id);
                chip.classList.add('active');
            }
            renderTimeline();
        });
        container.appendChild(chip);
    }
}

function setupDatePicker() {
    const picker = document.getElementById('date-picker');
    document.querySelector('.date-display').addEventListener('click', () => picker.showPicker());

    // Default to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    picker.value = `${yyyy}-${mm}-${dd}`;
    state.selectedDate = today;
    updateDateLabel(today);

    picker.addEventListener('change', () => {
        const [y, m, d] = picker.value.split('-').map(Number);
        state.selectedDate = new Date(y, m - 1, d);
        updateDateLabel(state.selectedDate);
        renderTimeline();
    });
}

function updateDateLabel(date) {
    const label = document.getElementById('date-label');
    label.textContent = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function renderTimeline() {
    const timeline = document.getElementById('timeline');
    const emptyState = document.getElementById('empty-state');
    const summary = document.getElementById('results-summary');

    const targetMonth = state.selectedDate.getMonth(); // 0-indexed
    const targetDay = state.selectedDate.getDate();

    // Filter events that match this month+day, from active platforms
    const matching = state.allEvents.filter(event => {
        if (!state.activeFilters.has(event.source)) return false;
        const d = event.date;
        return d.getMonth() === targetMonth && d.getDate() === targetDay;
    });

    // Sort chronologically
    matching.sort((a, b) => a.timestamp - b.timestamp);

    // Group by year
    const byYear = new Map();
    for (const event of matching) {
        const yr = event.date.getFullYear();
        if (!byYear.has(yr)) byYear.set(yr, []);
        byYear.get(yr).push(event);
    }

    const years = Array.from(byYear.keys()).sort((a, b) => b - a); // newest first

    if (years.length === 0) {
        timeline.innerHTML = '';
        emptyState.classList.remove('hidden');
        summary.innerHTML = '';
        return;
    }

    emptyState.classList.add('hidden');

    const dateStr = state.selectedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    summary.innerHTML = `
    <p>Found <strong>${matching.length.toLocaleString()} memories</strong> for <strong>${dateStr}</strong> across <strong>${years.length} year${years.length > 1 ? 's' : ''}</strong></p>
  `;

    timeline.innerHTML = '';

    for (const year of years) {
        const events = byYear.get(year);

        const yearGroup = document.createElement('div');
        yearGroup.className = 'year-group';

        const yearLabel = document.createElement('div');
        yearLabel.className = 'year-label';
        const yearsAgo = new Date().getFullYear() - year;
        const agoText = yearsAgo === 0 ? 'This year' : yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`;
        yearLabel.innerHTML = `<span class="year-number">${year}</span><span class="year-ago">${agoText}</span>`;
        yearGroup.appendChild(yearLabel);

        // Strictly chronological within the year
        const listSection = document.createElement('div');
        listSection.className = 'category-section'; // reuse class for padding
        for (const event of events) {
            listSection.appendChild(buildEventCard(event));
        }
        yearGroup.appendChild(listSection);

        timeline.appendChild(yearGroup);
    }
}

function buildEventCard(event) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.style.setProperty('--event-color', event.sourceColor);

    const time = event.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
    <div class="event-icon">${event.icon}</div>
    <div class="event-body">
      <div class="event-title">${escapeHtml(event.title)}</div>
      ${event.description ? `<div class="event-description">${escapeHtml(event.description)}</div>` : ''}
      <div class="event-meta">
        <span class="event-source-badge" style="background:${event.sourceColor}22;color:${event.sourceColor}">${event.sourceIcon} ${event.sourceLabel}</span>
        <span class="event-time">${time}</span>
      </div>
    </div>
    ${event.dataInsight ? `<button class="event-insight-btn" title="Data insight">💡</button>` : ''}
  `;

    if (event.dataInsight) {
        card.querySelector('.event-insight-btn').addEventListener('click', e => {
            e.stopPropagation();
            showInfoPanel('💡 Data Insight', `<p>${escapeHtml(event.dataInsight)}</p>`);
        });
    }

    return card;
}

// ─── Info panel ───────────────────────────────────────────────────────────────
function showInfoPanel(title, bodyHtml) {
    document.getElementById('info-title').textContent = title;
    document.getElementById('info-body').innerHTML = bodyHtml;
    document.getElementById('info-overlay').classList.remove('hidden');
}

document.getElementById('btn-close-info').addEventListener('click', () => {
    document.getElementById('info-overlay').classList.add('hidden');
});

document.getElementById('info-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('info-overlay')) {
        document.getElementById('info-overlay').classList.add('hidden');
    }
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}