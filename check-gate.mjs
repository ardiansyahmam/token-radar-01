// Local gate check for token-radar-01: the 7 rows of RULES.txt, read from /output.
// Usage: node check-gate.mjs <out-dir> <snapshot.json>
// Exits 0 when all 7 pass, 1 otherwise. Node stdlib only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const out = process.argv[2];
const snapPath = process.argv[3];
if (!out || !snapPath) { console.error('usage: node check-gate.mjs <out-dir> <snapshot.json>'); process.exit(2); }
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const snapSlugs = new Set(snap.protocols.map((p) => p.slug));
const results = [];
const pass = (row, ok, detail) => { results.push({ row, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${row}: ${detail}`); };

// --- image dimensions (PNG IHDR / JPEG SOF) ---
function pngDims(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function jpgDims(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) return null;
    const marker = b[off + 1];
    const len = b.readUInt16BE(off + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(off + 5), w: b.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}
function imgDims(b) { return pngDims(b) ?? jpgDims(b); }

// 1. dashboard_files
{
  const dir = path.join(out, 'dashboard');
  const files = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), p); else files.push(p); } };
  walk(dir, '');
  const totalBytes = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  const nameOk = (n) => /^[A-Za-z0-9._-]+$/.test(n) && n.length >= 1 && n.length <= 128 && !n.startsWith('.') && !n.startsWith('-') && !n.split('/').some((s) => s.startsWith('.'));
  let bad = files.find((f) => !nameOk(f));
  let net = null;
  const hasHttpAttr = (html) => /<[a-zA-Z][^>]*\s(?:href|src|action|poster|cite|data|formaction)\s*=\s*["'][^"']*https?:\/\//i.test(html)
    || /<style[^>]*>[\s\S]*?https?:\/\//i.test(html)
    || /<script[^>]*\ssrc\s*=\s*["']https?:\/\//i.test(html);
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const text = buf.toString('utf8');
    if (f.endsWith('.html') && hasHttpAttr(text)) { net = `${f}: http(s) in HTML attribute/style/script`; break; }
    if (f.endsWith('.css') && /https?:\/\//.test(text)) { net = `${f}: http(s) in CSS`; break; }
    if (f.endsWith('.js') && /(?:import\s+[^'"]*?from\s*|import\s*\(|require\s*\()\s*["']https?:\/\//.test(text)) { net = `${f}: http(s) in JS import/require`; break; }
  }
  const hasHtml = files.some((f) => f === 'index.html');
  const hasCss = files.some((f) => f.endsWith('.css'));
  const hasJs = files.some((f) => f.endsWith('.js'));
  pass('dashboard_files', hasHtml && hasCss && hasJs && files.length <= 400 && totalBytes <= 4 * 1024 * 1024 && !bad && !net,
    `${files.length} files, ${totalBytes} bytes, html=${hasHtml} css=${hasCss} js=${hasJs}${bad ? ` bad name: ${bad}` : ''}${net ? ` ${net}` : ''}`);
}

// 2/3/4/5. board
let board;
{
  const raw = fs.readFileSync(path.join(out, 'board.json'));
  const sizeOk = raw.length <= 8 * 1024 * 1024;
  board = JSON.parse(raw.toString('utf8'));
  const rows = board.rows ?? board;
  let issue = null;
  if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) issue = `row count ${Array.isArray(rows) ? rows.length : 'not an array'}`;
  const seen = new Set();
  if (!issue) for (const r of rows) {
    if (typeof r.slug !== 'string' || /\s/.test(r.slug) || r.slug.length < 1 || r.slug.length > 128 || !snapSlugs.has(r.slug)) { issue = `bad slug ${r.slug}`; break; }
    if (seen.has(r.slug)) { issue = `duplicate slug ${r.slug}`; break; }
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) { issue = `empty name ${r.slug}`; break; }
    if (!Number.isInteger(r.rank) || r.rank <= 0) { issue = `bad rank ${r.slug}`; break; }
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { issue = `bad implied ${r.slug}`; break; }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { issue = `${r.slug} farm_steps ${r.farm_steps?.length}`; break; }
    for (const s of r.farm_steps) if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) { issue = `${r.slug} farm step ${s.trim().length} chars`; break; }
    if (issue) break;
  }
  const allSame = rows.length >= 2 && new Set(rows.map((r) => r.implied_value_usd)).size === 1;
  pass('board_file', sizeOk && !issue && !allSame, `${rows.length} rows, ${raw.length} bytes${issue ? ` issue: ${issue}` : ''}${allSame ? ' all implied equal' : ''}`);
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((v, i) => v === i + 1);
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const sortedOk = byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd);
  const uniqueOk = new Set(rows.map((r) => r.implied_value_usd)).size === rows.length;
  pass('sorted_by_value', ranksOk && sortedOk && uniqueOk && !allSame, `ranks 1..${rows.length} ok=${ranksOk}, non-increasing=${sortedOk}, unique implied=${uniqueOk}`);
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  pass('coverage', missing.length === 0, `watchlist ${snap.watchlist.length - missing.length}/${snap.watchlist.length}${missing.length ? ` missing: ${missing.join(',')}` : ''}`);
  let farmOk = true; let farmDetail = `${rows.length} rows`;
  for (const r of rows) if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.trim().length < 20 || s.trim().length > 600)) { farmOk = false; farmDetail = `${r.slug} fails farm_steps`; break; }
  pass('farm_steps', farmOk, farmDetail);
}

// 6. screenshots
{
  const dir = path.join(out, 'screenshots');
  const names = fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  let ok = names.length >= 3 && names.length <= 4;
  let detail = `${names.length} images`;
  for (const n of names) {
    const b = fs.readFileSync(path.join(dir, n));
    const dims = imgDims(b);
    if (b.length > 512 * 1024) { ok = false; detail += `; ${n} ${b.length} bytes > 512KiB`; }
    if (!dims) { ok = false; detail += `; ${n} not a whole PNG/JPEG`; }
    else {
      const long = Math.max(dims.w, dims.h), short = Math.min(dims.w, dims.h);
      if (long > 1440 || short < 800) { ok = false; detail += `; ${n} ${dims.w}x${dims.h}`; }
      else detail += `; ${n} ${dims.w}x${dims.h} ${Math.round(b.length / 1024)}KB`;
    }
  }
  pass('screenshots', ok, detail);
}

// 7. dossier_matches
{
  const { buildDossier } = await import('./vendor/makefun-board.ts');
  const rebuilt = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
  const onDisk = fs.readFileSync(path.join(out, 'dossier.json'));
  const same = Buffer.from(rebuilt).equals(onDisk);
  pass('dossier_matches', same && onDisk.length <= 1.5 * 1024 * 1024, `dossier.json ${onDisk.length} bytes, rebuilt ${rebuilt.length} bytes, byte-identical=${same}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates pass`);
process.exit(failed.length ? 1 : 0);
