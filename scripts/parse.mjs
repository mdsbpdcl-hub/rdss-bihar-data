// Pure parsing helpers for RDSS tables (no browser, no network) so they can be tested offline.

// "1,32,885.47" -> 132885.47 ; "" / "-" / "NA" -> null
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s%₹]/g, '').replace(/^INR/i, '');
  if (s === '' || s === '-' || /^n\.?a\.?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Canonical key for matching names across the web pages ("BIHAR") and the Excel files ("Bihar")
export function key(name) {
  let k = String(name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z]/g, '');
  return ALIAS[k] || k;
}
const ALIAS = {
  CHATTISGARH: 'CHHATTISGARH',
  DADRAANDNAGARHAVELIANDDAMANANDDIU: 'DNHDD',
  DADRAANDNAGARHAVELI: 'DNHDD',
  DNHDD: 'DNHDD',
  ODISA: 'ODISHA',
  ORISSA: 'ODISHA',
  TAMILNADU: 'TAMILNADU',
  JAMMUKASHMIR: 'JAMMUANDKASHMIR',
  ANDAMANNICOBARISLANDS: 'ANDAMANANDNICOBARISLANDS',
  ANDAMANANDNICOBAR: 'ANDAMANANDNICOBARISLANDS',
  PONDICHERRY: 'PUDUCHERRY',
  TOTAL: 'INDIA', ALLINDIA: 'INDIA', INDIA: 'INDIA', GRANDTOTAL: 'INDIA',
};

// States and UTs, with tidy display names
export const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'DNHDD', 'Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];
const STATE_KEYS = new Map(STATES.map((s) => [key(s), s === 'DNHDD' ? 'DNH & DD' : s]));
export const isState = (name) => STATE_KEYS.has(key(name));
export const stateLabel = (name) => STATE_KEYS.get(key(name)) || String(name).trim();

/*
 * A progress table read off a page: { headers: [...], rows: [[cells...]] }.
 * Columns found by their header words. Returns { rows: [{name, id, sanctioned, awarded, done, pct}], total }.
 */
export function parseProgress(tbl) {
  const h = tbl.headers.map((x) => String(x).toLowerCase());
  const col = (re) => h.findIndex((x) => re.test(x));
  const iName = col(/^(state|discom)/);
  const iS = col(/sanction/), iA = col(/award/), iD = col(/communicat|install/), iP = col(/progress/);
  if (iName < 0 || (iS < 0 && iP < 0)) throw new Error('Unexpected table headers: ' + tbl.headers.join(' | '));
  const out = []; let total = null;
  for (const r of tbl.rows) {
    const name = String(r.cells[iName] || '').trim();
    if (!name || /loading/i.test(name)) continue;
    const row = {
      name, id: r.id ?? null,
      sanctioned: iS >= 0 ? num(r.cells[iS]) : null,
      awarded: iA >= 0 ? num(r.cells[iA]) : null,
      done: iD >= 0 ? num(r.cells[iD]) : null,
      pct: iP >= 0 ? num(r.cells[iP]) : null,
    };
    if (key(name) === 'INDIA') total = row; else out.push(row);
  }
  return { rows: out, total };
}

/*
 * A funds table (sanctioned cost / GBS sanctioned / GBS released). Columns become sm, sm_pma, lr, lr_pma, total.
 */
export function fundCol(header) {
  const x = String(header).toLowerCase();
  if (/total/.test(x)) return 'total';
  const pma = /pma for/.test(x);
  if (/smart/.test(x)) return pma ? 'sm_pma' : 'sm';
  if (/loss/.test(x)) return pma ? 'lr_pma' : 'lr';
  return null;
}
export function parseFunds(tbl) {
  const h = tbl.headers;
  const iName = h.findIndex((x) => /^(state|discom)/i.test(String(x).trim()));
  if (iName < 0) throw new Error('Unexpected fund table headers: ' + h.join(' | '));
  const cols = h.map((x, i) => (i === iName ? null : fundCol(x)));
  if (!cols.includes('total')) throw new Error('No total column in fund table');
  const out = []; let total = null;
  for (const r of tbl.rows) {
    const name = String(r.cells[iName] || '').trim();
    if (!name || /loading/i.test(name)) continue;
    const v = { name, id: r.id ?? null };
    cols.forEach((c, i) => { if (c) v[c] = num(r.cells[i]); });
    if (key(name) === 'INDIA') total = v; else out.push(v);
  }
  return { rows: out, total };
}

/*
 * One of the yearly Excel sheets (AT&C loss, ACS-ARR gap, payable / receivable days) as an array of rows.
 * Layout: a header row with "FY 2020-21 ..." columns, then state rows each followed by their DISCOM rows,
 * then "All India". Returns { years, states:[{name,values}], discoms:[{name,state,values}], india }.
 */
export function parseAnnual(aoa) {
  let hi = -1, yearCols = [];
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const cols = (aoa[i] || []).map((c, j) => [j, String(c ?? '').trim()]).filter(([, c]) => /^FY\s*\d{2,4}/i.test(c));
    if (cols.length >= 2) { hi = i; yearCols = cols; break; }
  }
  if (hi < 0) throw new Error('No FY header row found');
  const firstYear = yearCols[0][0];
  const years = yearCols.map(([, c]) => c.replace(/\s+/g, ' ').replace(/^fy/i, 'FY'));
  const states = [], discoms = []; let india = null, cur = null;
  for (let i = hi + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const name = row.slice(0, firstYear).map((c) => String(c ?? '').trim()).filter((c) => c && !/^\d+$/.test(c)).pop();
    if (!name) continue;
    const values = yearCols.map(([j]) => num(row[j]));
    if (values.every((v) => v === null) && !isState(name)) continue;
    if (key(name) === 'INDIA') { india = values; continue; }
    if (isState(name)) { cur = stateLabel(name); states.push({ name: cur, values }); }
    else discoms.push({ name, state: cur, values });
  }
  if (!states.length) throw new Error('No state rows found');
  return { years, states, discoms, india };
}

// Latest year with a value for most states (the newest column can be thinly filled early in the year)
export function latestYearIndex(a) {
  for (let j = a.years.length - 1; j >= 0; j--) {
    const n = a.states.filter((s) => s.values[j] !== null && s.values[j] !== 0).length;
    if (n >= Math.max(5, a.states.length * 0.4)) return j;
  }
  return a.years.length - 1;
}

// Rank (1 = best) of `who` among items with a value
export function rank(items, who, get, lower = false) {
  const ok = items.filter((x) => get(x) !== null && get(x) !== undefined);
  const me = ok.find((x) => key(x.name) === key(who));
  if (!me) return { rank: null, n: ok.length };
  const v = get(me);
  return { rank: ok.filter((x) => (lower ? get(x) < v : get(x) > v)).length + 1, n: ok.length };
}
