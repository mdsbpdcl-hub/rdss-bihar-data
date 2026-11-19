// Collects Bihar-related figures from the public RDSS dashboard (https://rdss.powermin.gov.in/dashboard):
//  • yearly Excel files the dashboard links to (AT&C loss, ACS-ARR gap, payable and receivable days)
//  • the public state-wise progress pages (smart metering, loss reduction works, physical progress, funds),
//    opened in a headless browser exactly as a visitor would, plus the SBPDCL / NBPDCL split for Bihar.
// Only public pages are read; nothing behind the RDSS sign-in is touched.
// Writes data/latest.json and data/latest.csv, and adds today's Bihar figures to data/history.csv.
// If a page cannot be read, its previous figures are kept and the failure is recorded in latest.json.

import { chromium } from 'playwright';
import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { parseProgress, parseFunds, parseAnnual, latestYearIndex, rank, key, stateLabel, num } from './parse.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'data');
const SITE = 'https://rdss.powermin.gov.in';
const FILES = 'https://rdss.powermin.gov.in:8443/dashboard';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const PROGRESS = {
  cm: { label: 'Consumer meters', unit: 'nos.', path: '/all-state-progress', done: 'Communicating' },
  dm: { label: 'DT meters', unit: 'nos.', path: '/all-state-progress', done: 'Communicating' },
  fm: { label: 'Feeder meters', unit: 'nos.', path: '/all-state-progress', done: 'Communicating' },
  bm: { label: 'Boundary meters', unit: 'nos.', path: '/all-state-progress', done: 'Communicating' },
  LT: { label: 'LT lines', unit: 'ckm', path: '/all-state-progress-loss', done: 'Installed' },
  HT: { label: 'HT lines', unit: 'ckm', path: '/all-state-progress-loss', done: 'Installed' },
  DTR: { label: 'Distribution transformers', unit: 'nos.', path: '/all-state-progress-loss', done: 'Installed' },
  SUB: { label: 'Substations', unit: 'nos.', path: '/all-state-progress-loss', done: 'Installed' },
};
const PHYSICAL = { sm: '/all-state-physical-progress', ls: '/all-state-physical-progress-loss' };
const FUNDS = ['sanctioned_cost', 'gbs_sanctioned', 'gbs_released'];
const ANNUAL = {
  atc: 'ATC%20Loss.xlsx',
  acs_arr: 'ACS_ARR.xlsx',
  payable: 'Payable%20Days.xlsx',
  receivable: 'Receivable%20Days.xlsx',
};

const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'latest.json'), 'utf8')); } catch { return {}; } })();
const errors = [];
const sources = {};
const now = new Date();

async function attempt(name, fn, tries = 2) {
  for (let i = 1; i <= tries; i++) {
    try { const v = await fn(); sources[name] = { ok: true, at: now.toISOString() }; return v; }
    catch (e) {
      console.warn(`! ${name} (try ${i}): ${e.message.split('\n')[0]}`);
      if (i === tries) {
        errors.push(`${name}: ${e.message.split('\n')[0]}`);
        sources[name] = { ok: false, at: prev.sources?.[name]?.at || null, error: e.message.split('\n')[0] };
        return null;
      }
      await wait(5000);
    }
  }
}

// Open a public RDSS page and read its State / Discom table once it has finished loading
async function readTable(page, url, minRows = 2) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const grab = () => page.evaluate(() => {
    const isHead = (tr) => [...tr.children].some((c) => /^(state|discom)$/i.test(c.textContent.trim()));
    for (const t of document.querySelectorAll('table')) {
      const trs = [...t.querySelectorAll('tr')];
      const hi = trs.findIndex(isHead);
      if (hi < 0) continue;
      const headers = [...trs[hi].children].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
      const rows = trs.slice(hi + 1).map((tr) => {
        const a = tr.querySelector('a[href]');
        const m = a && a.getAttribute('href').match(/[?&]id=(\d+)/);
        return { cells: [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()), id: m ? +m[1] : null };
      }).filter((r) => r.cells.length >= 3);
      return { headers, rows, loading: /loading/i.test(t.textContent) };
    }
    return null;
  });
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 120000) {
    const t = await grab();
    if (t && !t.loading && t.rows.length >= minRows) {
      // wait until two reads agree, so a half-drawn table is never saved
      if (last && JSON.stringify(last.rows) === JSON.stringify(t.rows)) return t;
      last = t;
    }
    await wait(1500);
  }
  throw new Error('table did not finish loading: ' + url);
}

async function fetchXlsx(ctx, file) {
  const res = await ctx.request.get(`${FILES}/${file}`, { timeout: 90000 });
  if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
  const wb = XLSX.read(await res.body(), { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    try { return parseAnnual(aoa); } catch { /* try the next sheet */ }
  }
  throw new Error('no sheet with a FY header row');
}

// Smart-metering and loss-reduction "Physical Progress" and "Financial Progress" tiles for India
async function readTiles(page) {
  await page.goto(`${SITE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const pick = (s, re) => { const m = s.match(re); return m ? num(m[1]) : null; };
  const read = async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    const i = txt.indexOf('Smart Metering'), j = txt.indexOf('Loss Reduction', i + 1);
    if (i < 0 || j < 0) return null;
    const sm = txt.slice(i, j), lr = txt.slice(j);
    return {
      sm_physical: pick(sm, /Physical Progress\s*([\d.]+)\s*%/), sm_financial: pick(sm, /Financial Progress\s*([\d.]+)\s*%/),
      lr_physical: pick(lr, /Physical Progress\s*([\d.]+)\s*%/), lr_financial: pick(lr, /Financial Progress\s*([\d.]+)\s*%/),
    };
  };
  // the tiles count up from 0, so wait until all four are non-zero and two reads agree
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < 90000) {
    const v = await read();
    if (v && Object.values(v).every((x) => x > 0)) { if (last && JSON.stringify(last) === JSON.stringify(v)) return v; last = v; }
    await wait(2000);
  }
  throw new Error('dashboard tiles did not settle');
}

const tidyStates = (p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, name: stateLabel(r.name) })) });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1000 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  const out = { fetched_at: now.toISOString(), source: `${SITE}/dashboard`, progress: {}, physical: {}, funds: {}, annual: {}, india_tiles: null };

  // 1. Yearly Excel files
  for (const [id, file] of Object.entries(ANNUAL)) {
    const a = await attempt(`annual:${id}`, () => fetchXlsx(ctx, file));
    out.annual[id] = a ? { ...a, file: `${FILES}/${file}` } : prev.annual?.[id] || null;
    if (a) console.log(`✓ ${id}: ${a.states.length} states, ${a.discoms.length} DISCOMs, ${a.years.join(', ')}`);
  }

  // 2. India tiles
  out.india_tiles = (await attempt('tiles', () => readTiles(page))) || prev.india_tiles || null;

  // 3. Progress pages, state-wise, then the Bihar SBPDCL / NBPDCL split
  let biharId = 5;
  for (const [id, m] of Object.entries(PROGRESS)) {
    const st = await attempt(`progress:${id}`, async () => tidyStates(parseProgress(await readTable(page, `${SITE}${m.path}?type=${id}`))));
    const br = st?.rows.find((r) => key(r.name) === 'BIHAR');
    if (br?.id) biharId = br.id;
    const ds = await attempt(`progress:${id}:bihar`, async () => parseProgress(await readTable(page, `${SITE}${m.path}?chartfor=state&type=${id}&id=${biharId}&sectionfor=TableSection`, 1)));
    out.progress[id] = {
      ...m,
      states: st ? st.rows : prev.progress?.[id]?.states || [],
      india: st ? st.total : prev.progress?.[id]?.india || null,
      bihar_discoms: ds ? ds.rows : prev.progress?.[id]?.bihar_discoms || [],
    };
    if (st) console.log(`✓ ${id}: ${st.rows.length} states; Bihar ${br?.pct}%`);
  }

  // 4. Physical progress (%)
  for (const [id, p] of Object.entries(PHYSICAL)) {
    const st = await attempt(`physical:${id}`, async () => tidyStates(parseProgress(await readTable(page, `${SITE}${p}?type=${id}`))));
    const ds = await attempt(`physical:${id}:bihar`, async () => parseProgress(await readTable(page, `${SITE}${p}?chartfor=state&type=${id}&id=${biharId}&sectionfor=TableSection`)), 1);
    out.physical[id] = {
      states: st ? st.rows : prev.physical?.[id]?.states || [],
      bihar_discoms: ds ? ds.rows : prev.physical?.[id]?.bihar_discoms || [],
    };
  }

  // 5. Funds (INR crore)
  for (const id of FUNDS) {
    const st = await attempt(`funds:${id}`, async () => tidyStates(parseFunds(await readTable(page, `${SITE}/common-table-data?type=${id}`))));
    const ds = await attempt(`funds:${id}:bihar`, async () => parseFunds(await readTable(page, `${SITE}/common-table-data?chartfor=state&type=${id}&id=${biharId}&sectionfor=TableSection`)), 1);
    out.funds[id] = {
      states: st ? st.rows : prev.funds?.[id]?.states || [],
      india: st ? st.total : prev.funds?.[id]?.india || null,
      bihar_discoms: ds ? ds.rows : prev.funds?.[id]?.bihar_discoms || [],
    };
  }
  await browser.close();

  out.sources = sources;
  out.errors = errors;
  const okCount = Object.values(sources).filter((s) => s.ok).length;
  out.ok = errors.length === 0;
  // Bihar's own state-wise figures must have come through, or nothing is saved
  if (!sources['progress:cm']?.ok && !sources['annual:atc']?.ok) {
    console.error(`Nothing usable fetched (${okCount} of ${Object.keys(sources).length} sources). Errors:\n` + errors.join('\n'));
    process.exit(1);
  }

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'latest.json'), JSON.stringify(out, null, 1));
  writeLatestCsv(out);
  writeHistory(out);
  console.log(`Saved. ${okCount}/${Object.keys(sources).length} sources read${errors.length ? '; failed: ' + errors.join('; ') : ''}`);
}

const csv = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function writeLatestCsv(o) {
  const L = [['section', 'measure', 'level', 'name', 'sanctioned', 'awarded', 'done', 'pct_or_value']];
  for (const [id, p] of Object.entries(o.progress)) {
    p.states.forEach((r) => L.push(['progress', id, 'state', r.name, r.sanctioned, r.awarded, r.done, r.pct]));
    if (p.india) L.push(['progress', id, 'india', 'India', p.india.sanctioned, p.india.awarded, p.india.done, p.india.pct]);
    p.bihar_discoms.forEach((r) => L.push(['progress', id, 'bihar_discom', r.name, r.sanctioned, r.awarded, r.done, r.pct]));
  }
  for (const [id, p] of Object.entries(o.physical)) {
    p.states.forEach((r) => L.push(['physical', id, 'state', r.name, '', '', '', r.pct]));
    p.bihar_discoms.forEach((r) => L.push(['physical', id, 'bihar_discom', r.name, '', '', '', r.pct]));
  }
  for (const [id, p] of Object.entries(o.funds)) {
    p.states.forEach((r) => L.push(['funds', id, 'state', r.name, '', '', '', r.total]));
    if (p.india) L.push(['funds', id, 'india', 'India', '', '', '', p.india.total]);
    p.bihar_discoms.forEach((r) => L.push(['funds', id, 'bihar_discom', r.name, '', '', '', r.total]));
  }
  for (const [id, a] of Object.entries(o.annual)) {
    if (!a) continue;
    const j = latestYearIndex(a);
    a.states.forEach((r) => L.push(['annual ' + a.years[j], id, 'state', r.name, '', '', '', r.values[j]]));
    a.discoms.forEach((r) => L.push(['annual ' + a.years[j], id, 'discom', r.name, '', '', '', r.values[j]]));
    if (a.india) L.push(['annual ' + a.years[j], id, 'india', 'India', '', '', '', a.india[j]]);
  }
  fs.writeFileSync(path.join(DATA, 'latest.csv'), L.map((r) => r.map(csv).join(',')).join('\n') + '\n');
}

// One row per day, measure and utility (Bihar, SBPDCL, NBPDCL, India), with Bihar's rank among states
function writeHistory(o) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const rows = [];
  const disc = (list, re) => list.find((r) => re.test(r.name));
  const add = (measure, entity, value, rk) => { if (value !== null && value !== undefined) rows.push([day, measure, entity, value, rk?.rank ?? '', rk?.n ?? '']); };
  const sb = /SBPDCL|SOUTH/i, nb = /NBPDCL|NORTH/i;
  for (const [id, p] of Object.entries(o.progress)) {
    const pool = p.states.filter((r) => r.sanctioned > 0);
    const br = p.states.find((r) => key(r.name) === 'BIHAR');
    add(id, 'Bihar', br?.pct, rank(pool, 'Bihar', (r) => r.pct));
    add(id, 'SBPDCL', disc(p.bihar_discoms, sb)?.pct);
    add(id, 'NBPDCL', disc(p.bihar_discoms, nb)?.pct);
    add(id, 'India', p.india?.pct);
  }
  for (const [id, p] of Object.entries(o.physical)) {
    const br = p.states.find((r) => key(r.name) === 'BIHAR');
    add('phys_' + id, 'Bihar', br?.pct, rank(p.states.filter((r) => r.pct > 0), 'Bihar', (r) => r.pct));
    add('phys_' + id, 'SBPDCL', disc(p.bihar_discoms, sb)?.pct);
    add('phys_' + id, 'NBPDCL', disc(p.bihar_discoms, nb)?.pct);
  }
  if (o.india_tiles) { add('phys_sm', 'India', o.india_tiles.sm_physical); add('phys_ls', 'India', o.india_tiles.lr_physical); }
  const rel = o.funds.gbs_released, san = o.funds.gbs_sanctioned;
  if (rel?.states.length && san?.states.length) {
    const pctOf = (name) => { const a = rel.states.find((r) => key(r.name) === key(name)), b = san.states.find((r) => key(r.name) === key(name)); return a && b && b.total > 0 ? +(100 * a.total / b.total).toFixed(2) : null; };
    const pool = san.states.filter((r) => r.total > 0).map((r) => ({ name: r.name, v: pctOf(r.name) }));
    add('gbs_release_pct', 'Bihar', pctOf('Bihar'), rank(pool, 'Bihar', (r) => r.v));
    if (rel.india && san.india?.total) add('gbs_release_pct', 'India', +(100 * rel.india.total / san.india.total).toFixed(2));
    add('gbs_released', 'Bihar', rel.states.find((r) => key(r.name) === 'BIHAR')?.total);
  }
  const file = path.join(DATA, 'history.csv');
  const head = 'date,measure,entity,value,bihar_rank,of';
  let old = [];
  try { old = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).filter((l) => l && !l.startsWith(day + ',')); } catch { /* new file */ }
  fs.writeFileSync(file, [head, ...old, ...rows.map((r) => r.map(csv).join(','))].join('\n') + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
