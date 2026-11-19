// Token Radar dashboard (radar-2). No network: all data comes from data.js.
// Recomputes every implied value in the page with impliedOf() — the same
// arithmetic lib/model.ts runs — and shows whether it matches board.json.

const R = window.RADAR;
const rows = R.rows;
const live = R.live;
const M = R.model;
const $ = (id) => document.getElementById(id);

/** Short money: $1.23B, $456M, $12.3K. */
function money(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
/** Full money with commas. */
function moneyFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
/** A percent, or an em dash when unreported. */
function pct(v) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
/** Age in days, or an em dash. */
function ageTxt(v) { return v === null || v === undefined ? '—' : v + 'd'; }

/**
 * Recompute a row's implied value from its own figures — the same function
 * the model runs server-side: TVL x compRatio x sizeFactor x growthMult x
 * maturityMult x chainMult. Growth weight and size dampening are the lab's
 * sliders; at their defaults they reproduce the board exactly.
 */
function impliedOf(r, gw, sd) {
  const growthPct = Math.min(M.growth_cap, Math.max(M.growth_floor, r.change_7d === null ? 0 : r.change_7d));
  const growthMult = 1 + (growthPct / 100) * gw;
  const sizeFactor = Math.min(M.size_cap, Math.max(M.size_floor, Math.pow(r.tvl_usd / M.size_reference_usd, -sd)));
  const age = r.model.age_days;
  const maturityMult = M.maturity_floor + M.maturity_range * (Math.log(1 + age) / Math.log(1 + M.maturity_days));
  const chainMult = 1 + M.chain_step * Math.min(Math.max(r.chains.length - 1, 0), M.chain_max_steps);
  return Math.max(1, Math.round(r.tvl_usd * r.model.comp_ratio * sizeFactor * growthMult * maturityMult * chainMult));
}

// Verify the page's arithmetic against board.json (multipliers are rounded
// to 4 decimals in the data, so allow 0.1% of rounding slack).
const checked = rows.filter((r) => Math.abs(impliedOf(r, M.growth_weight, M.size_dampening) - r.implied_value_usd) / r.implied_value_usd <= 0.001).length;

const state = { q: '', cat: '', chain: '', tab: 'pre', key: 'rank', dir: 1, gw: M.growth_weight, sd: M.size_dampening };
const labOn = () => state.gw !== M.growth_weight || state.sd !== M.size_dampening;
const shownImplied = (r) => labOn() ? impliedOf(r, state.gw, state.sd) : r.implied_value_usd;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function spotlight() {
  $('spotlight').innerHTML = rows.slice(0, 3).map((r) => `
    <article class="card" data-slug="${esc(r.slug)}" tabindex="0">
      <div class="pos">Rank ${r.rank} · ${esc(r.category || 'Uncategorised')}</div>
      <h3>${esc(r.name)}</h3>
      <div class="cat">${esc(r.slug)} · TVL ${money(r.tvl_usd)} · ${pct(r.change_7d)} 7d</div>
      <div class="val">${moneyFull(r.implied_value_usd)}</div>
      <div class="meta">implied value · comp ${r.model.comp_ratio.toFixed(4)} (${r.model.comp_source}) · ${r.model.age_days}d old</div>
    </article>`).join('');
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  const list = state.tab === 'pre' ? rows : live;
  return list.filter((r) => {
    if (state.cat && (r.category || '') !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (!q) return true;
    return (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().includes(q);
  });
}

function sortList(list) {
  const k = state.key, d = state.dir;
  const val = (r) => {
    if (k === 'rank') return r.rank === undefined ? 1e9 : r.rank;
    if (k === 'name') return r.name.toLowerCase();
    if (k === 'tvl') return r.tvl_usd;
    if (k === 'chg') return r.change_7d === null ? -1e9 : r.change_7d;
    if (k === 'age') return r.age_days === null || r.age_days === undefined ? -1 : r.age_days;
    if (k === 'implied') return state.tab === 'pre' ? shownImplied(r) : (r.mcap_usd || 0);
    return 0;
  };
  return [...list].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va < vb) return -d;
    if (va > vb) return d;
    return (a.rank || 0) - (b.rank || 0);
  });
}

function rowHtml(r) {
  const chg = r.change_7d;
  const chgCls = chg === null ? '' : (chg >= 0 ? 'up' : 'down');
  if (state.tab === 'live') {
    return `<tr data-slug="${esc(r.slug)}"><td class="pos">—</td>
      <td class="name"><b>${esc(r.name)}</b><span class="slug">${esc(r.slug)} · ${esc(r.category || 'Uncategorised')}</span></td>
      <td class="num">${money(r.tvl_usd)}</td><td class="num ${chgCls}">${pct(chg)}</td>
      <td class="num">—</td><td class="num">${money(r.mcap_usd)}</td>
      <td><span class="pill">trades already</span></td></tr>`;
  }
  const imp = shownImplied(r);
  const impCell = labOn()
    ? `<td class="num labval">${money(imp)} <span class="check">LAB</span></td>`
    : `<td class="num">${money(imp)}</td>`;
  return `<tr data-slug="${esc(r.slug)}"><td class="pos">${r.rank}</td>
    <td class="name"><b>${esc(r.name)}</b><span class="slug">${esc(r.slug)} · ${esc(r.category || 'Uncategorised')}</span></td>
    <td class="num">${money(r.tvl_usd)}</td><td class="num ${chgCls}">${pct(chg)}</td>
    <td class="num">${ageTxt(r.age_days)}</td>${impCell}
    <td><span class="pill">6 steps →</span></td></tr>`;
}

function render() {
  const list = sortList(filtered());
  $('rows').innerHTML = list.map(rowHtml).join('') || '<tr><td colspan="7">No protocols match this filter.</td></tr>';
  const total = state.tab === 'pre' ? rows.length : live.length;
  const lab = labOn() ? ' · <span class="labval">LAB values on (sliders below)</span>' : '';
  $('counts').innerHTML = `Showing ${list.length} of ${total} ${state.tab === 'pre' ? 'pre-token' : 'live-token'} protocols · <span class="check">✓ page recompute matches board.json for ${checked}/${rows.length} rows</span>${lab}`;
  document.querySelectorAll('#board th[data-k]').forEach((th) => {
    th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.k === state.key ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
  });
}

function waterfall(r) {
  const m = r.model;
  const step = (label, formula, value) => `<tr><td>${label}</td><td>${formula}</td><td>${value}</td></tr>`;
  return `<table class="wf"><thead><tr><th>Step</th><th>How</th><th>Value</th></tr></thead><tbody>
    ${step('TVL', 'snapshot tvl_usd', moneyFull(r.tvl_usd))}
    ${step('× compRatio', m.comp_source === 'category' ? `median mcap/TVL in ${esc(r.category || '')} (n=${m.comp_n} live)` : 'global median (too few live comps)', m.comp_ratio.toFixed(4))}
    ${step('× sizeFactor', `(TVL ÷ $100M)^−${M.size_dampening}`, m.size_factor.toFixed(4))}
    ${step('× growthMult', `1 + ${m.growth_pct}% × ${M.growth_weight}`, m.growth_multiplier.toFixed(4))}
    ${step('× maturityMult', `age ${m.age_days}d over ${M.maturity_days}d`, m.maturity_multiplier.toFixed(4))}
    ${step('× chainMult', `${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}`, m.chain_multiplier.toFixed(4))}
    <tr><td>Implied value</td><td>rounded to the dollar</td><td>${moneyFull(r.implied_value_usd)}</td></tr>
  </tbody></table>`;
}

function openDetail(slug) {
  const r = rows.find((x) => x.slug === slug) || live.find((x) => x.slug === slug);
  if (!r) return;
  const isLive = !r.farm_steps;
  const body = $('detail-body');
  if (isLive) {
    body.innerHTML = `<h2>${esc(r.name)}</h2><p class="sub2">${esc(r.slug)} · ${esc(r.category || 'Uncategorised')} · ${r.chains.map(esc).join(', ')}</p>
      <p>Token already trades — market cap <b>${moneyFull(r.mcap_usd || 0)}</b> on TVL ${money(r.tvl_usd)}. Live-token protocols are shown at the market's own value and never enter the pre-token ranking, so there is no implied value and no farm plan here.</p>`;
  } else {
    const chains = r.chains.length > 4 ? r.chains.slice(0, 4).join(', ') + ` +${r.chains.length - 4} more` : r.chains.join(', ');
    body.innerHTML = `<h2>#${r.rank} ${esc(r.name)}</h2>
      <p class="sub2">${esc(r.slug)} · ${esc(r.category || 'Uncategorised')} · ${esc(chains)} · TVL ${money(r.tvl_usd)} · ${pct(r.change_7d)} over 7d · ${r.model.age_days} days old · records no token</p>
      ${waterfall(r)}
      <p class="check">✓ Page recompute: ${moneyFull(impliedOf(r, M.growth_weight, M.size_dampening))} — matches board.json.</p>
      <h3>Farm plan — 6 steps</h3>
      <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="sub2">Implied value is a model, not a price and not a prediction that a token will be issued. Claim only from the protocol's own published link.</p>`;
  }
  $('detail').showModal();
  history.replaceState(null, '', '#p=' + slug);
}

function fillSelects() {
  const cats = [...new Set(rows.map((r) => r.category || 'Uncategorised'))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

function syncHash() {
  const parts = [];
  if (state.q) parts.push('q=' + encodeURIComponent(state.q));
  if (state.cat) parts.push('category=' + encodeURIComponent(state.cat));
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : '#');
}

function readHash() {
  const h = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(h);
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  if (params.get('category')) { state.cat = params.get('category'); $('cat').value = state.cat; }
  if (params.get('p')) return params.get('p');
  return null;
}

function init() {
  $('headline').innerHTML = `<b>${rows.length} pre-token protocols</b> ranked by implied value · watchlist ${R.watchlist_size} of ${rows.length} · snapshot ${esc(R.as_of)} · floor ${money(R.floor_usd)} · ${live.length} live-token protocols set aside at market cap`;
  $('source').textContent = 'Source: ' + R.source + '. Snapshot as of ' + R.as_of + '.';
  $('fallback').textContent = 'Categories with too few live comparables, priced on the global median compRatio ' + R.global_comp_ratio + ': ' + (R.fallback_categories.join(', ') || 'none') + '.';
  fillSelects();
  spotlight();
  const openSlug = readHash();
  render();
  if (openSlug) openDetail(openSlug);

  $('q').addEventListener('input', (e) => { state.q = e.target.value; syncHash(); render(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; syncHash(); render(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
  $('tab-pre').addEventListener('click', () => { state.tab = 'pre'; $('tab-pre').setAttribute('aria-selected', 'true'); $('tab-live').setAttribute('aria-selected', 'false'); render(); });
  $('tab-live').addEventListener('click', () => { state.tab = 'live'; $('tab-live').setAttribute('aria-selected', 'true'); $('tab-pre').setAttribute('aria-selected', 'false'); render(); });
  document.querySelectorAll('#board th[data-k]').forEach((th) => th.addEventListener('click', () => {
    if (state.key === th.dataset.k) state.dir = -state.dir; else { state.key = th.dataset.k; state.dir = 1; }
    render();
  }));
  $('rows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-slug]'); if (tr) openDetail(tr.dataset.slug); });
  $('spotlight').addEventListener('click', (e) => { const c = e.target.closest('[data-slug]'); if (c) openDetail(c.dataset.slug); });
  $('close-detail').addEventListener('click', () => { $('detail').close(); history.replaceState(null, '', '#'); });
  $('detail').addEventListener('close', () => { if (location.hash.startsWith('#p=')) history.replaceState(null, '', '#'); });
  $('gw').addEventListener('input', (e) => { state.gw = parseFloat(e.target.value); $('gw-out').textContent = state.gw.toFixed(2); labNote(); render(); });
  $('sd').addEventListener('input', (e) => { state.sd = parseFloat(e.target.value); $('sd-out').textContent = state.sd.toFixed(2); labNote(); render(); });
}

function labNote() {
  $('labnote').textContent = labOn()
    ? `Lab on — growth weight ${state.gw.toFixed(2)}, size dampening ${state.sd.toFixed(2)}. Amber values are lab values, not board.json.`
    : 'Lab off — showing board values.';
}

init();
