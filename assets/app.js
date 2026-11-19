/* Bihar on RDSS – dashboard script. Reads data/latest.json and data/history.csv */
(function () {
  const COL = { BR: 'var(--br)', SB: 'var(--sb)', NB: 'var(--nb)', IN: 'var(--ref)' };
  const NAME = { BR: 'Bihar', SB: 'SBPDCL', NB: 'NBPDCL', IN: 'India' };
  const isSB = (n) => /SBPDCL|SOUTH BIHAR/i.test(n), isNB = (n) => /NBPDCL|NORTH BIHAR/i.test(n);
  const K = (n) => { const k = String(n || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z]/g, ''); return k === 'CHATTISGARH' ? 'CHHATTISGARH' : k; };
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);
  const f1 = d3.format('.1f'), f2 = d3.format('.2f');
  const inr = (v) => (v === null ? '—' : (+v).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
  const inr2 = (v) => (v === null ? '—' : (+v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  const lakh = (v) => (v === null ? '—' : v >= 1e7 ? f2(v / 1e7) + ' cr' : v >= 1e5 ? f2(v / 1e5) + ' lakh' : inr(v));
  const day = (s) => (s ? d3.utcFormat('%d %b %Y')(new Date(s + 'T00:00:00Z')) : '—');
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (e.className = v) : e.setAttribute(k, v))); if (text !== undefined) e.textContent = text; return e; };
  const b = (t) => el('b', {}, t);

  /* ---------- measures ---------- */
  const PROG = ['cm', 'dm', 'fm', 'bm', 'LT', 'HT', 'DTR', 'SUB'];
  const METRICS = [
    { id: 'cm', label: 'Consumer meters communicating (% of sanctioned)', short: 'Consumer meters', grp: 'sm', pct: true },
    { id: 'dm', label: 'DT meters communicating (% of sanctioned)', short: 'DT meters', grp: 'sm', pct: true },
    { id: 'fm', label: 'Feeder meters communicating (% of sanctioned)', short: 'Feeder meters', grp: 'sm', pct: true },
    { id: 'bm', label: 'Boundary meters communicating (% of sanctioned)', short: 'Boundary meters', grp: 'sm', pct: true },
    { id: 'phys_sm', label: 'Smart metering · physical progress (%)', short: 'Physical progress', grp: 'sm', pct: true },
    { id: 'LT', label: 'LT lines installed (% of sanctioned)', short: 'LT lines', grp: 'lr', pct: true },
    { id: 'HT', label: 'HT lines installed (% of sanctioned)', short: 'HT lines', grp: 'lr', pct: true },
    { id: 'DTR', label: 'Distribution transformers installed (% of sanctioned)', short: 'Transformers', grp: 'lr', pct: true },
    { id: 'SUB', label: 'Substations installed (% of sanctioned)', short: 'Substations', grp: 'lr', pct: true },
    { id: 'phys_ls', label: 'Loss reduction · physical progress (%)', short: 'Physical progress', grp: 'lr', pct: true },
    { id: 'gbs_release_pct', label: 'GBS released (% of GBS sanctioned)', short: 'GBS released %', grp: 'fund', pct: true },
    { id: 'atc', label: 'AT&C loss (%)', short: 'AT&C loss', grp: 'fin', annual: true, lower: true, pct: true },
    { id: 'acs_arr', label: 'ACS-ARR gap (INR/kWh)', short: 'ACS-ARR gap', grp: 'fin', annual: true, lower: true, inrkwh: true },
    { id: 'payable', label: 'Payable days', short: 'Payable days', grp: 'fin', annual: true, lower: true, days: true },
    { id: 'receivable', label: 'Receivable days', short: 'Receivable days', grp: 'fin', annual: true, lower: true, days: true },
  ];
  const M = Object.fromEntries(METRICS.map((m) => [m.id, m]));
  const fmt = (m, v) => (v === null || v === undefined ? '—' : m.pct ? f1(v) + '%' : m.inrkwh ? f2(v) : m.days ? d3.format(',.0f')(v) : f1(v));
  const fmtAxis = (m) => (v) => (m.pct ? d3.format('~f')(v) + '%' : m.inrkwh ? d3.format('.2~f')(v) : d3.format('~s')(v));

  /* ---------- tooltip ---------- */
  const tip = document.getElementById('tip');
  function showTip(ev, lines) {
    tip.replaceChildren(...lines.map(([cls, t]) => el('div', { class: cls }, t)));
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  addEventListener('scroll', hideTip, { passive: true });
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('.chart')) hideTip(); });

  const band = (r) => (!r || !r.rank ? '' : r.rank <= Math.ceil(r.n / 3) ? 'top' : r.rank <= Math.ceil((2 * r.n) / 3) ? 'mid' : 'low');
  const chip = (r) => el('span', { class: 'rk ' + band(r) }, r && r.rank ? `${r.rank} / ${r.n}` : '—');
  const pill = (r) => (r && r.rank ? el('span', { class: 'pill ' + ({ top: 'good', mid: 'mid', low: 'bad' })[band(r)] }, `#${r.rank}/${r.n}`) : '');
  const swatch = (k) => { const sw = el('span', { class: 'sw' + (k === 'IN' ? ' ref' : '') }); if (k !== 'IN') sw.style.background = COL[k]; return sw; };

  /* ---------- ranked dot chart ---------- */
  function dots(box, items, o) {
    box.replaceChildren();
    if (!items.length) { box.append(el('div', { class: 'empty' }, 'No values reported for this measure.')); return; }
    const W = Math.max(260, box.clientWidth), narrow = W < 520;
    const rowH = Math.max(o.rowH || 16, narrow ? 20 : 0);
    const maxLab = narrow ? 16 : 30;
    const lab = (d) => (d.label.length > maxLab ? d.label.slice(0, maxLab - 1) + '…' : d.label);
    const real = items.filter((d) => !d.gap);
    const svg = d3.select(box).append('svg').attr('width', W).attr('role', 'img').attr('aria-label', o.aria);
    const probe = svg.append('text');
    const labW = d3.max(real, (d) => { probe.text(lab(d)); return probe.node().getComputedTextLength(); });
    probe.remove();
    const m = { t: 24, r: narrow ? 44 : 50, b: 6, l: Math.min(labW + 30, W * (narrow ? 0.5 : 0.46)) };
    const H = m.t + items.length * rowH + m.b;
    svg.attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const vals = real.map((d) => d.v).concat(o.ref !== null && o.ref !== undefined ? [o.ref] : []);
    const lo = Math.min(0, d3.min(vals));
    const hi = o.max !== undefined ? Math.max(o.max, d3.max(vals)) : d3.max(vals) || 1;
    const x = d3.scaleLinear().domain([lo, hi]).range([m.l, W - m.r]).nice();
    const idx = new Map(items.map((d, i) => [d, i]));
    const y = (d) => m.t + idx.get(d) * rowH + rowH / 2;
    const ticks = x.ticks(Math.max(2, Math.floor((W - m.l - m.r) / 64)));
    svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', x).attr('x2', x).attr('y1', m.t - 4).attr('y2', H - m.b).attr('stroke', (t) => (t === 0 && lo < 0 ? 'var(--ink-3)' : 'var(--grid)'));
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', x).attr('y', m.t - 10).attr('text-anchor', 'middle').text(o.axis);
    if (o.ref !== null && o.ref !== undefined) {
      svg.append('line').attr('x1', x(o.ref)).attr('x2', x(o.ref)).attr('y1', m.t - 4).attr('y2', H - m.b).attr('stroke', 'var(--ref)').attr('stroke-dasharray', '4 3');
      svg.append('text').attr('x', x(o.ref) - 4).attr('y', H - m.b - 2).attr('text-anchor', 'end').attr('fill', 'var(--ref)').text('India ' + o.fmt(o.ref));
    }
    svg.append('g').selectAll('text').data(items.filter((d) => d.gap)).join('text').attr('x', m.l - 8).attr('y', (d) => y(d) + 4).attr('text-anchor', 'end').text((d) => `⋯ ${d.n} more`);
    const g = svg.append('g').selectAll('g').data(real).join('g');
    g.filter((d) => d.color).append('rect').attr('x', 0).attr('width', W).attr('y', (d) => y(d) - rowH / 2).attr('height', rowH).attr('fill', '#f1f5f9');
    g.append('text').attr('x', 0).attr('y', (d) => y(d) + 4).attr('class', (d) => (d.color ? 'hl' : null)).text((d) => d.rank);
    g.append('text').attr('x', m.l - 8).attr('y', (d) => y(d) + 4).attr('text-anchor', 'end').attr('class', (d) => (d.color ? 'hl' : null)).text(lab);
    g.append('line').attr('x1', x(Math.max(lo, 0))).attr('x2', (d) => x(d.v)).attr('y1', (d) => y(d)).attr('y2', (d) => y(d)).attr('stroke', (d) => d.color || 'var(--line)').attr('stroke-width', (d) => (d.color ? 2 : 1));
    g.append('circle').attr('cx', (d) => x(d.v)).attr('cy', (d) => y(d)).attr('r', (d) => (d.color ? 5.5 : 3.5)).attr('fill', (d) => d.color || 'var(--muted-dot)').attr('stroke', '#fff').attr('stroke-width', 1.5);
    g.filter((d) => d.color).append('text').attr('class', 'hl').attr('x', (d) => Math.min(x(d.v) + 9, W - 40)).attr('y', (d) => y(d) - (x(d.v) + 9 > W - 40 ? 7 : -4)).text((d) => o.fmt(d.v));
    g.append('rect').attr('x', 0).attr('width', W).attr('y', (d) => y(d) - rowH / 2).attr('height', rowH).attr('fill', 'transparent')
      .on('pointermove pointerdown', (ev, d) => showTip(ev, [['t', `#${d.rank} of ${o.total || real.length} · ${d.label}`], ['', `${o.name}: ${o.fmt(d.v)}`], ...(d.sub ? [['m', d.sub]] : [])]))
      .on('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hideTip(); });
  }

  // keep the top, the bottom and the rows around the highlighted ones; fold the rest
  function compact(items, top = 5, bottom = 3, around = 2) {
    const keep = new Set();
    items.forEach((d, i) => { if (i < top || i >= items.length - bottom) keep.add(i); if (d.color) for (let j = i - around; j <= i + around; j++) keep.add(j); });
    const out = []; let skipped = 0;
    items.forEach((d, i) => { if (keep.has(i)) { if (skipped) { out.push({ gap: true, n: skipped }); skipped = 0; } out.push(d); } else skipped++; });
    if (skipped) out.push({ gap: true, n: skipped });
    return out;
  }

  /* ---------- line chart over categories (financial years, or days) ---------- */
  function lines(box, cats, series, o) {
    box.replaceChildren();
    const all = series.flatMap((s) => s.pts);
    if (!all.length) { box.append(el('div', { class: 'empty' }, o.empty || 'No values yet for this measure.')); return; }
    const W = Math.max(260, box.clientWidth), H = W < 520 ? 230 : 280, m = { t: 14, r: 66, b: 28, l: 44 };
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', o.aria);
    const x = d3.scalePoint().domain(cats).range([m.l + (cats.length === 1 ? (W - m.l - m.r) / 2 : 0), W - m.r - (cats.length === 1 ? (W - m.l - m.r) / 2 : 0)]).padding(cats.length > 1 ? 0.15 : 0);
    const ext = d3.extent(all, (p) => p.v);
    const pad = (ext[1] - ext[0]) * 0.15 || Math.abs(ext[1]) * 0.1 || 1;
    const y = d3.scaleLinear().domain([o.zero ? Math.min(0, ext[0]) : ext[0] - pad, ext[1] + pad]).range([H - m.b, m.t]).nice();
    svg.append('g').selectAll('line').data(y.ticks(5)).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', (t) => (t === 0 ? 'var(--line)' : 'var(--grid)'));
    svg.append('g').selectAll('text').data(y.ticks(5)).join('text').attr('x', m.l - 6).attr('y', (t) => y(t) + 4).attr('text-anchor', 'end').text(o.axis);
    const every = Math.max(1, Math.ceil(cats.length / Math.max(2, Math.floor((W - m.l - m.r) / 70))));
    svg.append('g').selectAll('text').data(cats.filter((c, i) => i % every === 0 || i === cats.length - 1)).join('text').attr('x', x).attr('y', H - 8).attr('text-anchor', 'middle').text(o.catLabel || ((c) => c));
    const ln = d3.line().defined((p) => p.v !== null).x((p) => x(p.c)).y((p) => y(p.v));
    const ends = [];
    series.forEach((s) => {
      if (!s.pts.length) return;
      svg.append('path').attr('d', ln(s.pts)).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2).attr('stroke-dasharray', s.dash ? '5 4' : null);
      svg.append('g').selectAll('circle').data(s.pts).join('circle').attr('cx', (p) => x(p.c)).attr('cy', (p) => y(p.v)).attr('r', s.pts.length > 40 ? 0 : 3.5).attr('fill', s.color);
      const last = s.pts[s.pts.length - 1];
      ends.push({ y: y(last.v), x: x(last.c), t: s.name, c: s.color });
    });
    ends.sort((a, z) => a.y - z.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach((e) => svg.append('text').attr('x', e.x + 8).attr('y', e.y + 4).attr('class', 'hl').style('fill', e.c).text(e.t));
    const cross = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', 'var(--ref)').attr('opacity', 0);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove pointerdown', (ev) => {
        const [px] = d3.pointer(ev);
        const c = cats.reduce((a, z) => (Math.abs(x(z) - px) < Math.abs(x(a) - px) ? z : a));
        cross.attr('x1', x(c)).attr('x2', x(c)).attr('opacity', 0.6);
        showTip(ev, [['t', (o.catLabel || ((q) => q))(c)], ...series.map((s) => { const p = s.pts.find((q) => q.c === c); return ['', `${s.name}: ${p ? o.fmt(p.v) : '—'}`]; })]);
      })
      .on('pointerleave', (ev) => { if (ev.pointerType === 'mouse') { cross.attr('opacity', 0); hideTip(); } });
  }

  /* ---------- page ---------- */
  Promise.all([
    d3.json('data/latest.json?v=' + Date.now()),
    d3.csv('data/history.csv?v=' + Date.now()).catch(() => []),
  ]).then(([latest, history]) => render(latest, history))
    .catch((e) => { document.getElementById('lede').textContent = 'The first data update has not finished yet. Please check back in a few minutes. (' + e.message + ')'; document.getElementById('fresh').textContent = 'Waiting for data'; });

  function render(L, history) {
    const P = L.progress || {}, PH = L.physical || {}, F = L.funds || {}, A = L.annual || {};
    // year index with figures for most states
    const yIdx = (a) => { for (let j = a.years.length - 1; j >= 0; j--) { const n = a.states.filter((s) => num(s.values[j])).length; if (n >= Math.max(5, a.states.length * 0.4)) return j; } return a.years.length - 1; };
    const zeroIsBlank = (id, v) => (v === 0 && id !== 'acs_arr' ? null : num(v));
    const FY = {}; Object.entries(A).forEach(([id, a]) => { if (a) FY[id] = a.years[yIdx(a)]; });

    /* --- state table --- */
    const S = new Map();
    const st = (name) => { const k = K(name); if (!S.has(k)) S.set(k, { key: k, name, v: {}, raw: {} }); return S.get(k); };
    PROG.forEach((id) => (P[id]?.states || []).forEach((r) => { if (r.sanctioned > 0) { const s = st(r.name); s.v[id] = num(r.pct); s.raw[id] = r; } }));
    ['sm', 'ls'].forEach((id) => (PH[id]?.states || []).forEach((r) => { if (num(r.pct) > 0) st(r.name).v['phys_' + id] = num(r.pct); }));
    const gs = F.gbs_sanctioned?.states || [], gr = F.gbs_released?.states || [];
    gs.forEach((r) => { if (r.total > 0) { const rel = gr.find((q) => K(q.name) === K(r.name)); if (rel) { const s = st(r.name); s.v.gbs_release_pct = +(100 * rel.total / r.total).toFixed(2); s.raw.gbs = { sanctioned: r.total, released: rel.total }; } } });
    Object.entries(A).forEach(([id, a]) => { if (!a) return; const j = a.years.indexOf(FY[id]); a.states.forEach((r) => { const v = zeroIsBlank(id, r.values[j]); if (v !== null) st(r.name).v[id] = v; }); });
    const states = [...S.values()];
    const BRs = S.get('BIHAR') || { v: {}, raw: {} };

    /* --- DISCOM table (yearly measures only: RDSS publishes DISCOM-wise yearly figures for all states) --- */
    const Dm = new Map();
    Object.entries(A).forEach(([id, a]) => { if (!a) return; const j = a.years.indexOf(FY[id]); a.discoms.forEach((r) => { const k = K(r.state) + '|' + K(r.name); if (!Dm.has(k)) Dm.set(k, { key: k, name: r.name, state: r.state, v: {} }); const v = zeroIsBlank(id, r.values[j]); if (v !== null) Dm.get(k).v[id] = v; }); });
    const discoms = [...Dm.values()];
    const dKey = (re) => discoms.find((d) => K(d.state) === 'BIHAR' && re(d.name))?.key;
    const SBk = dKey(isSB), NBk = dKey(isNB);

    /* --- values for Bihar / SBPDCL / NBPDCL / India --- */
    const bdisc = (list, who) => (list || []).find((r) => (who === 'SB' ? isSB(r.name) : isNB(r.name)));
    function val(m, who) {
      const id = m.id;
      if (who === 'BR') return num(BRs.v[id]);
      if (PROG.includes(id)) return who === 'IN' ? num(P[id]?.india?.pct) : num(bdisc(P[id]?.bihar_discoms, who)?.pct);
      if (id.startsWith('phys_')) { const t = id.slice(5); if (who === 'IN') return num(L.india_tiles?.[t === 'sm' ? 'sm_physical' : 'lr_physical']) || null; return num(bdisc(PH[t]?.bihar_discoms, who)?.pct); }
      if (id === 'gbs_release_pct') {
        if (who === 'IN') { const a = F.gbs_released?.india?.total, z = F.gbs_sanctioned?.india?.total; return a && z ? 100 * a / z : null; }
        const a = bdisc(F.gbs_released?.bihar_discoms, who)?.total, z = bdisc(F.gbs_sanctioned?.bihar_discoms, who)?.total; return a && z ? 100 * a / z : null;
      }
      if (m.annual) {
        const a = A[id]; if (!a) return null; const j = a.years.indexOf(FY[id]);
        if (who === 'IN') return zeroIsBlank(id, a.india?.[j]);
        const d = Dm.get(who === 'SB' ? SBk : NBk); return d ? num(d.v[id]) : null;
      }
      return null;
    }
    function rankIn(list, m, k) {
      const ok = list.filter((r) => num(r.v[m.id]) !== null);
      const me = ok.find((r) => r.key === k);
      if (!me) return { rank: null, n: ok.length };
      const v = me.v[m.id];
      return { rank: ok.filter((r) => (m.lower ? r.v[m.id] < v : r.v[m.id] > v)).length + 1, n: ok.length };
    }
    const rBR = (m) => rankIn(states, m, 'BIHAR');
    const rD = (m, who) => (m.annual ? rankIn(discoms, m, who === 'SB' ? SBk : NBk) : null);
    const label = (m) => (m.annual && FY[m.id] ? `${m.label} · ${FY[m.id]}` : m.label);

    /* --- freshness --- */
    const fetched = new Date(L.fetched_at);
    const ageH = (Date.now() - fetched) / 3600e3;
    document.getElementById('fresh').textContent = 'Updated ' + d3.timeFormat('%d %b %Y, %H:%M')(fetched) + ' IST';
    document.getElementById('fresh-dot').className = 'dot ' + (ageH < 36 && !(L.errors || []).length ? 'ok' : 'old');
    const fyAll = [...new Set(Object.values(FY))].join(', ');
    const failed = (L.errors || []).length;
    document.getElementById('fresh-sub').textContent = (fyAll ? `Yearly figures ${fyAll}` : '') + (failed ? ` · ${failed} page${failed > 1 ? 's' : ''} kept from earlier` : '');

    /* --- lede --- */
    const lede = document.getElementById('lede'); lede.replaceChildren();
    const cm = BRs.raw.cm, rcm = rBR(M.cm);
    if (cm) lede.append('Bihar has ', b(lakh(cm.done)), ' of ', b(lakh(cm.sanctioned)), ' sanctioned consumer smart meters communicating (', b(f1(cm.pct) + '%'), ') — ', b(`${rcm.rank} of ${rcm.n}`), ' states; India ', b(fmt(M.cm, val(M.cm, 'IN'))), '. ');
    const ls = val(M.phys_ls, 'BR');
    if (ls !== null) lede.append('Loss reduction works are at ', b(f1(ls) + '%'), ' physical progress. ');
    const atc = A.atc;
    if (atc) { const br = atc.states.find((s) => K(s.name) === 'BIHAR'); const j = atc.years.indexOf(FY.atc); if (br && num(br.values[0]) !== null && num(br.values[j]) !== null) lede.append('AT&C loss fell from ', b(f2(br.values[0]) + '%'), ` in ${atc.years[0]} to `, b(f2(br.values[j]) + '%'), ` in ${FY.atc}.`); }

    /* --- KPIs --- */
    const kpis = document.getElementById('kpis'); kpis.replaceChildren();
    const kpi = (k, v, unit, cParts) => { const d = el('div', { class: 'kpi' }); d.append(el('div', { class: 'k' }, k)); const vv = el('div', { class: 'v' }, v); if (unit) vv.append(el('small', {}, unit)); d.append(vv); const c = el('div', { class: 'c' }); c.append(...cParts); d.append(c); kpis.append(d); };
    const kp = (m, k, unit) => { const v = val(m, 'BR'); const s = fmt(m, v); kpi(k, m.pct ? s.replace('%', '') : s, m.pct ? '%' : unit, ['India ', b(fmt(m, val(m, 'IN'))), ' ', pill(rBR(m))]); };
    kp(M.cm, 'Consumer meters communicating');
    kp(M.phys_sm, 'Smart metering progress');
    kp(M.phys_ls, 'Loss reduction progress');
    kp(M.atc, `AT&C loss · ${FY.atc || ''}`);
    kp(M.acs_arr, `ACS-ARR gap · ${FY.acs_arr || ''}`, 'INR/kWh');
    if (BRs.raw.gbs) kpi('GBS released', inr(BRs.raw.gbs.released), 'INR Cr', [b(f1(BRs.v.gbs_release_pct) + '%'), ' of sanctioned ', pill(rBR(M.gbs_release_pct))]);

    /* --- works card: two tracks --- */
    const whoSel = document.getElementById('works-who');
    [['BR', 'Bihar'], ['SB', 'SBPDCL'], ['NB', 'NBPDCL']].forEach(([k, t]) => whoSel.append(new Option(t, k)));
    function fundsFor(who, part) {
      const pick = (f) => (who === 'BR' ? (F[f]?.states || []).find((r) => K(r.name) === 'BIHAR') : bdisc(F[f]?.bihar_discoms, who));
      const c = pick('sanctioned_cost'), s = pick('gbs_sanctioned'), r = pick('gbs_released');
      const sum = (o, a, z) => (o && (num(o[a]) !== null || num(o[z]) !== null) ? (num(o[a]) || 0) + (num(o[z]) || 0) : null);
      return [['Sanctioned cost', sum(c, part, part + '_pma')], ['GBS sanctioned', sum(s, part, part + '_pma')], ['GBS released', sum(r, part, part + '_pma')]];
    }
    function drawWorks() {
      const who = whoSel.value, box = document.getElementById('tracks'); box.replaceChildren();
      const raw = (id) => (who === 'BR' ? BRs.raw[id] : bdisc(P[id]?.bihar_discoms, who));
      [['Smart metering', 'sm', 'phys_sm', ['cm', 'dm', 'fm', 'bm']], ['Loss reduction', 'lr', 'phys_ls', ['LT', 'HT', 'DTR', 'SUB']]].forEach(([title, part, phys, ids]) => {
        const t = el('div', { class: 'trk' });
        const h = el('div', { class: 'trk-h' }); h.append(el('h3', {}, title));
        const pv = val(M[phys], who);
        const pp = el('span', { class: 'pp' }); pp.append(b(pv === null ? '—' : f1(pv) + '%'), 'physical progress'); h.append(pp); t.append(h);
        const fr = fundsFor(who, part);
        if (fr.some(([, v]) => v !== null)) { const fd = el('div', { class: 'funds' }); fr.forEach(([k, v]) => { const d = el('div', {}, k + ' (INR Cr)'); d.prepend(b(v === null ? '—' : inr2(+v.toFixed(2)))); fd.append(d); }); t.append(fd); }
        ids.forEach((id) => {
          const r = raw(id), meta = P[id] || {}, m = M[id];
          const row = el('div', { class: 'wk' });
          const n = el('div', { class: 'wk-n' }, meta.label || m.short); n.append(el('small', {}, meta.unit || '')); row.append(n);
          const bw = el('div', { class: 'wk-b' });
          const bar = el('div', { class: 'bar' }); const fill = el('i'); fill.style.width = '0%';
          if (who === 'SB' || who === 'NB') fill.style.background = COL[who];
          bar.append(fill);
          const ref = val(m, 'IN'); if (ref !== null) { const rf = el('span', { class: 'ref', title: 'India ' + fmt(m, ref) }); rf.style.left = Math.min(ref, 100) + '%'; bar.append(rf); }
          bw.append(bar, el('span', { class: 'wk-p' }, r ? fmt(m, num(r.pct)) : '—')); row.append(bw);
          const c = el('div', { class: 'wk-c' }); if (who === 'BR') c.append(chip(rBR(m))); row.append(c);
          const s = el('div', { class: 'wk-s' });
          if (r) [['Sanctioned', r.sanctioned], ['Awarded', r.awarded], [meta.done || 'Done', r.done]].forEach(([k, v]) => { const sp = el('span', {}, k + ' '); sp.append(b(inr(num(v)))); s.append(sp); });
          else s.append('Not reported');
          row.append(s);
          t.append(row);
          requestAnimationFrame(() => { fill.style.width = Math.min(num(r?.pct) || 0, 100) + '%'; });
        });
        box.append(t);
      });
    }
    whoSel.addEventListener('change', drawWorks);

    /* --- SBPDCL vs NBPDCL --- */
    const CMP = [
      ['Smart metering · % communicating', ['cm', 'dm', 'fm', 'bm', 'phys_sm']],
      ['Loss reduction · % installed', ['LT', 'HT', 'DTR', 'SUB', 'phys_ls']],
      ['Funds', ['gbs_release_pct']],
      [`Finances · ${FY.atc || 'latest year'}`, ['atc', 'acs_arr', 'payable', 'receivable']],
    ];
    const shortCmp = { phys_sm: 'Physical %', phys_ls: 'Physical %', gbs_release_pct: 'GBS released %', acs_arr: 'ACS-ARR (₹/kWh)', atc: 'AT&C %' };
    const UT = ['SB', 'NB', 'BR', 'IN'];
    const cell = (who, m) => {
      const v = val(m, who); const td = el('td', {}, fmt(m, v));
      if (PROG.includes(m.id)) { const r = who === 'BR' ? BRs.raw[m.id] : who === 'IN' ? P[m.id]?.india : bdisc(P[m.id]?.bihar_discoms, who); if (r) td.title = `${inr(num(r.done))} of ${inr(num(r.sanctioned))} ${P[m.id].unit}`; }
      if (who === 'SB' || who === 'NB') { const a1 = val(m, 'SB'), a2 = val(m, 'NB'); if (a1 !== null && a2 !== null && a1 !== a2 && v === (m.lower ? Math.min(a1, a2) : Math.max(a1, a2))) td.className = 'best'; }
      if (who === 'IN') td.classList.add('refc');
      return td;
    };
    const drawCmp = (narrow) => {
      const box = document.getElementById('cmp-box'); box.replaceChildren();
      const t = el('table', { class: 'tbl' + (narrow ? ' tbl-narrow' : '') }), th = el('thead'), tb = el('tbody');
      if (!narrow) {
        const g1 = el('tr', { class: 'grp' }); g1.append(el('th'));
        CMP.forEach(([g, ids]) => g1.append(Object.assign(el('th', {}, g), { colSpan: ids.length })));
        const g2 = el('tr'); g2.append(el('th', {}, 'Utility'), ...CMP.flatMap(([, ids]) => ids.map((id) => el('th', {}, shortCmp[id] || M[id].short))));
        th.append(g1, g2);
        UT.forEach((who) => { const tr = el('tr', { class: who === 'IN' ? 'ref' : '' }); const t0 = el('td'); t0.append(swatch(who), NAME[who]); tr.append(t0); CMP.forEach(([, ids]) => ids.forEach((id) => tr.append(cell(who, M[id])))); tb.append(tr); });
      } else {
        const h = el('tr'); h.append(el('th')); UT.forEach((who) => { const c = el('th'); c.append(swatch(who), NAME[who]); h.append(c); }); th.append(h);
        CMP.forEach(([g, ids]) => {
          const gr2 = el('tr', { class: 'sec' }); gr2.append(Object.assign(el('td', {}, g), { colSpan: UT.length + 1 })); tb.append(gr2);
          ids.forEach((id) => { const tr = el('tr'); tr.append(el('td', {}, shortCmp[id] || M[id].short)); UT.forEach((who) => tr.append(cell(who, M[id]))); tb.append(tr); });
        });
      }
      t.append(th, tb); box.append(t);
    };

    /* --- ranks --- */
    const drawRankTbl = (narrow) => {
      const box = document.getElementById('rank-box'); box.replaceChildren();
      if (!narrow) {
        const t = el('table', { class: 'tbl' }), rh = el('thead'), rr = el('tr');
        rr.append(...['Measure', 'Bihar', 'Bihar among states', 'SBPDCL', 'SBPDCL among DISCOMs', 'NBPDCL', 'NBPDCL among DISCOMs'].map((x) => el('th', {}, x))); rh.append(rr);
        const rb = el('tbody');
        METRICS.forEach((m) => {
          const tr = el('tr'); const td = (x) => { const c = el('td'); c.append(x); return c; };
          tr.append(el('td', {}, label(m)), el('td', {}, fmt(m, val(m, 'BR'))), td(chip(rBR(m))),
            el('td', {}, fmt(m, val(m, 'SB'))), td(m.annual ? chip(rD(m, 'SB')) : '—'),
            el('td', {}, fmt(m, val(m, 'NB'))), td(m.annual ? chip(rD(m, 'NB')) : '—'));
          rb.append(tr);
        });
        t.append(rh, rb); box.append(t);
      } else {
        const list = el('div', { class: 'rk-list' });
        METRICS.forEach((m) => {
          const card = el('div', { class: 'rk-card' }); card.dataset.m = m.id;
          card.append(el('div', { class: 'rk-t' }, label(m)));
          const grid = el('div', { class: 'rk-g' });
          ['BR', 'SB', 'NB'].forEach((who) => {
            const c = el('div', { class: 'rk-c' }); const n1 = el('div', { class: 'rk-n' }); n1.append(swatch(who), NAME[who]);
            c.append(n1, el('div', { class: 'rk-v' }, fmt(m, val(m, who))));
            const r = who === 'BR' ? rBR(m) : rD(m, who); if (r) c.append(chip(r));
            grid.append(c);
          });
          card.append(grid); list.append(card);
        });
        box.append(list);
        const cards = [...list.children];
        if (innerWidth < 640 && cards.length > 4) {
          let open = false; const KEY = ['cm', 'phys_ls', 'atc', 'acs_arr'];
          const btn = el('button', { type: 'button', class: 'more' });
          const set = () => { cards.forEach((c) => { c.hidden = !open && !KEY.includes(c.dataset.m); }); btn.textContent = open ? 'Show fewer measures' : `Show all ${cards.length} measures`; };
          btn.addEventListener('click', () => { open = !open; set(); }); set(); box.append(btn);
        }
      }
    };

    /* --- legend + selectors --- */
    const lg = document.getElementById('legend'); lg.replaceChildren();
    [['Bihar', 'var(--br)'], ['SBPDCL', 'var(--sb)'], ['NBPDCL', 'var(--nb)'], ['Others', 'var(--muted-dot)']].forEach(([t, c]) => { const s = el('span'); const w = el('span', { class: 'sw' }); w.style.background = c; s.append(w, t); lg.append(s); });
    const ri = el('span'); ri.append(el('span', { class: 'sw ref' }), 'India'); lg.append(ri);
    const sel = document.getElementById('metric'), selY = document.getElementById('metric-year'), selT = document.getElementById('metric-trend');
    METRICS.forEach((m) => sel.append(new Option(label(m), m.id)));
    METRICS.filter((m) => m.annual).forEach((m) => selY.append(new Option(m.label, m.id)));
    const TREND = METRICS.filter((m) => !m.annual);
    TREND.forEach((m) => selT.append(new Option(m.label, m.id)));
    const qs = new URLSearchParams(location.search); if (M[qs.get('m')]) sel.value = qs.get('m');

    /* --- ranked dots --- */
    let showAllD = false, showAllS = false;
    document.getElementById('more-discoms').addEventListener('click', () => { showAllD = !showAllD; drawRank(); });
    document.getElementById('more-states').addEventListener('click', () => { showAllS = !showAllS; drawRank(); });
    const drawRank = () => {
      const m = M[sel.value];
      const rk = (arr) => { arr.sort((a, z) => (m.lower ? a.v - z.v : z.v - a.v)).forEach((d, i) => { d.rank = i + 1; }); return arr; };
      const st2 = rk(states.filter((r) => num(r.v[m.id]) !== null).map((r) => {
        const raw = r.raw[m.id];
        return { label: r.name, v: r.v[m.id], color: r.key === 'BIHAR' ? COL.BR : null, sub: raw ? `${inr(num(raw.done))} of ${inr(num(raw.sanctioned))} ${P[m.id].unit}` : m.id === 'gbs_release_pct' && r.raw.gbs ? `INR ${inr(r.raw.gbs.released)} Cr of ${inr(r.raw.gbs.sanctioned)} Cr` : '' };
      }));
      const o = { ref: val(m, 'IN'), fmt: (v) => fmt(m, v), axis: fmtAxis(m), name: m.short, max: m.pct && !m.annual ? 100 : undefined };
      const small = innerWidth < 900;
      const bs = document.getElementById('more-states');
      bs.hidden = !(small && st2.length > 14); bs.textContent = showAllS ? 'Show fewer' : `Show all ${st2.length} states`;
      const dc = document.getElementById('discom-col'), two = document.getElementById('compare-two');
      dc.hidden = !m.annual; two.style.gridTemplateColumns = m.annual ? '' : '1fr';
      dots(document.getElementById('chart-states'), small && !showAllS && st2.length > 14 ? compact(st2) : st2, { ...o, rowH: 18, total: st2.length, aria: `States ranked by ${m.label}` });
      if (m.annual) {
        const di = rk(discoms.filter((r) => num(r.v[m.id]) !== null).map((r) => ({ label: r.name, v: r.v[m.id], color: r.key === SBk ? COL.SB : r.key === NBk ? COL.NB : null, sub: r.state })));
        const bd = document.getElementById('more-discoms');
        bd.hidden = !small; bd.textContent = showAllD ? 'Show fewer' : `Show all ${di.length} DISCOMs`;
        dots(document.getElementById('chart-discoms'), small && !showAllD ? compact(di) : di, { ...o, rowH: 14, total: di.length, aria: `DISCOMs ranked by ${m.label}` });
      }
    };

    /* --- year by year --- */
    const drawYears = () => {
      const m = M[selY.value], a = A[m.id];
      const box = document.getElementById('chart-years');
      if (!a) { box.replaceChildren(el('div', { class: 'empty' }, 'Not available yet.')); return; }
      const pick = (vals) => a.years.map((c, j) => ({ c, v: zeroIsBlank(m.id, vals?.[j]) })).filter((p) => p.v !== null);
      const br = a.states.find((s) => K(s.name) === 'BIHAR'), sb = Dm.get(SBk) && a.discoms.find((d) => K(d.state) === 'BIHAR' && isSB(d.name)), nb = a.discoms.find((d) => K(d.state) === 'BIHAR' && isNB(d.name));
      lines(box, a.years, [
        { name: 'Bihar', color: COL.BR, pts: pick(br?.values) },
        { name: 'SBPDCL', color: COL.SB, pts: pick(sb?.values) },
        { name: 'NBPDCL', color: COL.NB, pts: pick(nb?.values) },
        { name: 'India', color: COL.IN, dash: true, pts: pick(a.india) },
      ], { fmt: (v) => fmt(m, v), axis: fmtAxis(m), zero: m.id !== 'acs_arr', catLabel: (c) => c.replace(/^FY\s*/, 'FY '), aria: `${m.label} by year for Bihar, SBPDCL, NBPDCL and India` });
    };

    /* --- day by day --- */
    const drawTrend = () => {
      const m = M[selT.value];
      const rows = history.filter((r) => r.measure === m.id && num(r.value) !== null);
      const dates = [...new Set(rows.map((r) => r.date))].sort();
      document.getElementById('trend-hint').textContent = dates.length > 1 ? `${dates.length} days` : 'Builds up daily';
      const ser = (k) => ({ name: NAME[k], color: COL[k], dash: k === 'IN', pts: rows.filter((r) => r.entity === NAME[k]).sort((a, z) => (a.date < z.date ? -1 : 1)).map((r) => ({ c: r.date, v: num(r.value) })) });
      lines(document.getElementById('chart-trend'), dates, ['BR', 'SB', 'NB', 'IN'].map(ser), { fmt: (v) => fmt(m, v), axis: fmtAxis(m), zero: false, catLabel: (c) => d3.utcFormat('%d %b')(new Date(c + 'T00:00:00Z')), empty: 'Builds up from the first daily update.', aria: `${m.label} day by day` });
    };

    sel.addEventListener('change', drawRank);
    selY.addEventListener('change', drawYears);
    selT.addEventListener('change', drawTrend);
    const all = () => { const nar = innerWidth < 1000; drawWorks(); drawCmp(true); drawRankTbl(nar); drawRank(); drawYears(); drawTrend(); };
    all();
    let w = innerWidth; addEventListener('resize', () => { if (Math.abs(innerWidth - w) > 30) { w = innerWidth; all(); } });
  }
})();
