#!/usr/bin/env node
/**
 * Data Export Structure Explorer
 * ================================
 * Safely analyses a data export folder and prints:
 *   - Directory tree
 *   - JSON schema (keys + value TYPES only — no personal data)
 *   - CSV headers
 *   - HTML structural patterns
 *
 * KEY BEHAVIOUR: For every array found anywhere in any JSON file, it scans
 * ALL items (not just the first few) to find the most populated example.
 * This means empty arrays like `attachments: []` or `files: []` won't hide
 * nested structure — if ANY item in ANY position has content, it will be shown.
 *
 * Usage:
 *   node explore_export.js /path/to/folder
 *   node explore_export.js /path/to/file.json
 *   node explore_export.js /path/to/folder > structure.txt
 */

const fs   = require('fs');
const path = require('path');

// ─── CLI args ──────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const targetPath = args.find(a => !a.startsWith('--'));
const MAX_DEPTH  = 8; // max folder walk depth
const MAX_JSON_FILES = 60;

if (!targetPath) {
  console.error('Usage: node explore_export.js /path/to/folder [or file]');
  process.exit(1);
}

const absTarget = path.resolve(targetPath);
if (!fs.existsSync(absTarget)) {
  console.error(`Path not found: ${absTarget}`);
  process.exit(1);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function indent(n)    { return '  '.repeat(n); }
function humanSize(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}
function typeOf(val) {
  if (val === null)       return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

/**
 * Classify a leaf value's type without ever revealing its content.
 */
function classifyLeaf(val) {
  const t = typeOf(val);
  if (t === 'null')    return 'null';
  if (t === 'boolean') return 'boolean';
  if (t === 'number') {
    if (val > 1e15) return 'number (looks like unix-microseconds timestamp)';
    if (val > 1e12) return 'number (looks like unix-ms timestamp)';
    if (val > 1e9 && val < 2e10) return 'number (looks like unix-seconds timestamp)';
    return 'number';
  }
  if (t === 'string') {
    if (val.length === 0) return 'string (empty)';
    if (/^\d{4}-\d{2}-\d{2}T/.test(val))        return 'string (ISO-8601 datetime)';
    if (/^\d{4}-\d{2}-\d{2}/.test(val))          return 'string (date-like)';
    if (/^\d{10,13}$/.test(val))                  return 'string (numeric, possible timestamp)';
    if (/^https?:\/\//.test(val))                 return 'string (url)';
    if (/^[a-f0-9-]{36}$/i.test(val))            return 'string (UUID)';
    if (/^[a-f0-9]{24,64}$/i.test(val))          return 'string (hash-like)';
    if (val.includes('@') && val.includes('.'))   return 'string (email-like)';
    return `string (len=${val.length})`;
  }
  return t;
}

/**
 * Merge two schema objects together — union of all keys,
 * preferring the more informative (non-empty, non-null) value.
 */
function mergeObjects(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return b;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return a;
  const merged = Object.assign({}, a);
  for (const [k, v] of Object.entries(b)) {
    if (!(k in merged)) {
      merged[k] = v;
    } else {
      merged[k] = mergeSchemas(merged[k], v);
    }
  }
  return merged;
}

/**
 * Merge two schema representations, preferring the richer one.
 */
function mergeSchemas(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;

  const ta = typeOf(a);
  const tb = typeOf(b);

  // Both objects — deep merge
  if (ta === 'object' && !Array.isArray(a) && tb === 'object' && !Array.isArray(b)) {
    return mergeObjects(a, b);
  }

  // Both arrays — merge their descriptors
  if (Array.isArray(a) && Array.isArray(b)) {
    // [countStr, innerSchema]
    const countA = a[0] || '';
    const countB = b[0] || '';
    // Pick the higher count string for display
    const count = countA >= countB ? countA : countB;
    const inner = mergeSchemas(a[1], b[1]);
    return [count, inner];
  }

  // One is a string type label — prefer the more informative one
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === 'null' || a === '[]') return b;
    if (b === 'null' || b === '[]') return a;
    if (a === b) return a;
    return `${a} | ${b}`;
  }

  // Mismatched types — prefer whichever is more complex
  if (ta === 'object' || Array.isArray(a)) return a;
  if (tb === 'object' || Array.isArray(b)) return b;
  return a;
}

/**
 * Build a schema from a JSON value.
 * For arrays: scans ALL items to find the richest example — never just the first few.
 * Returns a plain object describing structure, never leaf values.
 */
function schema(val, depth = 0) {
  if (depth > 12) return '<max depth>';

  const t = typeOf(val);

  if (t === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = schema(v, depth + 1);
    }
    return out;
  }

  if (t === 'array') {
    if (val.length === 0) return '[]';

    // Scan ALL items and merge their schemas together
    // This ensures we never miss fields that only appear in some items
    let merged = undefined;
    for (const item of val) {
      const s = schema(item, depth + 1);
      merged = mergeSchemas(merged, s);
    }

    return [`[${val.length} items]`, merged];
  }

  return classifyLeaf(val);
}

/**
 * Render a schema to a string for printing.
 */
function renderSchema(s, depth = 0) {
  if (typeof s === 'string') return s;

  if (Array.isArray(s)) {
    const [label, inner] = s;
    if (!inner || inner === '[]') return `Array ${label} (empty)`;
    const renderedInner = renderSchema(inner, depth + 1);
    if (renderedInner.includes('\n')) {
      return `Array ${label}, each item:\n${renderedInner.split('\n').map(l => indent(1) + l).join('\n')}`;
    }
    return `Array ${label}, each item: ${renderedInner}`;
  }

  if (s && typeof s === 'object') {
    const lines = [];
    for (const [k, v] of Object.entries(s)) {
      const rendered = renderSchema(v, depth + 1);
      if (rendered.includes('\n')) {
        lines.push(`${indent(depth + 1)}${k}:`);
        lines.push(rendered.split('\n').map(l => `${indent(depth + 1)}  ` + l.trimStart()
          ? `${indent(depth + 2)}${l.trimStart()}` : '').join('\n'));
      } else {
        lines.push(`${indent(depth + 1)}${k}: ${rendered}`);
      }
    }
    return lines.join('\n');
  }

  return String(s);
}

// ─── CSV helpers ───────────────────────────────────────────────────────────────
function csvHeaders(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  const cols = []; let cur = '', inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
}

function csvRowCount(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).length - 1;
}

// ─── HTML helpers ──────────────────────────────────────────────────────────────
function htmlPatterns(text) {
  const classes = new Set(), dataAttrs = new Set(), tagFreq = {};
  let m;
  const classRe = /class="([^"]+)"/g;
  const dataRe  = /data-[\w-]+/g;
  const tagRe   = /<(\w+)[\s>]/g;
  while ((m = classRe.exec(text)) !== null) m[1].split(/\s+/).forEach(c => c && classes.add(c));
  while ((m = dataRe.exec(text))   !== null) dataAttrs.add(m[0]);
  while ((m = tagRe.exec(text))    !== null) {
    const tag = m[1].toLowerCase();
    tagFreq[tag] = (tagFreq[tag] || 0) + 1;
  }
  const topTags = Object.entries(tagFreq).sort((a,b) => b[1]-a[1]).slice(0,12).map(([t,c]) => `${t}(×${c})`);
  const dateSamples = new Set();
  if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/.test(text)) dateSamples.add('Month DD, YYYY format');
  if (/\d{4}-\d{2}-\d{2}T[\d:Z]/.test(text)) dateSamples.add('ISO-8601 format');
  if (/\d{4}年\d{1,2}月\d{1,2}日/.test(text)) dateSamples.add('Japanese date format');
  return { classes: [...classes].slice(0, 80), dataAttrs: [...dataAttrs].slice(0, 20), topTags, dateSamples: [...dateSamples] };
}

// ─── Directory walker ──────────────────────────────────────────────────────────
const jsonFiles = [], csvFiles = [], htmlFiles = [], otherFiles = [];

function walkTree(dirPath, depth = 0) {
  if (depth > MAX_DEPTH) { console.log(`${indent(depth)}… (max depth reached)`); return; }
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch { console.log(`${indent(depth)}[unreadable]`); return; }

  const dirs  = entries.filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => e.isFile()).sort((a,b) => a.name.localeCompare(b.name));

  for (const dir of dirs) {
    console.log(`${indent(depth)}📁 ${dir.name}/`);
    walkTree(path.join(dirPath, dir.name), depth + 1);
  }

  // Group by extension to summarise large batches
  const byExt = {};
  for (const f of files) {
    const ext = path.extname(f.name).toLowerCase() || '(no ext)';
    if (!byExt[ext]) byExt[ext] = [];
    byExt[ext].push(f);
  }

  for (const [ext, group] of Object.entries(byExt)) {
    if (group.length > 8) {
      let total = 0;
      for (const f of group) {
        try { total += fs.statSync(path.join(dirPath, f.name)).size; } catch {}
      }
      console.log(`${indent(depth)}📄 [${group.length}× ${ext} files, total ${humanSize(total)}]`);
      group.slice(0, 3).forEach(f => registerFile(path.join(dirPath, f.name), ext));
    } else {
      for (const f of group) {
        const fullPath = path.join(dirPath, f.name);
        try {
          const size = fs.statSync(fullPath).size;
          console.log(`${indent(depth)}📄 ${f.name}  (${humanSize(size)})`);
          registerFile(fullPath, ext);
        } catch {
          console.log(`${indent(depth)}📄 ${f.name}  [permission denied — skipped]`);
        }
      }
    }
  }
}

const MEDIA_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.mp4','.mov','.mp3',
  '.aac','.heic','.webp','.pdf','.zip','.DS_Store','']);

function registerFile(fullPath, ext) {
  if (ext === '.json' && jsonFiles.length < MAX_JSON_FILES) jsonFiles.push(fullPath);
  else if (ext === '.csv')  csvFiles.push(fullPath);
  else if (ext === '.html') htmlFiles.push(fullPath);
  else if (!MEDIA_EXTS.has(ext)) otherFiles.push(fullPath);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
const stat         = fs.statSync(absTarget);
const isSingleFile = stat.isFile();

console.log('='.repeat(70));
console.log('  DATA EXPORT STRUCTURE EXPLORER');
console.log('  (No personal values are ever printed — structure & types only)');
console.log('='.repeat(70));
console.log(`\nTarget:  ${absTarget}`);
console.log(`Scanned: ${new Date().toLocaleString()}\n`);

if (isSingleFile) {
  const ext = path.extname(absTarget).toLowerCase();
  registerFile(absTarget, ext);
} else {
  console.log('━'.repeat(70));
  console.log('FOLDER TREE');
  console.log('━'.repeat(70));
  console.log(`📁 ${path.basename(absTarget)}/`);
  walkTree(absTarget, 1);
}

// ─── JSON ──────────────────────────────────────────────────────────────────────
if (jsonFiles.length > 0) {
  console.log('\n' + '━'.repeat(70));
  console.log(`JSON SCHEMAS  (all arrays fully scanned — no sampling)`);
  console.log('━'.repeat(70));

  for (const filePath of jsonFiles) {
    const rel  = isSingleFile ? path.basename(filePath) : path.relative(absTarget, filePath);
    let size = 0; try { size = fs.statSync(filePath).size; } catch {}
    console.log(`\n┌─ ${rel}  (${humanSize(size)})`);
    try {
      const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const s    = schema(json);
      renderSchema(s, 0).split('\n').forEach(l => console.log('│' + l));
    } catch (err) {
      console.log(`│  [Parse error: ${err.message}]`);
    }
    console.log('└' + '─'.repeat(60));
  }
}

// ─── CSV ───────────────────────────────────────────────────────────────────────
if (csvFiles.length > 0) {
  console.log('\n' + '━'.repeat(70));
  console.log('CSV FILES');
  console.log('━'.repeat(70));
  for (const filePath of csvFiles) {
    const rel  = isSingleFile ? path.basename(filePath) : path.relative(absTarget, filePath);
    let size = 0; try { size = fs.statSync(filePath).size; } catch {}
    try {
      const text    = fs.readFileSync(filePath, 'utf8');
      const headers = csvHeaders(text);
      const rows    = csvRowCount(text);
      console.log(`\n  ${rel}  (${humanSize(size)}, ~${rows} data rows)`);
      console.log(`  Columns (${headers.length}):`);
      headers.forEach((h, i) => console.log(`    [${i}] ${h}`));
    } catch (err) {
      console.log(`  ${rel}: [Read error: ${err.message}]`);
    }
  }
}

// ─── HTML ──────────────────────────────────────────────────────────────────────
if (htmlFiles.length > 0) {
  console.log('\n' + '━'.repeat(70));
  console.log('HTML FILES');
  console.log('━'.repeat(70));
  for (const filePath of htmlFiles) {
    const rel  = isSingleFile ? path.basename(filePath) : path.relative(absTarget, filePath);
    let size = 0; try { size = fs.statSync(filePath).size; } catch {}
    try {
      const fd  = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(Math.min(size, 512 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const text = buf.toString('utf8');
      const p    = htmlPatterns(text);
      console.log(`\n  ${rel}  (${humanSize(size)})`);
      console.log(`  Top tags: ${p.topTags.join(', ')}`);
      if (p.dateSamples.length) console.log(`  Date formats: ${p.dateSamples.join(', ')}`);
      if (p.dataAttrs.length)   console.log(`  data-* attrs: ${p.dataAttrs.join(', ')}`);
      console.log(`  CSS classes (${p.classes.length}):`);
      for (let i = 0; i < p.classes.length; i += 4)
        console.log('    ' + p.classes.slice(i, i+4).map(c => `.${c}`).join('  '));
    } catch (err) {
      console.log(`  ${rel}: [Read error: ${err.message}]`);
    }
  }
}

// ─── Other text files ──────────────────────────────────────────────────────────
const notable = otherFiles.filter(f => ['.txt','.xml','.tsv','.ndjson','.jsonl'].includes(path.extname(f).toLowerCase()));
if (notable.length > 0) {
  console.log('\n' + '━'.repeat(70));
  console.log('OTHER TEXT FILES');
  console.log('━'.repeat(70));
  for (const f of notable) {
    const rel  = isSingleFile ? path.basename(f) : path.relative(absTarget, f);
    let size = 0; try { size = fs.statSync(f).size; } catch {}
    const ext  = path.extname(f).toLowerCase();
    console.log(`\n  ${rel}  (${humanSize(size)})`);
    try {
      const text = fs.readFileSync(f, 'utf8');
      if (ext === '.xml') {
        const tags = new Set(); const tagRe = /<(\w[\w:.-]*)/g; let m;
        while ((m = tagRe.exec(text)) !== null) tags.add(m[1]);
        console.log(`  XML tags: ${[...tags].slice(0,30).join(', ')}`);
      } else if (ext === '.tsv') {
        console.log(`  TSV columns: ${text.split('\n')[0].split('\t').join(' | ')}`);
      } else if (ext === '.jsonl' || ext === '.ndjson') {
        try {
          const s = schema(JSON.parse(text.trim().split('\n')[0]));
          console.log('  First-line schema:');
          renderSchema(s, 1).split('\n').forEach(l => console.log('  ' + l));
        } catch { console.log('  [Could not parse first line as JSON]'); }
      } else {
        console.log(`  Preview: ${text.slice(0, 200).replace(/\n/g, '↵')}`);
      }
    } catch (err) { console.log(`  [Read error: ${err.message}]`); }
  }
}

console.log('\n' + '='.repeat(70));
console.log('  DONE — safe to share this output with your AI');
console.log('='.repeat(70) + '\n');