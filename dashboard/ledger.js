(function () {
 'use strict';
 var DATA = window.RADAR, MODEL = window.RADAR_MODEL;
 var rows = DATA.rows, bySlug = {};
 rows.forEach(function (r) { bySlug[r.slug] = r; });
 var FIT = MODEL.fitVariant(DATA.comps);
 var FA = DATA.farm_assumptions;
 MODEL.setGasRates(FA.gas_rates);
 var state = { q: '', cat: '', chain: '', verdict: '', list: '', minTvl: 0, sort: 'rank', detail: null, expanded: null, compare: [], tab: 'board', ticket: FA.default_ticket_usd, share: FA.default_share };
 var econCache = {};
 function $(id) { return document.getElementById(id); }
 function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
 var N = '<td class="num">';
 var H = '<th class="num">';
 var D = '<span class="dim">';
 var NM = '<span class="name">';
 function money(v) {
  if (v == null) return '—';
  var u = [[1e9, 'B', 2], [1e6, 'M', 1], [1e3, 'K', 1]], i;
  for (i = 0; i < 3; i++) if (Math.abs(v) >= u[i][0]) return '$' + (v / u[i][0]).toFixed(u[i][2]) + u[i][1];
  return '$' + Math.round(v);
 }
 function moneyFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
 function moneySigned(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
 function gasMoney(v) { return '$' + v.toFixed(2); }
 function pct(v) { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%'; }
 function times(x) { return '×' + x.toFixed(2); }
 function factor(x) { return '×' + x.toFixed(3); }
 function chip(v) { return '<span class="chip ' + v + '">' + v + '</span>'; }
 function signed(v, text) { return '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + text + '</span>'; }
 function ageText(d) {
  if (d == null) return 'listing date unknown';
  return 'listed ' + (d < 2 ? 'a day' : d < 30 ? d + ' days' : d < 60 ? 'about a month' : d < 365 ? Math.floor(d / 30) + ' months' : (d / 365).toFixed(1) + ' years') + ' ago';
 }
 function kvRows(pairs) {
  return '<table class="derive"><tbody>' + pairs.map(function (p) {
   return '<tr' + (p[3] ? ' class="total"' : '') + '><td>' + p[0] + (p[1] ? ' ' + D + '· ' + p[1] + '</span>' : '') + '</td><td>' + p[2] + '</td></tr>';
  }).join('') + '</tbody></table>';
 }
 function econFor(r) {
  var k = r.slug + '|' + state.ticket + '|' + state.share;
  if (!econCache[k]) econCache[k] = MODEL.farmEconomics(r, r.implied_value_usd, r.p25_usd, state.ticket, state.share);
  return econCache[k];
 }

 function renderAcct() {
  var a = DATA.accounting;
  var cells = [
   [a.ranked + ' ranked', DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early'],
   [a.token_record + ' record a token', a.traded_positive + ' trade · ' + a.token_no_mcap + ' carry no market cap'],
   [a.set_aside + ' set aside by rule', 'by the watchlist\u2019s own rule'],
   [a.total + ' protocols', 'all protocols, accounted for'],
  ];
  $('acct').innerHTML = cells.map(function (c, i) {
   return (i ? '<div class="eq">' + (i === 3 ? '=' : '+') + '</div>' : '') + '<div><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
  }).join('');
  $('acct-sub').textContent = a.set_aside + ' set aside by rule: ' + DATA.set_aside_line + '.';
 }
 function renderCheck() {
  setTimeout(function () {
   var v = MODEL.verify(DATA), el = $('check');
   if (v.ok) {
    el.className = 'check ok';
    el.textContent = '✓ page = board.json: ' + v.n + '/' + v.n + ' ranks, values, bands, ranges, verdicts and steps — re-run here in ' + v.seconds.toFixed(1) + ' s (LOO ' + times(v.looX) + ', walk-forward ' + times(v.wfX) + ') · Σ ' + money(v.agg) + ' = board.json · seal ' + v.digest + ' · values never rise down the board · ' + document.querySelectorAll('#board-body tr[data-slug]').length + ' rows drawn = ' + v.n + ' written';
   } else {
    el.className = 'check bad';
    el.textContent = '✕ re-run mismatch: values ' + v.values + ', verdicts ' + v.verdicts + ', bands ' + v.bands + ', ranges ' + v.ranges + ', steps ' + v.steps + ' of ' + v.n + ', seal ' + (v.digestOk ? 'ok' : 'MISMATCH') + ', Σ ' + (v.aggOk ? 'ok' : 'MISMATCH');
   }
  }, 50);
 }
 function renderStats() {
  var ab = DATA.ablation, v = DATA.verdict_counts, bc = DATA.band_coverage;
  var tx = function (t) { return times(Math.exp(t.model_median_log_err)); };
  var t1k = DATA.verdict_by_ticket.filter(function (t) { return t.ticket === 1000; })[0];
  var pay = v.ROBUST + v.FARM + v.THIN, pay1k = t1k.ROBUST + t1k.FARM + t1k.THIN;
  var sub = document.querySelector('.f-sub');
  sub.className = 'f-sub f-abl';
  sub.innerHTML = '<b>Ablation</b> (LOO / walk-forward): shipped ' + times(ab[3].loo_x) + ' / ' + times(ab[3].wf_x) +
   ' · size-only ' + times(ab[1].loo_x) + ' / ' + times(ab[1].wf_x) +
   ' · flat ' + times(ab[0].loo_x) + ' / ' + times(ab[0].wf_x) + '<br>' +
   '<b>Rejected:</b> chains breadth ' + times(ab[7].loo_x) + ' LOO but ' + times(ab[7].wf_x) + ' walk-forward · category offsets ' + times(ab[5].loo_x) + ' — did not earn a place<br>' +
   '<b>Calibration:</b> P25–P75 holds ' + Math.round(bc.p25_75 * 100) + '% · P10–P90 holds ' + Math.round(bc.p10_90 * 100) + '% · time-split ' + tx(DATA.oos[1]) + ' · top-20 ' + DATA.top20_stable + '/20';
  var el = document.createElement('p');
  el.className = 'f-stats';
  el.innerHTML = v.ROBUST + ' ROBUST · ' + v.FARM + ' FARM · ' + v.THIN + ' THIN · ' + v.SKIP + ' SKIP · ' +
   pay + ' of ' + rows.length + ' plans pay · at $1K: ' + pay1k + ' pay · ' +
   DATA.off_tvl_order + ' rows 5+ off TVL order';
  document.querySelector('.f-main').appendChild(el);
 }
 function renderFormula() { $('fstrip').innerHTML = DATA.cover_fstrip_html; }

 function renderTabs() {
  var a = DATA.accounting;
  var tabs = [
   ['board', 'The board', a.ranked + ' ranked'],
   ['traded', 'Token trades', a.token_record + ' record a token'],
   ['setaside', 'Set aside', a.set_aside + ' by rule'],
  ];
  $('tabs').innerHTML = tabs.map(function (t) {
   return '<button data-tab="' + t[0] + '" class="' + (state.tab === t[0] ? 'on' : '') + '">' + t[1] + ' <span>' + t[2] + '</span></button>';
  }).join('') +
   '<button data-scroll="method">Method</button>';
  $('board-tab').hidden = state.tab !== 'board';
  $('traded-tab').hidden = state.tab !== 'traded';
  $('setaside-tab').hidden = state.tab !== 'setaside';
  $('chips').hidden = state.tab !== 'board';
 }
 function setTab(tab) {
  state.tab = tab;
  renderTabs();
  if (tab === 'traded') renderTraded();
  if (tab === 'setaside') renderSetAside();
 }
 function protoCells(t) {
  return '<tr><td>' + NM + esc(t.name) + '</span><span class="slug">' + esc(t.slug) + '</span></td>' +
   '<td>' + esc(t.category || '—') + '</td>' + N + money(t.tvl_usd) + '</td>';
 }
 function renderTraded() {
  var a = DATA.accounting;
  $('traded-note').textContent = a.token_record + ' protocols record a token: ' + a.traded_positive + ' trade, ' + a.token_mcap_null + ' carry no market cap, ' + a.token_mcap_nonpositive + ' at zero or below. ' + a.comps_excluded + ' fail the watchlist test and ' + a.comps_excluded_bridge + ' are bridges, leaving ' + DATA.comps_size + ' comps for the curve.';
  $('traded-body').innerHTML = DATA.traded.map(function (t) {
   return protoCells(t) +
    N + (t.mcap_usd == null ? '<span class="null">null</span>' : money(t.mcap_usd)) + '</td>' +
    N + (t.mcap_usd != null && t.mcap_usd > 0 ? factor(t.mcap_usd / t.tvl_usd) : '—') + '</td></tr>';
  }).join('');
 }
 function renderSetAside() {
  $('setaside-note').textContent = DATA.accounting.set_aside + ' pre-token protocols are set aside by the rule. By reason: ' +
   DATA.set_aside_reasons.map(function (x) { return x.reason + ' ' + x.n; }).join(' · ') + '.';
  $('setaside-body').innerHTML = DATA.set_aside.map(function (t) {
   return protoCells(t) + '<td>' + esc(t.reason) + '</td></tr>';
  }).join('');
 }

 function filteredRows() {
  var q = state.q.trim().toLowerCase();
  var out = rows.filter(function (r) {
   if (state.list === 'watch' && !r.watchlist) return false;
   if (state.list === 'early' && r.watchlist) return false;
   if (state.list === 'gainers' && !(r.change_7d > 0)) return false;
   if (r.tvl_usd < state.minTvl) return false;
   if (state.cat && r.category !== state.cat) return false;
   if (state.verdict && econFor(r).verdict !== state.verdict) return false;
   if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
   if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
   return true;
  });
  if (state.sort === 'name') return out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  var key = {
   rank: function (r) { return r.rank; },
   tvl: function (r) { return -r.tvl_usd; },
   growth: function (r) { return -(r.change_7d == null ? -1e9 : r.change_7d); },
   multiple: function (r) { return -r.multiple; },
   net: function (r) { return -econFor(r).net; },
   nethour: function (r) { return -econFor(r).netPerHour; },
   breakeven: function (r) { return econFor(r).breakEven; },
  }[state.sort];
  return out.sort(function (a, b) { return key(a) - key(b); });
 }
 function renderChips() {
  var n = { watch: 0, early: 0, gainers: 0, fresh: 0, rising: 0 };
  rows.forEach(function (r) { if (r.watchlist) n.watch++; else { n.early++; if (r.age_days != null && r.age_days <= 180) n.fresh++; if (r.change_7d != null && r.change_7d >= 10) n.rising++; } if (r.change_7d > 0) n.gainers++; });
  var defs = [['', 'All', rows.length], ['watch', 'Watchlist', n.watch], ['early', 'Early finds', n.early], ['gainers', '7-day gainers', n.gainers]];
  $('chips').innerHTML = defs.map(function (d) {
   return '<button data-list="' + d[0] + '" class="' + (state.list === d[0] ? 'on' : '') + '">' + d[1] + ' <span>' + d[2] + '</span></button>';
  }).join('');
  $('early-rule').textContent = 'Early finds: pass the watchlist test, not on the watchlist. Of the ' + n.early + ': ' + n.fresh + ' listed ≤180 days ago · ' + n.rising + ' up ≥10% in 7 days.';
 }
 function splitStep(s) { var d = s.indexOf(' — '); return d > 0 ? [s.slice(0, d), s.slice(d + 3)] : ['', s]; }
 function expandHtml(r) {
  var sp = MODEL.stepPlan(r);
  var cells = r.farm_steps.map(function (s, i) {
   var w = splitStep(s);
   return '<div><b>' + esc(w[0]) + ' · ' + gasMoney(sp[i].cost) + ' · ' + sp[i].mins + ' min</b> — ' + esc(w[1]) + '</div>';
  }).join('');
  var keys = [1, 4, 5].map(function (i) { var w = splitStep(r.farm_steps[i]); return '<b>' + esc(w[0]) + '</b> ' + esc(w[1].split(' ').slice(0, 6).join(' ')) + '… · ' + gasMoney(sp[i].cost) + ' · ' + sp[i].mins + ' min'; }).join(' · ');
  return '<tr class="expand"><td colspan="13"><details class="plan-det"><summary class="plan-strip">' + keys +
   ' — <b>8 steps · ' + gasMoney(MODEL.planGas(r)) + ' · ' + MODEL.planHours(r).toFixed(1) + ' h</b></summary>' +
   '<div class="plan-steps">' + cells + '</div>' +
   '<p class="oos-note"><button class="cmp-btn" data-detail="' + esc(r.slug) + '">Full detail →</button></p></details></td></tr>';
 }
 function rowHtml(r, farm, sel, open, cmpOn) {
  var e = econFor(r);
  var chg = r.change_7d == null ? '—' : signed(r.change_7d, pct(r.change_7d));
  return '<tr data-' + (farm ? 'farm' : 'slug') + '="' + esc(r.slug) + '" class="' + (farm ? 'farm-row' : (sel ? 'selected' : '')) + '">' +
   N + '<strong>' + r.rank + '</strong> <span class="range">' + r.rank_lo + '–' + r.rank_hi + '</span></td>' +
   '<td>' + (farm ? '<a href="?detail=' + esc(r.slug) + '">' : '') + NM + esc(r.name) + '</span>' + (farm ? '</a>' : '') + (r.watchlist ? '<span class="wl">Watchlist</span>' : '') + '</td>' +
   N + money(r.tvl_usd) + '</td>' + N + chg + '</td>' +
   N + '<strong>' + money(r.implied_value_usd) + '</strong></td>' +
   N + money(r.p25_usd) + '–' + money(r.p75_usd) + '</td>' +
   N + moneySigned(e.gross) + '</td>' +
   N + signed(e.net, moneySigned(e.net)) + ' / ' + signed(e.netLow, moneySigned(e.netLow)) + '</td>' +
   N + money(e.breakEven) + '</td>' +
   N + signed(e.netPerHour, moneySigned(e.netPerHour)) + '</td>' +
   '<td>' + chip(e.verdict) + '</td>' +
   '<td class="plan">' + (farm ? '' : (open ? '▾ ' : '▸ ')) + esc(r.plan_action) + ' · ' + esc(r.chains[0] || '—') + ' · ' + gasMoney(r.plan_fees_usd) + ' · ' + MODEL.planHours(r).toFixed(1) + ' h · ' + FA.horizon_days + ' d</td>' +
   (farm ? '<td></td>' : '<td><button class="cmp-btn' + (cmpOn ? ' on' : '') + '" data-cmp="' + esc(r.slug) + '">' + (cmpOn ? '✓ Comparing' : '⇄ Compare') + '</button></td>') + '</tr>';
 }
 function topByHour() { return rows.slice().sort(function (a, b) { return econFor(b).netPerHour - econFor(a).netPerHour; }); }
 function renderSide() {
  var next = topByHour().slice(3, 6).map(function (r) {
   var e = econFor(r);
   return '<div class="sn"><b>#' + r.rank + ' ' + esc(r.name) + '</b><br>' + moneySigned(e.netPerHour) + '/h · net ' + moneySigned(e.net) + ' ' + chip(e.verdict) + '</div>';
  }).join('');
  $('side').innerHTML = '<h3>How a row is valued</h3>' +
   '<p>Implied = TVL × curve × growth × maturity. Slice = your share of implied. Net = slice − gas − time − yield forgone.</p>' +
   '<h3>FARM NEXT</h3>' + next +
   '<h3>LOO scatter</h3>' + document.querySelector('.f-scatter').innerHTML;
 }
 function renderBoard() {
  var list = filteredRows();
  var counts = { ROBUST: 0, FARM: 0, THIN: 0, SKIP: 0 };
  list.forEach(function (r) { counts[econFor(r).verdict]++; });
  var shown = ['ROBUST', 'FARM', 'THIN', 'SKIP'].filter(function (v) { return counts[v]; }).map(function (v) { return counts[v] + ' ' + v; });
  $('count').textContent = list.length + ' of ' + rows.length + ' shown' + (shown.length ? ' · ' + shown.join(' · ') : '');
  var anchors = {};
  if (list.length === rows.length && state.sort === 'rank') {
   DATA.anchors.forEach(function (a) { anchors[a.after_rank] = a.text; });
  }
  var html = '';
  if (list.length === rows.length && state.sort === 'rank') {
   var best = topByHour().slice(0, 3);
   html += '<tr class="anchor"><td colspan="13">Best farms — top 3 by net per hour (the board below ranks all ' + rows.length + ' by implied value)</td></tr>';
   best.forEach(function (r) { html += rowHtml(r, true); });
  }
  list.forEach(function (r) {
   var cmpOn = state.compare.indexOf(r.slug) >= 0;
   var open = state.expanded === r.slug;
   html += rowHtml(r, false, state.detail === r.slug || open, open, cmpOn);
   if (open) html += expandHtml(r);
   if (anchors[r.rank]) html += '<tr class="anchor"><td colspan="13">' + esc(anchors[r.rank]) + '</td></tr>';
  });
  $('board-body').innerHTML = html;
  Array.prototype.forEach.call($('board-body').querySelectorAll('tr[data-slug]'), function (tr) {
   tr.addEventListener('click', function (ev) {
    if (ev.target.getAttribute && ev.target.getAttribute('data-cmp')) return;
    var slug = tr.getAttribute('data-slug');
    state.expanded = state.expanded === slug ? null : slug;
    renderBoard();
   });
  });
  Array.prototype.forEach.call($('board-body').querySelectorAll('[data-detail]'), function (btn) {
   btn.addEventListener('click', function (ev) { ev.stopPropagation(); openDetail(btn.getAttribute('data-detail')); });
  });
  Array.prototype.forEach.call($('board-body').querySelectorAll('[data-cmp]'), function (btn) {
   btn.addEventListener('click', function (ev) { ev.stopPropagation(); toggleCompare(btn.getAttribute('data-cmp')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#board th[data-k]'), function (th) {
   var on = th.getAttribute('data-k') === state.sort;
   th.classList.toggle('sorted', on);
   th.classList.toggle('desc', on && ['tvl', 'growth', 'net', 'nethour'].indexOf(state.sort) >= 0);
  });
  renderSide();
  if (list.length === 0) { $('farmbook').textContent = 'No protocols in this selection.'; return; }
  var fees = 0, slices = 0, net = 0, hrs = 0;
  list.forEach(function (r) { var e = econFor(r); fees += e.cost; slices += e.gross; net += e.net; hrs += MODEL.planHours(r); });
  var n = list.length, be = fees > 0 && slices > fees ? ' · break-even <b>1 in ' + Math.round(slices / fees) + '</b>' : '';
  $('farmbook').innerHTML = 'Farm book — <b>' + n + '</b> at $' + state.ticket.toLocaleString('en-US') + ': costs <b>' +
   moneySigned(fees) + '</b> · slices <b>' +
   moneySigned(slices) + '</b> · net <b>' + moneySigned(net) + '</b> · ' + hrs.toFixed(1) + ' hours' + be + '.';
 }
 function fillFilters() {
  var cats = {}, chains = {};
  rows.forEach(function (r) { if (r.category) cats[r.category] = true; r.chains.forEach(function (c) { chains[c] = true; }); });
  function opts(map) { return Object.keys(map).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join(''); }
  function pairs(id, ps) { $(id).innerHTML = ps.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join(''); }
  $('f-cat').innerHTML = '<option value="">All categories</option>' + opts(cats);
  $('f-chain').innerHTML = '<option value="">All chains</option>' + opts(chains);
  $('f-verdict').innerHTML = '<option value="">All verdicts</option>' + ['ROBUST', 'FARM', 'THIN', 'SKIP'].map(function (v) { return '<option>' + v + '</option>'; }).join('');
  pairs('f-tvl', [[0, 'Any TVL'], [1e7, '≥ $10M'], [5e7, '≥ $50M'], [1e8, '≥ $100M'], [5e8, '≥ $500M']]);
  pairs('f-sort', [['rank', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['multiple', 'Multiple'], ['net', 'Farm net $'], ['nethour', 'Net $ / hour'], ['breakeven', 'Break-even $'], ['name', 'Name A–Z']]);
 }
 function buildSeg(id, vals, fmt, isOn, onPick) {
  $(id).innerHTML = vals.map(function (v) {
   return '<button data-v="' + v + '" class="' + (isOn(v) ? 'on' : '') + '">' + fmt(v) + '</button>';
  }).join('');
  Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) {
   b.addEventListener('click', function () {
    onPick(parseFloat(b.getAttribute('data-v')));
    renderSegs(); renderBoard();
    if (state.detail) renderDetail();
    if (state.compare.length === 2) renderCompare();
   });
  });
 }
 function renderSegs() {
  buildSeg('seg-ticket', FA.tickets, function (t) { return '$' + (t >= 1000 ? (t / 1000) + 'K' : t); },
   function (t) { return state.ticket === t; }, function (t) { state.ticket = t; });
  buildSeg('seg-share', FA.shares, function (s) { return Math.round(s * 100) + '%'; },
   function (s) { return state.share === s; }, function (s) { state.share = s; });
 }

 function confidenceText(r) {
  var s = Math.max(0, Math.min(100, Math.round(100 - Math.min(40, 20 * Math.log10(r.p75_usd / r.p25_usd)) - Math.min(30, (r.rank_hi - r.rank_lo) / 2) - (r.age_days == null ? 15 : Math.min(20, 20 * (1 - Math.min(r.age_days, 1095) / 1095))))));
  return (s >= 80 ? 'A' : s >= 60 ? 'B' : s >= 40 ? 'C' : 'D') + ' · ' + s + '/100';
 }

 function openDetail(slug) {
  if (!bySlug[slug]) return;
  state.detail = slug;
  renderDetail();
  renderBoard();
  $('detail').hidden = false;
  $('detail').scrollIntoView({ block: 'start' });
 }
 function bandBar(r) {
  var lo = Math.log(r.p10_usd), hi = Math.log(r.p90_usd);
  var at = function (v) { return ((Math.log(v) - lo) / (hi - lo)) * 100; };
  return '<div class="ci-bar"><div class="ci-track"><div class="ci-outer" style="left:0%;right:0%"></div>' +
   '<div class="ci-inner" style="left:' + at(r.p25_usd).toFixed(1) + '%;right:' + (100 - at(r.p75_usd)).toFixed(1) + '%"></div>' +
   '<div class="ci-point" style="left:' + at(r.implied_value_usd).toFixed(1) + '%"></div></div>' +
   '<div class="ci-labels"><span>P10 ' + money(r.p10_usd) + '</span><span>P25–P75 ' + money(r.p25_usd) + '–' + money(r.p75_usd) + '</span><span>P90 ' + money(r.p90_usd) + '</span></div></div>' +
   '<p class="oos-note">Bands from LOO misses.</p>';
 }
 function compsHtml(r) {
  var near = MODEL.nearestComps(r, DATA.comps, FIT, 4);
  var body = near.map(function (n) {
   return '<tr><td>' + esc(n.comp.name) + '</td>' + N + money(n.comp.tvl_usd) + '</td>' + N + money(n.comp.mcap_usd) + '</td>' + N + money(n.curveSays) + '</td>' + N + factor(n.actualDivCurve) + '</td></tr>';
  }).join('');
  var f = near[0];
  var cross = f ? 'At ' + esc(f.comp.name) + '\u2019s multiple (' + factor(f.comp.multiple) + ' of TVL), this protocol would be worth ' + money(r.tvl_usd * f.comp.multiple) + ' — the model says ' + money(r.implied_value_usd) + '.' : '';
  return '<table class="oos"><thead><tr><th>Nearest comp</th>' + H + 'TVL</th>' + H + 'Market cap</th>' + H + 'Curve says</th>' + H + 'Actual ÷ curve</th></tr></thead><tbody>' + body + '</tbody></table><p class="oos-note">' + cross + '</p>';
 }
 function rawHtml(r) {
  var f = [
   ['mcap_usd', null], ['gecko_id', null], ['symbol', null], ['slug', r.slug],
   ['name', r.name], ['category', r.category],
   ['tvl_usd', moneyFull(r.tvl_usd)], ['change_7d', r.change_7d == null ? null : r.change_7d.toFixed(4)],
  ];
  return '<div class="raw">' + f.map(function (x) {
   return '<div><b>' + x[0] + '</b>' + (x[1] == null ? '<span class="null">null</span>' : esc(x[1])) + '</div>';
  }).join('') + '</div>' +
   '<p class="oos-note">Its snapshot record: mcap, gecko_id, symbol null.</p>';
 }
 function stepsHtml(r) {
  var sp = MODEL.stepPlan(r);
  var items = r.farm_steps.map(function (s, i) {
   var w = splitStep(s);
   return '<tr><td><b>' + esc(w[0]) + '</b> — ' + esc(w[1]) + '</td>' + N + gasMoney(sp[i].cost) + '</td>' + N + sp[i].mins + ' min</td></tr>';
  }).join('');
  var tl = ['Day 0', 'Day 5', 'Week 2', 'Weekly ×12', 'Day 90', 'If launches'].map(function (t, i, a) {
   return '<span>' + t + '</span>' + (i < a.length - 1 ? '<span class="dot"></span><span class="bar"></span>' : '');
  }).join('');
  var drop = Math.round((1 - r.stop_tvl_usd / r.tvl_usd) * 100);
  var why = r.change_7d == null ? 'no 7-day change on record' : '2× its 7-day swing, bounded 5–50%';
  return '<p class="oos-note">Stop: unwind below ' + money(r.stop_tvl_usd) + ' TVL (' + drop + '% down — ' + why + ').</p>' +
   '<table class="oos steps-table"><thead><tr><th>Step</th>' + H + 'Cost</th>' + H + 'Time</th></tr></thead><tbody>' + items + '</tbody>' +
   '<tfoot><tr><td>Total — counts the Week-2 move</td>' + N + gasMoney(MODEL.planGas(r)) + ' gas</td>' + N + MODEL.planHours(r).toFixed(1) + ' h</td></tr></tfoot></table>' +
   '<div class="timeline">' + tl + '</div>';
 }
 function renderDetail() {
  var r = bySlug[state.detail], el = $('detail');
  if (!r) { el.hidden = true; return; }
  var e = econFor(r);
  var cmpOn = state.compare.indexOf(r.slug) >= 0;
  var from = function (v) { return v == null ? '—' : '$' + v.toLocaleString('en-US'); };
  var grid = FA.tickets.slice(0, 3).map(function (t) {
   var cells = FA.shares.map(function (s) {
    var g = MODEL.farmEconomics(r, r.implied_value_usd, r.p25_usd, t, s);
    return '<td class="num' + (t === state.ticket && s === state.share ? ' cur' : '') + '">' + signed(g.net, moneySigned(g.net)) + '</td>';
   }).join('');
   return '<tr><td>$' + (t >= 1000 ? (t / 1000) + ',000' : t) + '</td>' + cells + '</tr>';
  }).join('');
  var share = r.age_days == null ? null : 90 / (r.age_days + 90);
  var timeCtx = share == null ? 'its listing date is unknown, so the plan carries no time context' : 'it has run ' + r.age_days + ' days, so the plan covers ' + Math.round(share * 100) + '% of its life at plan end';
  var sliceLine = 'Slice = ' + Math.round(state.share * 100) + '% × ' + money(r.implied_value_usd) + ' × $' + state.ticket.toLocaleString('en-US') + ' / ' + money(r.tvl_usd) + ' TVL = ' + moneySigned(e.gross) + ' — ' + timeCtx + '.';
  var dropLine = 'If the launch value drops: ' + [5, 10, 20].map(function (d) {
   var g = MODEL.farmEconomics(r, r.implied_value_usd * (1 - d / 100), r.p25_usd * (1 - d / 100), state.ticket, state.share);
   return '−' + d + '% → net ' + moneySigned(g.net);
  }).join(' · ') + '.';
  var derive = kvRows([
   ['TVL', 'snapshot figure', moneyFull(r.tvl_usd)],
   ['× curve multiple', 'at this TVL', factor(r.size_multiple)],
   ['× growth tilt', r.change_7d == null ? '7-day change unreported' : '7-day change ' + pct(r.change_7d) + (r.change_7d > 100 ? ' · clamped at +100%' : r.change_7d < -50 ? ' · clamped at −50%' : ''), factor(r.growth_multiplier)],
   ['× maturity tilt', ageText(r.age_days), factor(r.maturity_multiplier)],
   ['= implied value', factor(r.multiple) + ' of TVL', moneyFull(r.implied_value_usd), true],
   ['Confidence', 'band ' + (r.p75_usd / r.p25_usd).toFixed(1) + '× · range ' + r.rank_lo + '–' + r.rank_hi + ' · ' + (r.age_days == null ? 'age unknown' : r.age_days + ' days of record'), confidenceText(r)],
  ]);
  var econ = kvRows([
   ['Expected slice', 'implied × ' + Math.round(state.share * 100) + '% × ticket ÷ TVL', moneySigned(e.gross)],
   ...(share == null ? [] : [['Slice × time share ' + Math.round(share * 100) + '%', 'context only', moneySigned(e.gross * share)]]),
   ['Gas + time', 'gas ' + gasMoney(MODEL.planGas(r)) + ' + ' + MODEL.planHours(r).toFixed(1) + ' h at $2.40/h', moneySigned(-(e.cost - e.forgone))],
   ['Yield forgone, net', 'T-bill 4% − own yield (0% assumed)', '−$' + Math.round(e.forgone) + ' … $0'],
   ['Net expected value', 'at own yield 0%', moneySigned(e.net), true],
   ['Net at band low end', 'at P25, same costs', moneySigned(e.netLow)],
   ['Break-even value', 'launch must reach this', money(e.breakEven)],
   ['Net per hands-on hour', MODEL.planHours(r).toFixed(1) + ' hours, 90 days', moneySigned(e.netPerHour)],
   ['Pays/FARM/ROBUST from', '— = never', from(e.paysFrom) + ' / ' + from(e.farmFrom) + ' / ' + from(e.robustFrom)],
   ['Verdict', '', chip(e.verdict)],
  ]);
  el.innerHTML =
   '<div class="detail-head"><div><h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
   '<p class="detail-meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'chain unreported') +
   ' · gas ' + gasMoney(MODEL.gasRate(r)) + ' per action' +
   ' · ' + ageText(r.age_days) + (r.watchlist ? ' · <span class="wl">Watchlist</span>' : '') +
   ' · rank ' + r.rank_lo + '–' + r.rank_hi + ' in 200 refits</p></div>' +
   '<div><button class="cmp-btn' + (cmpOn ? ' on' : '') + '" id="detail-cmp">' + (cmpOn ? '✓ Comparing' : '⇄ Compare') + '</button> ' +
   '<button class="close-btn" id="detail-close">Close ✕</button></div></div>' +
   '<div class="detail-grid"><div>' +
   '<h3>Where the number comes from</h3>' + derive + bandBar(r) +
   '<h3>Nearest comps</h3>' + compsHtml(r) +
   '<h3>Its snapshot record</h3>' + rawHtml(r) +
   '</div><div>' +
   '<h3>Is it worth farming? ' + D + 'at $' + state.ticket.toLocaleString('en-US') + ', ' + Math.round(state.share * 100) + '% share</span></h3>' + econ +
   '<h3>Sensitivity: net at 3 deposits × 3 shares</h3>' +
   '<table class="oos"><thead><tr><th>Deposit \\ share</th>' + H + '5%</th>' + H + '10%</th>' + H + '20%</th></tr></thead><tbody>' + grid + '</tbody></table>' +
   '<p class="oos-note">' + sliceLine + '</p>' +
   '<p class="oos-note">' + dropLine + '</p>' +
   '<h3>Farm plan — eight dated steps</h3>' + stepsHtml(r) +
   '</div></div>';
  el.hidden = false;
  $('detail-close').addEventListener('click', function () { state.detail = null; $('detail').hidden = true; renderBoard(); });
  $('detail-cmp').addEventListener('click', function () { toggleCompare(r.slug); });
 }

 function toggleCompare(slug) {
  var at = state.compare.indexOf(slug);
  if (at >= 0) state.compare.splice(at, 1);
  else if (state.compare.length < 2) state.compare.push(slug);
  else state.compare = [state.compare[1], slug];
  renderCompare();
  renderBoard();
  if (state.detail) renderDetail();
  if (state.compare.length === 2) $('compare').scrollIntoView({ block: 'start' });
 }
 function renderCompare() {
  var el = $('compare');
  if (state.compare.length < 2) {
   if (state.compare.length === 1) {
    el.innerHTML = '<div class="panel-head"><h2>Compare</h2><p class="panel-sub">One picked (' + esc(bySlug[state.compare[0]].name) + '). Pick a second.</p></div>';
    el.hidden = false;
   } else el.hidden = true;
   return;
  }
  var cols = state.compare.map(function (slug) {
   var r = bySlug[slug], e = econFor(r);
   return '<div class="compare-col"><h3>#' + r.rank + ' — ' + esc(r.name) + '</h3>' +
    '<p class="oos-note">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + ' · rank ' + r.rank_lo + '–' + r.rank_hi + ' in 200 refits</p>' +
    kvRows([
     ['TVL', '', money(r.tvl_usd)],
     ['Implied value', '', money(r.implied_value_usd)],
     ['P25–P75 band', '', money(r.p25_usd) + ' – ' + money(r.p75_usd)],
     ['Slice / net at $' + state.ticket.toLocaleString('en-US'), '', moneySigned(e.gross) + ' / ' + moneySigned(e.net)],
     ['Break-even value', '', money(e.breakEven)],
     ['Verdict', '', chip(e.verdict)],
    ]) + '</div>';
  }).join('');
  el.innerHTML = '<div class="panel-head"><h2>Compare</h2><p class="panel-sub">Side by side.</p></div><div class="compare-grid">' + cols + '</div>';
  el.hidden = false;
 }

 function renderMethodProse() {
  var cols = [[], []], wide = '';
  DATA.method.forEach(function (s, i) {
   var html = '<h3>' + esc(s.h) + '</h3><p>' + esc(s.p) + '</p>';
   if (i < 4) cols[i < 2 ? 0 : 1].push(html);
   else wide += html;
  });
  $('method-prose').innerHTML = '<div>' + cols[0].join('') + '</div><div>' + cols[1].join('') + '</div>';
  $('method-prose2').innerHTML = wide;
 }
 function renderAblation() {
  var head = '<tr><th>Rung</th>' + H + 'LOO</th>' + H + 'SE</th>' + H + '≤3×</th>' + H + 'ρ</th>' + H + 'Walk-fwd</th>' + H + '≤3×</th>' + H + 'ρ</th><th>Decision</th></tr>';
  var body = DATA.ablation.map(function (a) {
   var rho = a.decision === 'BASELINE' ? '—' : a.loo_rho.toFixed(2);
   var rhoW = a.decision === 'BASELINE' ? '—' : a.wf_rho.toFixed(2);
   return '<tr><td><strong>' + esc(a.name) + '</strong></td>' +
    N + times(a.loo_x) + '</td>' + N + '±' + a.loo_se_x.toFixed(2) + '</td>' + N + Math.round(a.loo_within_3x * 100) + '%</td>' + N + rho + '</td>' +
    N + times(a.wf_x) + '</td>' + N + Math.round(a.wf_within_3x * 100) + '%</td>' + N + rhoW + '</td>' +
    '<td><span class="decision ' + a.decision + '">' + a.decision + '</span></td></tr>';
  }).join('');
  $('ablation-table').innerHTML = head + body;
  $('ablation-note').textContent = DATA.ablation_note;
 }
 function renderFit() {
  var f = DATA.fit;
  var cells = [
   ['Curve slope', f.slope.toFixed(2), 'log–log'],
   ['Multiple at $100M TVL', f.multiple_at_100m.toFixed(3), '80%: ' + f.bootstrap_p10.toFixed(3) + '–' + f.bootstrap_p90.toFixed(3)],
   ['R², log scale', f.r_squared.toFixed(2), 'log-multiple variance'],
   ['Residual SD', f.residual_sd.toFixed(2), 'log units'],
  ];
  $('fit-box').innerHTML = '<dl class="fit-box">' + cells.map(function (c) {
   return '<div><dt>' + c[0] + '</dt><dd>' + c[1] + '<small>' + c[2] + '</small></dd></div>';
  }).join('') + '</dl>';
  var tests = [DATA.loo, DATA.walk_forward].concat(DATA.oos);
  $('oos-table').innerHTML = '<tr><th>Blind test</th>' + H + 'Train / test</th>' + H + 'Model</th>' + H + 'Flat</th>' + H + 'Within 2×</th>' + H + 'Within 3×</th>' + H + 'ρ</th></tr>' +
   tests.map(function (t) {
    return '<tr><td>' + esc(t.name) + '</td>' + N + t.train_n + ' / ' + t.test_n + '</td>' +
     N + times(Math.exp(t.model_median_log_err)) + '</td>' + N + times(Math.exp(t.flat_median_log_err)) + '</td>' +
     N + Math.round(t.model_within_2x * 100) + '%</td>' + N + Math.round(t.model_within_3x * 100) + '%</td>' +
     N + t.rank_rho.toFixed(2) + '</td></tr>';
   }).join('');
 }
 function renderLooScatter() { $('loo-scatter').innerHTML = DATA.loo_scatter_svg; }

 function bindControls() {
  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
  function set(key, id) { return function () { state[key] = $(id).value; renderBoard(); }; }
  on('q', 'input', set('q', 'q'));
  on('f-cat', 'change', set('cat', 'f-cat'));
  on('f-chain', 'change', set('chain', 'f-chain'));
  on('f-verdict', 'change', set('verdict', 'f-verdict'));
  on('f-sort', 'change', set('sort', 'f-sort'));
  on('f-tvl', 'change', function () { state.minTvl = parseInt($('f-tvl').value, 10) || 0; renderBoard(); });
  $('tabs').addEventListener('click', function (ev) {
   var b = ev.target.closest('button');
   if (!b) return;
   if (b.getAttribute('data-tab')) setTab(b.getAttribute('data-tab'));
   else $('method').scrollIntoView({ behavior: 'smooth' });
  });
  $('chips').addEventListener('click', function (ev) {
   var b = ev.target.closest('button');
   if (!b) return;
   state.list = b.getAttribute('data-list');
   renderChips();
   renderBoard();
  });
  Array.prototype.forEach.call(document.querySelectorAll('#board th[data-k]'), function (th) {
   th.addEventListener('click', function () {
    state.sort = th.getAttribute('data-k');
    $('f-sort').value = state.sort;
    renderBoard();
   });
  });
 }
 function applyFilter(spec) {
  if (spec.indexOf('cat:') === 0) { state.cat = spec.slice(4); $('f-cat').value = state.cat; }
  if (spec.indexOf('verdict:') === 0) { state.verdict = spec.slice(8); $('f-verdict').value = state.verdict; }
  renderBoard();
 }
 function applyParams(q) {
  var t = parseInt(q.get('ticket') || '', 10);
  if (FA.tickets.indexOf(t) >= 0) state.ticket = t;
  var s = parseFloat(q.get('share') || '');
  if (!isNaN(s) && s > 0 && s <= 100) state.share = s / 100;
  if (q.get('tab')) setTab(q.get('tab'));
  renderSegs();
  if (q.get('filter')) applyFilter(q.get('filter'));
  if (q.get('detail')) { openDetail(q.get('detail')); return; }
  var cmp = q.get('compare');
  if (cmp) {
   var parts = cmp.split(',').filter(function (x) { return bySlug[x]; });
   if (parts.length === 2) { state.compare = parts; renderCompare(); renderBoard(); $('compare').scrollIntoView({ block: 'start' }); }
   return;
  }
  var shot = q.get('shot');
  if (shot === 'method') $('method').scrollIntoView({ block: 'start' });
  else if (shot) $('board-section').scrollIntoView({ block: 'start' });
 }

 $('meta-snapshot').textContent = 'Snapshot ' + DATA.as_of;
 $('meta-model').textContent = 'model ' + DATA.model_version;
 renderAcct();
 renderFormula();
 renderStats();
 renderTabs();
 renderChips();
 fillFilters();
 renderSegs();
 renderBoard();
 renderCompare();
 renderMethodProse();
 renderAblation();
 renderFit();
 renderLooScatter();
 renderCheck();
 bindControls();
 applyParams(new URLSearchParams(window.location.search));
})();
