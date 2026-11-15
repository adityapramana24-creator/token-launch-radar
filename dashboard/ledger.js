// Launch Radar v2's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts):
// the ranked board, the fitted curve, the blind-test results and the traded comps.
// No network: every byte is in data.js. No clock: the page renders the same on every load.
//
// What renders where:
//   renderStats      the hero strip: board size, aggregate value, comps, blind-test headline
//   renderFit        the fitted curve's numbers and the out-of-sample table
//   renderScatter    the log-log scatter of the 92 comps, the fitted curve and its 80% band
//   renderRisers     the week's fastest growers
//   renderBoard      the sortable, filterable board
//   renderDetail     one protocol: its derivation, its interval, its farm plan
//   renderCompare    two protocols side by side
//   renderLive       the traded comps, kept apart from the ranking
//
// Deep links (used by the entry's screenshots): ?detail=<slug> opens a detail view,
// ?filter=cat:<Category> or ?filter=verdict:<FARM|THIN|SKIP> filters the board,
// ?compare=<slug>,<slug> compares two protocols, ?shot=curve|method scrolls to a
// section. The same specs work after a # for in-page links.

(function () {
  'use strict';
  var DATA = window.RADAR;
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var compsBySlug = {};
  DATA.comps.forEach(function (c) { compsBySlug[c.slug] = c; });
  var watchlist = {};
  rows.forEach(function (r) { if (r.watchlist) watchlist[r.slug] = true; });

  var state = { q: '', cat: '', chain: '', verdict: '', watch: false, sort: 'rank', detail: null, compare: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function moneyFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function moneySigned(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function pct(v) {
    if (v == null) return '—';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
  }
  function times(x) { return '×' + x.toFixed(2); }
  function factor(x) { return '×' + x.toFixed(3); }
  function chip(v) { return '<span class="chip ' + v + '">' + v + '</span>'; }
  function ageText(days) {
    if (days == null) return 'listing date unknown';
    if (days < 30) return 'listed ' + days + ' days ago';
    if (days < 365) return 'listed ' + Math.floor(days / 30) + ' months ago';
    return 'listed ' + (days / 365).toFixed(1) + ' years ago';
  }

  // ---------------------------------------------------------------- the hero strip

  function renderMeta() {
    $('meta-snapshot').textContent = 'Snapshot ' + DATA.as_of;
    $('meta-model').textContent = 'model ' + DATA.model_version;
  }

  function renderStats() {
    var split = DATA.oos[0];
    var v = DATA.verdict_counts;
    var cells = [
      ['Pre-token ranked', String(DATA.board_size), DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early'],
      ['Aggregate implied', money(DATA.aggregate_implied_usd), 'sum of all ' + DATA.board_size + ' rows'],
      ['Traded comps fitted', String(DATA.comps_size), 'market cap + TVL on record'],
      ['Blind-test median error', times(Math.exp(split.model_median_log_err)), 'vs ' + times(Math.exp(split.flat_median_log_err)) + ' flat — split-half'],
      ['Blind, within 2×', Math.round(split.model_within_2x * 100) + '%', 'vs ' + Math.round(split.flat_within_2x * 100) + '% flat'],
      ['Farm verdicts', v.FARM + ' FARM', v.THIN + ' THIN · ' + v.SKIP + ' SKIP'],
    ];
    $('stats').innerHTML = cells.map(function (c) {
      return '<div><dt>' + c[0] + '</dt><dd>' + c[1] + '<small>' + c[2] + '</small></dd></div>';
    }).join('');
  }

  // ---------------------------------------------------------------- the fit and its tests

  function renderFit() {
    var f = DATA.fit;
    var cells = [
      ['Curve slope', f.slope.toFixed(2), 'log multiple vs log TVL'],
      ['Multiple at $100M TVL', f.multiple_at_100m.toFixed(3), 'bootstrap 80%: ' + f.bootstrap_p10.toFixed(3) + '–' + f.bootstrap_p90.toFixed(3)],
      ['R², log scale', f.r_squared.toFixed(2), 'of log-multiple variance'],
      ['Residual SD', f.residual_sd.toFixed(2), 'log units; sets each 80% interval'],
    ];
    $('fit-box').innerHTML = '<dl class="fit-box">' + cells.map(function (c) {
      return '<div><dt>' + c[0] + '</dt><dd>' + c[1] + '<small>' + c[2] + '</small></dd></div>';
    }).join('') + '</dl>';
    var head = '<tr><th>Blind test</th><th class="num">Train / test</th><th class="num">Model median err</th><th class="num">Flat median err</th><th class="num">Model within 2×</th><th class="num">Flat within 2×</th><th class="num">80% band held</th></tr>';
    var body = DATA.oos.map(function (t) {
      return '<tr><td>' + esc(t.name) + '</td><td class="num">' + t.train_n + ' / ' + t.test_n + '</td>' +
        '<td class="num">' + times(Math.exp(t.model_median_log_err)) + '</td>' +
        '<td class="num">' + times(Math.exp(t.flat_median_log_err)) + '</td>' +
        '<td class="num">' + Math.round(t.model_within_2x * 100) + '%</td>' +
        '<td class="num">' + Math.round(t.flat_within_2x * 100) + '%</td>' +
        '<td class="num">' + Math.round(t.band_coverage_80 * 100) + '%</td></tr>';
    }).join('');
    $('oos-table').innerHTML = head + body;
  }

  // ---------------------------------------------------------------- the scatter plot

  function renderScatter() {
    var f = DATA.fit;
    var top5 = rows.slice(0, 5);
    var W = 680, H = 380, L = 56, R = 16, T = 14, B = 48;
    var ln10 = Math.LN10;
    var allX = DATA.comps.map(function (c) { return Math.log10(c.tvl_usd); })
      .concat(top5.map(function (r) { return Math.log10(r.tvl_usd); }));
    var allY = DATA.comps.map(function (c) { return Math.log10(c.mcap_usd); })
      .concat(top5.map(function (r) { return Math.log10(r.implied_value_usd); }));
    var x0 = Math.floor(Math.min.apply(null, allX) - 0.2), x1 = Math.ceil(Math.max.apply(null, allX) + 0.2);
    var y0 = Math.floor(Math.min.apply(null, allY) - 0.2), y1 = Math.ceil(Math.max.apply(null, allY) + 0.2);
    var X = function (v) { return L + ((v - x0) / (x1 - x0)) * (W - L - R); };
    var Y = function (v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); };
    // The fitted curve in log10 space: log10(mcap) = log10(TVL) + (a + b(lnTVL - ln1e8)) / ln10.
    var curveY = function (log10tvl) {
      var lnTvl = log10tvl * ln10;
      return log10tvl + (f.intercept + f.slope * (lnTvl - Math.log(1e8))) / ln10;
    };
    var band = (1.2815515655446004 * f.residual_sd) / ln10;
    var moneyTick = function (k) {
      if (k >= 9) return '$' + Math.round(Math.pow(10, k - 9)) + 'B';
      if (k >= 6) return '$' + Math.round(Math.pow(10, k - 6)) + 'M';
      if (k >= 3) return '$' + Math.round(Math.pow(10, k - 3)) + 'K';
      return '$' + Math.round(Math.pow(10, k));
    };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of traded comps against the fitted value curve">';
    for (var gx = Math.ceil(x0); gx <= x1; gx++) {
      s += '<line x1="' + X(gx).toFixed(1) + '" y1="' + T + '" x2="' + X(gx).toFixed(1) + '" y2="' + (H - B) + '" stroke="#e7e0d2" stroke-width="1"/>';
      s += '<text x="' + X(gx).toFixed(1) + '" y="' + (H - 24) + '" font-size="11" fill="#8a8378" text-anchor="middle">' + moneyTick(gx) + '</text>';
    }
    for (var gy = Math.ceil(y0); gy <= y1; gy++) {
      s += '<line x1="' + L + '" y1="' + Y(gy).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(gy).toFixed(1) + '" stroke="#e7e0d2" stroke-width="1"/>';
      s += '<text x="' + (L - 8) + '" y="' + (Y(gy) + 4).toFixed(1) + '" font-size="11" fill="#8a8378" text-anchor="end">' + moneyTick(gy) + '</text>';
    }
    // 80% band, then the curve.
    var upper = '', lower = '';
    for (var i = 0; i <= 40; i++) {
      var xv = x0 + ((x1 - x0) * i) / 40;
      upper += X(xv).toFixed(1) + ',' + Y(curveY(xv) + band).toFixed(1) + ' ';
      lower = X(xv).toFixed(1) + ',' + Y(curveY(xv) - band).toFixed(1) + ' ' + lower;
    }
    s += '<polygon points="' + upper + lower + '" fill="#166534" opacity="0.08"/>';
    var line = '';
    for (var j = 0; j <= 40; j++) {
      var xw = x0 + ((x1 - x0) * j) / 40;
      line += (j === 0 ? 'M' : 'L') + X(xw).toFixed(1) + ',' + Y(curveY(xw)).toFixed(1) + ' ';
    }
    s += '<path d="' + line + '" fill="none" stroke="#166534" stroke-width="2.5"/>';
    // Comps.
    DATA.comps.forEach(function (c) {
      s += '<circle cx="' + X(Math.log10(c.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(c.mcap_usd)).toFixed(1) +
        '" r="3.2" fill="#166534" opacity="0.65"><title>' + esc(c.name) + ': TVL ' + money(c.tvl_usd) + ', mcap ' + money(c.mcap_usd) + '</title></circle>';
    });
    // Top-5 pre-token rows as diamonds at their implied values.
    top5.forEach(function (r) {
      var cx = X(Math.log10(r.tvl_usd)), cy = Y(Math.log10(r.implied_value_usd));
      s += '<g transform="translate(' + cx.toFixed(1) + ',' + cy.toFixed(1) + ') rotate(45)"><rect x="-4.5" y="-4.5" width="9" height="9" fill="#f59e0b" stroke="#92400e" stroke-width="1.2"/>' +
        '<title>' + esc(r.name) + ': TVL ' + money(r.tvl_usd) + ', implied ' + money(r.implied_value_usd) + '</title></g>';
    });
    s += '<text x="' + ((W - L - R) / 2 + L).toFixed(0) + '" y="' + (H - 8) + '" font-size="11" fill="#57534e" text-anchor="middle">TVL (log scale)</text>';
    s += '<text x="14" y="' + ((H - T - B) / 2 + T).toFixed(0) + '" font-size="11" fill="#57534e" text-anchor="middle" transform="rotate(-90 14 ' + ((H - T - B) / 2 + T).toFixed(0) + ')">Market cap / implied value (log scale)</text>';
    s += '<rect x="' + (L + 2) + '" y="' + (T + 1) + '" width="470" height="18" fill="#ffffff" opacity="0.85"/>';
    s += '<g font-size="11" fill="#57534e"><circle cx="' + (L + 8) + '" cy="' + (T + 8) + '" r="3.2" fill="#166534"/><text x="' + (L + 16) + '" y="' + (T + 12) + '">traded comp</text>' +
      '<g transform="translate(' + (L + 108) + ',' + (T + 8) + ') rotate(45)"><rect x="-3.5" y="-3.5" width="7" height="7" fill="#f59e0b" stroke="#92400e"/></g>' +
      '<text x="' + (L + 118) + '" y="' + (T + 12) + '">top-5 pre-token, at implied value</text>' +
      '<line x1="' + (L + 268) + '" y1="' + (T + 8) + '" x2="' + (L + 292) + '" y2="' + (T + 8) + '" stroke="#166534" stroke-width="2.5"/>' +
      '<text x="' + (L + 296) + '" y="' + (T + 12) + '">fitted curve + 80% band</text></g>';
    s += '</svg>';
    $('scatter').innerHTML = s;
  }

  // ---------------------------------------------------------------- risers

  function renderRisers() {
    $('risers').innerHTML = DATA.risers.map(function (slug) {
      var r = bySlug[slug];
      if (!r) return '';
      return '<li data-slug="' + esc(r.slug) + '"><span class="r-name">' + esc(r.name) + '</span>' +
        '<span class="r-meta">#' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · TVL ' + money(r.tvl_usd) + '</span>' +
        '<span class="r-chg">' + pct(r.change_7d) + ' in 7d</span></li>';
    }).join('');
    Array.prototype.forEach.call($('risers').querySelectorAll('li'), function (li) {
      li.addEventListener('click', function () { openDetail(li.getAttribute('data-slug')); });
    });
  }

  // ---------------------------------------------------------------- the board

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watch && !watchlist[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
      multiple: function (a, b) { return b.multiple - a.multiple; },
      net: function (a, b) { return b.net_usd - a.net_usd; },
      name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    }[state.sort];
    return out.sort(by);
  }

  function renderBoard() {
    var list = filteredRows();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown' +
      (state.watch ? ' — watchlist only' : '') + '. Click a row for its derivation and farm plan.';
    $('board-body').innerHTML = list.map(function (r) {
      var chg = r.change_7d == null ? '<span>—</span>' :
        '<span class="' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : '') + '">' + pct(r.change_7d) + '</span>';
      var net = '<span class="' + (r.net_usd >= 0 ? 'up' : 'down') + '">' + moneySigned(r.net_usd) + '</span>';
      var chains = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      var cmpOn = state.compare.indexOf(r.slug) >= 0;
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.detail === r.slug ? 'selected' : '') + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (watchlist[r.slug] ? '<span class="wl">Watchlist</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(chains || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + net + '</td>' +
        '<td>' + chip(r.verdict) + '</td>' +
        '<td><button class="cmp-btn' + (cmpOn ? ' on' : '') + '" data-cmp="' + esc(r.slug) + '" title="Compare">' + (cmpOn ? '✓ Comparing' : '⇄ Compare') + '</button></td></tr>';
    }).join('');
    Array.prototype.forEach.call($('board-body').querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.getAttribute && ev.target.getAttribute('data-cmp')) return;
        openDetail(tr.getAttribute('data-slug'));
      });
    });
    Array.prototype.forEach.call($('board-body').querySelectorAll('[data-cmp]'), function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleCompare(btn.getAttribute('data-cmp'));
      });
    });
  }

  function fillFilters() {
    var cats = {}, chains = {};
    rows.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    $('f-cat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
    $('f-chain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
  }

  // ---------------------------------------------------------------- the detail view

  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    state.detail = slug;
    renderDetail();
    renderBoard();
    var el = $('detail');
    el.hidden = false;
    if (window.location.hash !== '#detail=' + slug) window.location.hash = 'detail=' + slug;
    el.scrollIntoView({ block: 'start' });
  }

  function closeDetail() {
    state.detail = null;
    $('detail').hidden = true;
    renderBoard();
    if (window.location.hash.indexOf('#detail=') === 0) history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function renderDetail() {
    var r = bySlug[state.detail];
    var el = $('detail');
    if (!r) { el.hidden = true; return; }
    var catFactor = Math.exp(r.category_adjustment);
    var catNote = r.category_adjustment >= 0.05 ? (r.category || 'Uncategorised') + ' comps trade above the curve'
      : r.category_adjustment <= -0.05 ? (r.category || 'Uncategorised') + ' comps trade below the curve'
      : 'category near the curve';
    var growthNote = r.change_7d == null ? '7-day change unreported' : '7-day TVL change ' + pct(r.change_7d);
    var lo = r.ci_low_usd, hi = r.ci_high_usd, imp = r.implied_value_usd;
    var pointPct = ((Math.log(imp) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100;
    var steps = r.farm_steps.map(function (s) {
      var parts = s.split(' Cost: ');
      var action = parts[0];
      var rest = parts.length > 1 ? 'Cost: ' + parts.slice(1).join(' Cost: ') : '';
      return '<li>' + esc(action) + (rest ? '<span class="st-cost">' + esc(rest) + '</span>' : '') + '</li>';
    }).join('');
    var cmpOn = state.compare.indexOf(r.slug) >= 0;
    el.innerHTML =
      '<div class="detail-head"><div><h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
      '<p class="detail-meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'chain unreported') +
      ' · ' + ageText(r.age_days) + (watchlist[r.slug] ? ' · <span class="wl">Watchlist</span>' : '') + '</p></div>' +
      '<div><button class="cmp-btn' + (cmpOn ? ' on' : '') + '" id="detail-cmp">' + (cmpOn ? '✓ Comparing' : '⇄ Compare') + '</button> ' +
      '<button class="close-btn" id="detail-close">Close ✕</button></div></div>' +
      '<div class="detail-grid"><div>' +
      '<h3>Where the number comes from</h3>' +
      '<table class="derive"><tbody>' +
      '<tr><td>TVL<span class="dim">the protocol\'s own figure</span></td><td>' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>× curve multiple<span class="dim">fitted curve at this TVL</span></td><td>' + factor(r.size_multiple) + '</td></tr>' +
      '<tr><td>× category adjustment<span class="dim">' + esc(catNote) + '</span></td><td>' + factor(catFactor) + '</td></tr>' +
      '<tr><td>× growth tilt<span class="dim">' + esc(growthNote) + '</span></td><td>' + factor(r.growth_multiplier) + '</td></tr>' +
      '<tr><td>× maturity tilt<span class="dim">' + esc(ageText(r.age_days)) + ' with no token</span></td><td>' + factor(r.maturity_multiplier) + '</td></tr>' +
      '<tr class="total"><td>= implied value<span class="dim">multiple ' + factor(r.multiple) + ' of TVL</span></td><td>' + moneyFull(imp) + '</td></tr>' +
      '</tbody></table>' +
      '<div class="ci-bar"><div class="ci-track"><div class="ci-range" style="left:0%;right:0%"></div>' +
      '<div class="ci-point" style="left:' + pointPct.toFixed(1) + '%"></div></div>' +
      '<div class="ci-labels"><span>' + money(lo) + '</span><span>80% interval, from the fit\'s dispersion</span><span>' + money(hi) + '</span></div></div>' +
      '<h3>Is it worth farming?</h3>' +
      '<table class="econ"><tbody>' +
      '<tr><td>Expected gross<span class="dim">15% farmer allocation × your share of the 5% farming capital' + (r.age_days != null && r.age_days < 365 ? ', ×1.5 early' : '') + '</span></td><td>' + moneySigned(r.gross_usd) + '</td></tr>' +
      '<tr><td>Plan cost<span class="dim">setup + 4 weeks of gas + claim + time</span></td><td>−' + moneySigned(r.cost_usd).replace('−', '').replace('$', '$') + '</td></tr>' +
      '<tr class="total"><td>Net expected value</td><td>' + moneySigned(r.net_usd) + '</td></tr>' +
      '<tr><td>Capital at risk</td><td>' + moneySigned(r.capital_usd) + '</td></tr>' +
      '<tr><td>Verdict</td><td>' + chip(r.verdict) + '</td></tr>' +
      '</tbody></table></div>' +
      '<div><h3>Farm plan — six steps</h3><ol class="steps">' + steps + '</ol></div></div>';
    el.hidden = false;
    $('detail-close').addEventListener('click', closeDetail);
    $('detail-cmp').addEventListener('click', function () { toggleCompare(r.slug); });
  }

  // ---------------------------------------------------------------- compare

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
        el.innerHTML = '<div class="panel-head"><h2>Compare</h2><p class="panel-sub">One protocol picked (' + esc(bySlug[state.compare[0]].name) + '). Pick a second with its ⇄ button.</p></div>';
        el.hidden = false;
      } else el.hidden = true;
      return;
    }
    var cols = state.compare.map(function (slug) {
      var r = bySlug[slug];
      return '<div class="compare-col"><h3>#' + r.rank + ' — ' + esc(r.name) + '</h3>' +
        '<p class="c-sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + '</p>' +
        '<table class="derive"><tbody>' +
        '<tr><td>TVL</td><td>' + money(r.tvl_usd) + '</td></tr>' +
        '<tr><td>7-day change</td><td>' + pct(r.change_7d) + '</td></tr>' +
        '<tr><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr>' +
        '<tr><td>80% interval</td><td>' + money(r.ci_low_usd) + ' – ' + money(r.ci_high_usd) + '</td></tr>' +
        '<tr><td>Multiple of TVL</td><td>' + factor(r.multiple) + '</td></tr>' +
        '<tr><td>Curve × category × growth × maturity</td><td>' + factor(r.size_multiple) + ' · ' + factor(Math.exp(r.category_adjustment)) + ' · ' + factor(r.growth_multiplier) + ' · ' + factor(r.maturity_multiplier) + '</td></tr>' +
        '<tr><td>Farm net</td><td>' + moneySigned(r.net_usd) + ' on ' + moneySigned(r.capital_usd) + '</td></tr>' +
        '<tr><td>Verdict</td><td>' + chip(r.verdict) + '</td></tr>' +
        '</tbody></table></div>';
    }).join('');
    el.innerHTML = '<div class="panel-head"><h2>Compare</h2><p class="panel-sub">Two protocols, side by side. Pick different ones with the ⇄ buttons in the board.</p></div><div class="compare-grid">' + cols + '</div>';
    el.hidden = false;
  }

  // ---------------------------------------------------------------- the live view

  function renderLive() {
    $('live-body').innerHTML = DATA.comps.slice(0, 24).map(function (c) {
      var chg = c.change_7d == null ? '—' :
        '<span class="' + (c.change_7d > 0 ? 'up' : c.change_7d < 0 ? 'down' : '') + '">' + pct(c.change_7d) + '</span>';
      return '<tr><td><span class="name">' + esc(c.name) + '</span><span class="slug">' + esc(c.slug) + '</span></td>' +
        '<td>' + esc(c.category || '—') + '</td>' +
        '<td class="num">' + money(c.tvl_usd) + '</td>' +
        '<td class="num">' + money(c.mcap_usd) + '</td>' +
        '<td class="num">' + factor(c.multiple) + '</td>' +
        '<td class="num">' + chg + '</td></tr>';
    }).join('');
  }

  // ---------------------------------------------------------------- wiring

  function bindControls() {
    $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); });
    $('f-cat').addEventListener('change', function () { state.cat = $('f-cat').value; renderBoard(); });
    $('f-chain').addEventListener('change', function () { state.chain = $('f-chain').value; renderBoard(); });
    $('f-verdict').addEventListener('change', function () { state.verdict = $('f-verdict').value; renderBoard(); });
    $('f-sort').addEventListener('change', function () { state.sort = $('f-sort').value; renderBoard(); });
    $('f-watch').addEventListener('change', function () { state.watch = $('f-watch').checked; renderBoard(); });
    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        state.sort = th.getAttribute('data-sort');
        $('f-sort').value = state.sort;
        renderBoard();
      });
    });
    window.addEventListener('hashchange', applyHash);
  }

  function applyDetail(slug) {
    if (bySlug[slug] && state.detail !== slug) openDetail(slug);
  }
  function applyFilter(spec) {
    if (spec.indexOf('cat:') === 0) { state.cat = spec.slice(4); $('f-cat').value = state.cat; }
    if (spec.indexOf('verdict:') === 0) { state.verdict = spec.slice(8); $('f-verdict').value = state.verdict; }
    renderBoard();
    $('board-section').scrollIntoView({ block: 'start' });
  }
  function applyCompare(spec) {
    var parts = spec.split(',').filter(function (s) { return bySlug[s]; });
    if (parts.length === 2) { state.compare = parts; renderCompare(); renderBoard(); $('compare').scrollIntoView({ block: 'start' }); }
  }
  function applyShot(spec) {
    var el = spec === 'curve' ? document.querySelector('.curve-panel') : spec === 'method' ? document.querySelector('.method') : null;
    if (el) el.scrollIntoView({ block: 'start' });
  }
  function applyHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (h.indexOf('detail=') === 0) { applyDetail(decodeURIComponent(h.slice(7))); return; }
    if (h.indexOf('filter=') === 0) { applyFilter(decodeURIComponent(h.slice(7))); return; }
    if (h.indexOf('compare=') === 0) { applyCompare(decodeURIComponent(h.slice(8))); return; }
    if (h.indexOf('shot=') === 0) { applyShot(h.slice(5)); }
  }
  function applyQuery() {
    var q = new URLSearchParams(window.location.search);
    if (q.get('detail')) { applyDetail(q.get('detail')); return true; }
    if (q.get('filter')) { applyFilter(q.get('filter')); return true; }
    if (q.get('compare')) { applyCompare(q.get('compare')); return true; }
    if (q.get('shot')) { applyShot(q.get('shot')); return true; }
    return false;
  }

  renderMeta();
  renderStats();
  renderFit();
  renderScatter();
  renderRisers();
  fillFilters();
  renderBoard();
  renderLive();
  renderCompare();
  bindControls();
  if (!applyQuery()) applyHash();
})();
