// Launch Radar v3.7's model, in the browser: main.ts's maths, re-run here.
(function (global) {
 'use strict';
 var LTVL_REF = Math.log(100000000);
 var GW = 0.5, MR = 0.08, MAT_DAYS = 1095, UNKNOWN_AGE = 365;
 var BOOT_N = 200, BOOT_SEED = 20261114, BAND_K = 30;
 var HOURLY = 2.4;
 var FARM = { tbill: 0.04, horizon: 90, farmNet: 25 };
 /* Gas rates (cents per action, by chain) arrive from data.js via
  setGasRates — the stated table, built by lib/model.ts. Ethereum
  $3.00, unlisted chains $1.00. */
 var GR = {};
 function setGasRates(t) { GR = t || {}; }
 var DAY_MS = 86400000;

 function quantile(v, q) { var s = v.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; }
 function median(v) { return quantile(v, 0.5); }
 function finite(v, fb) { return typeof v === 'number' && isFinite(v) ? v : fb; }
 function ageDays(asOf, listedAt) {
  if (listedAt == null) return null;
  var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
 }
 function mulberry32(seed) {
  var s = seed | 0;
  return function () {
   s = (s + 0x6d2b79f5) | 0;
   var t = Math.imul(s ^ (s >>> 15), 1 | s);
   t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
   return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
 }
 var logMult = function (p) { return Math.log(p.mcap_usd / p.tvl_usd); };

 function fitSizeCurve(comps) {
  var xs = [], ys = [], i, n = comps.length, xm = 0, ym = 0;
  for (i = 0; i < n; i++) { xs.push(Math.log(comps[i].tvl_usd) - LTVL_REF); ys.push(logMult(comps[i])); xm += xs[i]; ym += ys[i]; }
  xm /= n; ym /= n;
  var sxy = 0, sxx = 0;
  for (i = 0; i < n; i++) { sxy += (xs[i] - xm) * (ys[i] - ym); sxx += (xs[i] - xm) * (xs[i] - xm); }
  var slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: ym - slope * xm, slope: slope, n: n };
 }
 function curveAt(curve, tvl) { return curve.intercept + curve.slope * (Math.log(tvl) - LTVL_REF); }

 function growthTilt(p) {
  var g = Math.min(100, Math.max(-50, finite(p.change_7d, 0)));
  return 1 + (g / 100) * GW;
 }
 function maturityTilt(asOf, p) {
  var age = ageDays(asOf, p.listed_at);
  if (age == null) age = UNKNOWN_AGE;
  return 1 - MR / 2 + (Math.min(Math.max(age, 0), MAT_DAYS) / MAT_DAYS) * MR;
 }
 function fitVariant(comps) {
  var curve = fitSizeCurve(comps);
  return { curve: curve, flat: median(comps.map(logMult)) };
 }
 function fittedLogMultiple(asOf, p, fit) {
  return curveAt(fit.curve, p.tvl_usd) + Math.log(growthTilt(p)) + Math.log(maturityTilt(asOf, p));
 }
 function impliedValue(asOf, p, fit) {
  return Math.max(1, Math.round(p.tvl_usd * Math.exp(fittedLogMultiple(asOf, p, fit))));
 }
 function curveSays(p, fit) {
  return Math.max(1, Math.round(p.tvl_usd * Math.exp(curveAt(fit.curve, p.tvl_usd))));
 }

 function looTest(comps, asOf) {
  var errs = [], flat = [], resids = [], i, train, fit, pred, act;
  for (i = 0; i < comps.length; i++) {
   train = comps.filter(function (_, j) { return j !== i; });
   fit = fitVariant(train);
   pred = fittedLogMultiple(asOf, comps[i], fit);
   act = logMult(comps[i]);
   errs.push(Math.abs(act - pred));
   flat.push(Math.abs(act - fit.flat));
   resids.push({ tvl_usd: comps[i].tvl_usd, resid: act - pred });
  }
  return { med: median(errs), flatMed: median(flat), residuals: resids };
 }
 function walkForwardTest(comps, asOf) {
  var dated = comps.filter(function (p) { return ageDays(asOf, p.listed_at) !== null; })
   .sort(function (a, b) { return (Date.parse(a.listed_at) - Date.parse(b.listed_at)) || (a.slug < b.slug ? -1 : 1); });
  var n = dated.length, errs = [], flat = [], tested = 0, f, cut, next;
  [0.5, 0.6, 0.7, 0.8, 0.9].forEach(function (frac) {
   cut = Math.floor(n * frac);
   next = Math.min(n, cut + Math.max(1, Math.floor(n * 0.1)));
   if (next - cut === 0 || cut < 10) return;
   var fit = fitVariant(dated.slice(0, cut)), i, pred, act;
   for (i = cut; i < next; i++) {
    pred = fittedLogMultiple(asOf, dated[i], fit);
    act = logMult(dated[i]);
    errs.push(Math.abs(act - pred));
    flat.push(Math.abs(act - fit.flat));
   }
   tested += next - cut;
  });
  return { med: median(errs), flatMed: median(flat), tested: tested };
 }

 function bySlug(a, b) { return a.slug < b.slug ? -1 : 1; }
 function bootstrapRefits(comps, rows, asOf) {
  comps = comps.slice().sort(bySlug);
  var rng = mulberry32(BOOT_SEED), ranks = {}, imps = {}, b, j, sample, fit, scored;
  rows.forEach(function (r) { ranks[r.slug] = []; imps[r.slug] = []; });
  for (b = 0; b < BOOT_N; b++) {
   sample = [];
   for (j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rng() * comps.length)]);
   fit = fitVariant(sample);
   scored = rows.map(function (r) {
    return { slug: r.slug, imp: r.tvl_usd * Math.exp(fittedLogMultiple(asOf, r, fit)) };
   });
   scored.sort(function (a, c) { return c.imp - a.imp || bySlug(a, c); });
   scored.forEach(function (s, i) { ranks[s.slug].push(i + 1); imps[s.slug].push(s.imp); });
  }
  var out = {};
  rows.forEach(function (r) {
   var rl = ranks[r.slug], il = imps[r.slug];
   out[r.slug] = {
    rank_lo: quantile(rl, 0.1), rank_hi: quantile(rl, 0.9),
    top20: rl.filter(function (x) { return x <= 20; }).length / rl.length,
    p10: quantile(il, 0.1), p25: quantile(il, 0.25),
    p75: quantile(il, 0.75), p90: quantile(il, 0.9)
   };
  });
  return out;
 }
 function rowBands(implied, tvl, looResiduals, refit) {
  var all = looResiduals.map(function (r) { return r.resid; });
  var wLo = quantile(all, 0.01), wHi = quantile(all, 0.99);
  var near = looResiduals.map(function (r) {
   return { d: Math.abs(Math.log(r.tvl_usd) - Math.log(tvl)), resid: Math.min(wHi, Math.max(wLo, r.resid)) };
  }).sort(function (a, b) { return a.d - b.d; }).slice(0, BAND_K).map(function (x) { return x.resid; });
  function band(qLo, qHi, refLo, refHi) {
   var lo = quantile(near, qLo), hi = quantile(near, qHi);
   var center = (hi + lo) / 2, localHalf = (hi - lo) / 2;
   var refitHalf = Math.log(refHi / refLo) / 2;
   var half = Math.sqrt(localHalf * localHalf + refitHalf * refitHalf);
   return [Math.max(1, Math.round(implied * Math.exp(center - half))), Math.round(implied * Math.exp(center + half))];
  }
  var a = band(0.25, 0.75, refit.p25, refit.p75), c = band(0.1, 0.9, refit.p10, refit.p90);
  return { p25: a[0], p75: a[1], p10: c[0], p90: c[1] };
 }


 function gasRate(p) {
  var chain = p.chains && p.chains.length > 0 ? p.chains[0] : '';
  if (chain === 'Ethereum') return 3;
  return GR[chain] != null ? GR[chain] / 100 : 1;
 }
 function bridgeFee(p) { var n = p.chains ? p.chains.length : 0; return 0.75 * Math.min(Math.max(n - 1, 0), 5); }
 function planGas(p) { return planActions(p) * gasRate(p) + bridgeFee(p); }
 function planClass(p) {
  var c = (p.category || '').toLowerCase();
  var w = /insurance|bridge|cedefi|payment|card/.test(c) ? 0 : /prediction|otc|governance|launchpad/.test(c) ? 2 : 4;
  var s = /perpetual|derivative|options|basis|bridge|\bdex|leverag/.test(c) ? 25 : /stak|governance|card|payment|index/.test(c) ? 10 : 15;
  var n = p.chains ? p.chains.length : 0;
  var chainMin = 5 * Math.min(Math.max(n - 1, 0), 5);
  var wm = w === 0 ? 5 : w === 2 ? 10 : 15;
  var mins = [7 + chainMin, s + 4, 12, 17, wm * 12 + 2 * w, 17, 12, 5];
  var hours = mins.reduce(function (a, b) { return a + b; }, 0) / 60;
  return { actions: 7 + w, hours: hours, mins: mins, w: w };
 }
 function planActions(p) { return planClass(p).actions; }
 function planHours(p) { return planClass(p).hours; }
 /* Per-step cost (USD) and time (minutes). Each step's actions are priced
  by kind — transfer 21, approval 46, deposit 140, withdrawal 90,
  harvest/claim 100, vote 60, swap 120 (thousands of gas); a move is the
  mean of a withdrawal and a deposit. Weights scale so the steps sum to
  the plan's gas exactly (rounding remainder on the largest step); the
  bridge reserve sits in the Week-2 step. */
 function stepPlan(p) {
  var pc = planClass(p), c = (p.category || '').toLowerCase(), w = pc.w;
  var v = /governance/.test(c), b = /bridge/.test(c), s = /\bdex|swap/.test(c);
  var u = [21, 186, v ? 60 : b ? 150 : s ? 120 : 140, v ? 60 : b ? 150 : 115, w === 4 ? 480 : w === 2 ? (v ? 120 : 200) : 0, 90, 100, 0];
  var g = pc.actions * gasRate(p), tot = 0, i, cs = [], sum = 0, big = 0;
  for (i = 0; i < 8; i++) tot += u[i];
  for (i = 0; i < 8; i++) { cs[i] = Math.round(g * u[i] / tot * 100) / 100 + (i === 3 ? bridgeFee(p) : 0); sum += cs[i]; if (cs[i] > cs[big]) big = i; }
  cs[big] = Math.round((cs[big] + planGas(p) - sum) * 100) / 100;
  return pc.mins.map(function (m, i) { return { cost: cs[i], mins: m }; });
 }
 function timeValue(p) { return planHours(p) * HOURLY; }
 function fixedCost(p) { return planGas(p) + timeValue(p); }
 function forgone(ticket) { return ticket * FARM.tbill * (FARM.horizon / 365); }
 function planCost(p, ticket) { return fixedCost(p) + forgone(ticket); }
 function farmEconomics(p, implied, lowEnd, ticket, share) {
  var cost = planCost(p, ticket);
  var gross = implied * share * (ticket / p.tvl_usd);
  var grossLow = lowEnd * share * (ticket / p.tvl_usd);
  var net = gross - cost, netLow = grossLow - cost;
  var verdict = netLow > 0 ? 'ROBUST' : net >= FARM.farmNet ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP';
  var fixed = fixedCost(p), forgoneRate = FARM.tbill * (FARM.horizon / 365);
  function ticketFor(mult, target) {
   var denom = mult * share - forgoneRate;
   if (denom <= 0) return null;
   return Math.ceil((fixed + target) / denom);
  }
  return {
   verdict: verdict, net: net, netLow: netLow, gross: gross, grossLow: grossLow,
   cost: cost, forgone: forgone(ticket),
   breakEven: (cost * p.tvl_usd) / (share * ticket),
   breakEvenOdds: gross > 0 ? cost / gross : null,
   netPerHour: net / planHours(p),
   paysFrom: ticketFor(implied / p.tvl_usd, 0),
   farmFrom: ticketFor(implied / p.tvl_usd, FARM.farmNet),
   robustFrom: ticketFor(lowEnd / p.tvl_usd, 0)
  };
 }

 function nearestComps(row, comps, fit, n) {
  var scored = comps.map(function (c) {
   var same = (c.category || '(none)') === (row.category || '(none)') ? 0 : 0.5;
   return { c: c, d: Math.abs(Math.log(c.tvl_usd) - Math.log(row.tvl_usd)) + same };
  });
  scored.sort(function (a, b) { return a.d - b.d; });
  return scored.slice(0, n).map(function (s) {
   var says = curveSays(s.c, fit);
   return { comp: s.c, curveSays: says, actualDivCurve: s.c.mcap_usd / says };
  });
 }

 function boardDigest(rows, impliedOf) {
  var h = 0x811c9dc5, i, j, s;
  for (i = 0; i < rows.length; i++) {
   s = rows[i].slug + ':' + impliedOf(rows[i]) + ';';
   for (j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193); }
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
 }

 function verify(DATA) {
  var t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  var comps = DATA.comps.slice().sort(bySlug);
  var rows = DATA.rows, asOf = DATA.as_of;
  var fit = fitVariant(comps);
  var values = 0, verdicts = 0, bands = 0, ranges = 0, steps = 0, i, r, imp, econ, band, agg = 0, mono = true, prev = Infinity;
  var loo = looTest(comps, asOf);
  var wf = walkForwardTest(comps, asOf);
  var refits = bootstrapRefits(comps, rows, asOf);
  var recomputed = {};
  for (i = 0; i < rows.length; i++) {
   r = rows[i];
   imp = impliedValue(asOf, r, fit);
   if (imp > prev) mono = false;
   prev = imp;
   recomputed[r.slug] = imp;
   agg += imp;
   if (imp === r.implied_value_usd) values++;
   econ = farmEconomics(r, r.implied_value_usd, r.p25_usd, DATA.farm_assumptions.default_ticket_usd, DATA.farm_assumptions.default_share);
   if (econ.verdict === r.verdict) verdicts++;
   band = rowBands(r.implied_value_usd, r.tvl_usd, loo.residuals, refits[r.slug]);
   if (band.p25 === r.p25_usd && band.p75 === r.p75_usd && band.p10 === r.p10_usd && band.p90 === r.p90_usd) bands++;
   if (refits[r.slug].rank_lo === r.rank_lo && refits[r.slug].rank_hi === r.rank_hi) ranges++;
   var st = r.farm_steps || [];
   if (st.length === 8 && st.every(function (s) { return s.length >= 20 && s.length <= 600; })) steps++;
  }
  var looOk = Math.abs(loo.med - DATA.loo.model_median_log_err) < 0.005;
  var wfOk = Math.abs(wf.med - DATA.walk_forward.model_median_log_err) < 0.005;
  var digest = boardDigest(rows, function (row) { return recomputed[row.slug]; });
  var digestOk = digest === DATA.board_digest;
  var aggOk = agg === DATA.aggregate_implied_usd;
  var t1 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  return {
   n: rows.length, values: values, verdicts: verdicts, bands: bands, ranges: ranges, steps: steps,
   looOk: looOk, wfOk: wfOk, digest: digest, digestOk: digestOk, agg: agg, aggOk: aggOk,
   looX: Math.exp(loo.med), wfX: Math.exp(wf.med),
   seconds: (t1 - t0) / 1000,
   ok: values === rows.length && verdicts === rows.length && bands === rows.length && ranges === rows.length && steps === rows.length && looOk && wfOk && digestOk && aggOk && mono
  };
 }

 global.RADAR_MODEL = {
  FARM: FARM, fitVariant: fitVariant, impliedValue: impliedValue, curveSays: curveSays,
  farmEconomics: farmEconomics, planCost: planCost, forgone: forgone, gasRate: gasRate,
  planActions: planActions, planHours: planHours, stepPlan: stepPlan, planGas: planGas, setGasRates: setGasRates,
  looTest: looTest, walkForwardTest: walkForwardTest, bootstrapRefits: bootstrapRefits,
  rowBands: rowBands, nearestComps: nearestComps, verify: verify
 };
})(typeof window !== 'undefined' ? window : globalThis);
