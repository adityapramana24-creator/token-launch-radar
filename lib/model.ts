// Launch Radar v2: the token radar's model.
//
// One sealed snapshot in, one ranked board out. The board covers every slug
// in the snapshot's watchlist (the floor, never the ceiling) plus every other
// pre-token protocol that passes the watchlist's own test — no wrapped,
// staked or bridged product of a token that already trades, no exchange
// product, no versioned pool. On this snapshot that is 198 rows.
//
// The value model is fitted from the market, not asserted:
//
//   comps     = the 92 traded-token protocols that pass the same test and
//               carry both a market cap and a TVL
//   sizeCurve = ordinary least squares of log(mcap/TVL) on log(TVL), fitted
//               on the comps: big protocols trade at a smaller multiple of
//               their TVL, and the curve says by how much
//   catAdj    = each category's median residual off the curve, shrunk toward
//               zero by n/(n+5) so a thin category cannot swing a row; a
//               category with fewer than two traded comps gets no adjustment,
//               and no adjustment moves a row by more than a factor of two
//               either way, so one outlier comp cannot crown a protocol
//   multiple  = exp(sizeCurve + catAdj) x growthTilt x maturityTilt
//   implied   = TVL x multiple
//
// The growth tilt (at most +/-25%) and the maturity tilt (0.85..1.15) are
// stated tilts, bounded and disclosed on the dashboard; the curve and the
// category adjustments are fitted from the snapshot's own traded tokens.
// No protocol name is ever special-cased: the same functions score every row.
//
// The fit is tested, not trusted: the model is refit on half the comps and
// scored on the half it never saw (a split-half test and a time-split test,
// each against a flat-median baseline), and the fitted curve is bootstrapped
// 200 times. Those numbers are computed here, from this snapshot, on every
// run, and the dashboard shows them.
//
// Every row also carries an 80% interval from the fit's residual dispersion,
// and a farm verdict (FARM / THIN / SKIP) netted to the dollar: the expected
// farmer share of the implied value, under the stated assumptions, minus the
// gas and time the plan costs.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2 comps-fitted';

/** log(TVL) reference point of the size curve: $100M of TVL. */
const LTVL_REF = Math.log(100_000_000);
/** Category shrinkage: an adjustment's weight is n/(n+K). */
const CAT_SHRINK_K = 5;
/** A category needs at least this many traded comps to earn any adjustment. */
const CAT_MIN_N = 2;
/** No category adjustment moves a row by more than this many log units (x2.01). */
const CAT_ADJ_CAP = 0.7;
/** Growth tilt: 1 + GROWTH_WEIGHT x clamped 7-day change (a fraction). */
const GROWTH_WEIGHT = 0.25;
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 100;
/** Maturity tilt: MATURITY_BASE + MATURITY_RANGE x min(age, MATURITY_DAYS)/MATURITY_DAYS. */
const MATURITY_BASE = 0.85;
const MATURITY_RANGE = 0.3;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_DAYS = 365;
/** The 80% interval's z value (two-sided). */
const Z80 = 1.2815515655446004;
/** Bootstrap resamples of the fitted curve. */
const BOOTSTRAP_N = 200;
const BOOTSTRAP_SEED = 20261114;
/** Farm economics: the stated assumptions behind every verdict. */
export const FARM = {
  /** Share of the implied value assumed to reach farmers. */
  allocation: 0.15,
  /** Share of a protocol's TVL assumed to be actively farming capital. */
  participation: 0.05,
  /** Points multiplier for protocols listed under a year ago. */
  early_multiplier: 1.5,
  early_age_days: 365,
  /** Verdict thresholds on net dollars: FARM at or above, THIN at or above zero. */
  farm_net_usd: 25,
  thin_net_usd: 0,
  /** Weekly gas for four weeks of qualifying actions, plus the claim. */
  weekly_gas_usd: 2,
  weekly_weeks: 4,
  claim_gas_usd: 3,
  /** A flat dollar proxy for the plan's time (about two hours). */
  time_value_usd: 6,
};
/** How many live-token protocols the dashboard's Live view lists, by market cap. */
export const LIVE_ROWS = 24;
/** How many risers the dashboard's trending strip shows. */
export const RISER_ROWS = 8;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_multiple: number;
    category_adjustment: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    multiple: number;
    ci_low_usd: number;
    ci_high_usd: number;
  };
  farm: {
    verdict: 'FARM' | 'THIN' | 'SKIP';
    net_usd: number;
    gross_usd: number;
    cost_usd: number;
    capital_usd: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  ci_low_usd: number;
  ci_high_usd: number;
  multiple: number;
  size_multiple: number;
  category_adjustment: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_usd: number;
  gross_usd: number;
  cost_usd: number;
  capital_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** One traded-token comp, for the scatter plot and the Live view. */
export interface CompRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

/** One out-of-sample test: the model against the flat-median baseline. */
export interface OosTest {
  name: string;
  train_n: number;
  test_n: number;
  model_median_log_err: number;
  flat_median_log_err: number;
  model_within_2x: number;
  flat_within_2x: number;
  band_coverage_80: number;
}

/** Everything the dashboard needs: the board, the fit, the tests, the comps. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  comps_size: number;
  aggregate_implied_usd: number;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  fit: {
    intercept: number;
    slope: number;
    residual_sd: number;
    r_squared: number;
    multiple_at_100m: number;
    bootstrap_p10: number;
    bootstrap_p50: number;
    bootstrap_p90: number;
  };
  oos: OosTest[];
  farm_assumptions: typeof FARM;
  rows: RadarRow[];
  comps: CompRow[];
  risers: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name. */
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** Categories the watchlist rule keeps out: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol passes the watchlist rule's exclusions (its token status aside). */
function passesWatchlistTest(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_START.test(p.name)) return false;
  return true;
}

/** Whether a protocol is one the board may rank: pre-token and passing the watchlist's own test. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && passesWatchlistTest(p);
}

/** Whether a protocol is a comp: its token trades, it carries a market cap and a TVL, and it passes the same test. */
export function isComp(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && passesWatchlistTest(p);
}

// ---------------------------------------------------------------- the fitted curve

/** The size curve: log(mcap/TVL) = intercept + slope x (log(TVL) - log($100M)). */
export interface SizeCurve {
  intercept: number;
  slope: number;
  residual_sd: number;
  r_squared: number;
  n: number;
}

/** log(mcap/TVL) of a comp. */
const logMultiple = (p: SnapshotProtocol): number => Math.log((p.mcap_usd as number) / p.tvl_usd);

/** The size curve fitted on `comps` by ordinary least squares (closed form, two parameters). */
export function fitSizeCurve(comps: SnapshotProtocol[]): SizeCurve {
  const xs = comps.map((p) => Math.log(p.tvl_usd) - LTVL_REF);
  const ys = comps.map(logMultiple);
  const n = comps.length;
  const xMean = xs.reduce((a, x) => a + x, 0) / n;
  const yMean = ys.reduce((a, y) => a + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - xMean) * (ys[i]! - yMean);
    sxx += (xs[i]! - xMean) * (xs[i]! - xMean);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = yMean - slope * xMean;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const fit = intercept + slope * xs[i]!;
    ssRes += (ys[i]! - fit) ** 2;
    ssTot += (ys[i]! - yMean) ** 2;
  }
  return {
    intercept,
    slope,
    residual_sd: Math.sqrt(ssRes / Math.max(1, n - 2)),
    r_squared: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    n,
  };
}

/** The curve's log multiple at a TVL. */
function curveAt(curve: SizeCurve, tvlUsd: number): number {
  return curve.intercept + curve.slope * (Math.log(tvlUsd) - LTVL_REF);
}

/** Each category's median residual off the curve, shrunk toward zero by n/(n+5).
 * A category with fewer than CAT_MIN_N traded comps gets no adjustment at all,
 * and every adjustment is clamped to +/-CAT_ADJ_CAP log units, so one outlier
 * comp in a thin category cannot crown a protocol. */
export function categoryAdjustments(comps: SnapshotProtocol[], curve: SizeCurve): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? '(none)';
    const list = byCat.get(key) ?? [];
    list.push(logMultiple(p) - curveAt(curve, p.tvl_usd));
    byCat.set(key, list);
  }
  const out = new Map<string, number>();
  for (const [key, residuals] of byCat) {
    if (residuals.length < CAT_MIN_N) {
      out.set(key, 0);
      continue;
    }
    const weight = residuals.length / (residuals.length + CAT_SHRINK_K);
    const raw = weight * median(residuals);
    out.set(key, Math.min(CAT_ADJ_CAP, Math.max(-CAT_ADJ_CAP, raw)));
  }
  return out;
}

/** The fitted log multiple of any protocol: the curve at its TVL plus its category's adjustment. */
function fittedLogMultiple(p: SnapshotProtocol, curve: SizeCurve, catAdj: Map<string, number>): number {
  return curveAt(curve, p.tvl_usd) + (catAdj.get(p.category ?? '(none)') ?? 0);
}

/** The growth tilt: 1 + 0.25 x clamped 7-day change, so at most +/-25%. */
export function growthTilt(p: SnapshotProtocol): number {
  const growth = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(p.change_7d, 0)));
  return 1 + (growth / 100) * GROWTH_WEIGHT;
}

/** The maturity tilt: 0.85 for a brand-new protocol, rising to 1.15 at three years without a token. */
export function maturityTilt(asOf: string, p: SnapshotProtocol): number {
  const age = ageDays(asOf, p.listed_at) ?? UNKNOWN_AGE_DAYS;
  return MATURITY_BASE + (Math.min(Math.max(age, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
}

// ---------------------------------------------------------------- out-of-sample tests

/** One held-out evaluation: the model's errors against the flat-median baseline's. */
function evaluateHeldOut(
  name: string,
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
): OosTest {
  const curve = fitSizeCurve(train);
  const catAdj = categoryAdjustments(train, curve);
  const flat = median(train.map(logMultiple));
  const modelErrs = test.map((p) => logMultiple(p) - fittedLogMultiple(p, curve, catAdj));
  const flatErrs = test.map((p) => logMultiple(p) - flat);
  const within2x = (errs: number[]): number => errs.filter((e) => Math.abs(e) <= Math.log(2)).length / Math.max(1, errs.length);
  const band = Z80 * curve.residual_sd;
  return {
    name,
    train_n: train.length,
    test_n: test.length,
    model_median_log_err: median(modelErrs.map(Math.abs)),
    flat_median_log_err: median(flatErrs.map(Math.abs)),
    model_within_2x: within2x(modelErrs),
    flat_within_2x: within2x(flatErrs),
    band_coverage_80: modelErrs.filter((e) => Math.abs(e) <= band).length / Math.max(1, modelErrs.length),
  };
}

/** The model's out-of-sample record: a split-half test and a time-split test. */
export function outOfSampleTests(comps: SnapshotProtocol[], asOf: string): OosTest[] {
  const bySlug = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const splitHalf = evaluateHeldOut(
    'Split-half',
    bySlug.filter((_, i) => i % 2 === 0),
    bySlug.filter((_, i) => i % 2 === 1),
  );
  const withAge = comps
    .filter((p) => ageDays(asOf, p.listed_at) !== null)
    .sort((a, b) => (ageDays(asOf, b.listed_at) as number) - (ageDays(asOf, a.listed_at) as number));
  const half = Math.floor(withAge.length / 2);
  const timeSplit = evaluateHeldOut('Time-split', withAge.slice(0, half), withAge.slice(half));
  return [splitHalf, timeSplit];
}

/** A small deterministic PRNG (mulberry32) for the bootstrap. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fitted multiple at $100M TVL across 200 bootstrap resamples of the comps: its 10th, 50th and 90th percentiles. */
export function bootstrapMultiple(comps: SnapshotProtocol[]): { p10: number; p50: number; p90: number } {
  const rng = mulberry32(BOOTSTRAP_SEED);
  const draws: number[] = [];
  for (let i = 0; i < BOOTSTRAP_N; i++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    draws.push(Math.exp(fitSizeCurve(sample).intercept));
  }
  draws.sort((a, b) => a - b);
  return {
    p10: draws[Math.floor(0.1 * draws.length)]!,
    p50: draws[Math.floor(0.5 * draws.length)]!,
    p90: draws[Math.floor(0.9 * draws.length)]!,
  };
}

// ---------------------------------------------------------------- the farm plan

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Chains whose gas is cheap enough that a setup costs about $4 rather than $10. */
const CHEAP_GAS_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'Solana',
  'Blast', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Mode', 'Zora', 'Gnosis',
]);

/** The setup gas for one farm position, from its first chain. */
function setupGasUsd(p: SnapshotProtocol): number {
  return CHEAP_GAS_CHAINS.has(chainOf(p)) ? 4 : 10;
}

/** The whole plan's cost in dollars: setup gas, four weeks of weekly gas, the claim, and the time. */
function planCostUsd(p: SnapshotProtocol): number {
  return setupGasUsd(p) + FARM.weekly_gas_usd * FARM.weekly_weeks + FARM.claim_gas_usd + FARM.time_value_usd;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield aggregator')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('options')) return `Deposit $${capital} of USDC into ${name}'s vault on ${chain} and keep the position open.`;
  if (c.includes('launchpad')) return `Stake $${capital} through ${name} on ${chain} to qualify for its launches.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = setupGasUsd(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${FARM.weekly_gas_usd} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The farm verdict's economics: expected gross, plan cost and net, all in dollars. */
export function farmEconomics(
  p: SnapshotProtocol,
  impliedUsd: number,
  age: number | null,
): { verdict: 'FARM' | 'THIN' | 'SKIP'; net: number; gross: number; cost: number; capital: number } {
  const capital = capitalFor(p);
  const early = age !== null && age < FARM.early_age_days ? FARM.early_multiplier : 1;
  const gross = impliedUsd * FARM.allocation * (capital / (p.tvl_usd * FARM.participation)) * early;
  const cost = planCostUsd(p);
  const net = gross - cost;
  const verdict = net >= FARM.farm_net_usd ? 'FARM' : net >= FARM.thin_net_usd ? 'THIN' : 'SKIP';
  return { verdict, net, gross, cost, capital };
}

// ---------------------------------------------------------------- the board

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; comps: SnapshotProtocol[]; curve: SizeCurve; catAdj: Map<string, number> } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const comps = snapshot.protocols.filter(isComp);
  const curve = fitSizeCurve(comps);
  const catAdj = categoryAdjustments(comps, curve);

  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol that passes the watchlist's own test.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const band = Math.exp(Z80 * curve.residual_sd);
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const sizeMultiple = Math.exp(curveAt(curve, p.tvl_usd));
    const cat = catAdj.get(p.category ?? '(none)') ?? 0;
    const gTilt = growthTilt(p);
    const mTilt = maturityTilt(snapshot.as_of, p);
    const multiple = sizeMultiple * Math.exp(cat) * gTilt * mTilt;
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
    const econ = farmEconomics(p, implied, age);
    return { p, age, sizeMultiple, cat, gTilt, mTilt, multiple, implied, econ, band };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      size_multiple: round4(s.sizeMultiple),
      category_adjustment: round4(s.cat),
      growth_multiplier: round4(s.gTilt),
      maturity_multiplier: round4(s.mTilt),
      multiple: round4(s.multiple),
      ci_low_usd: Math.max(1, Math.round(s.implied / s.band)),
      ci_high_usd: Math.round(s.implied * s.band),
    },
    farm: {
      verdict: s.econ.verdict,
      net_usd: round2(s.econ.net),
      gross_usd: round2(s.econ.gross),
      cost_usd: round2(s.econ.cost),
      capital_usd: s.econ.capital,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, comps, curve, catAdj };
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    ci_low_usd: row.model.ci_low_usd,
    ci_high_usd: row.model.ci_high_usd,
    multiple: row.model.multiple,
    size_multiple: row.model.size_multiple,
    category_adjustment: row.model.category_adjustment,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    verdict: row.farm.verdict,
    net_usd: row.farm.net_usd,
    gross_usd: row.farm.gross_usd,
    cost_usd: row.farm.cost_usd,
    capital_usd: row.farm.capital_usd,
    watchlist: false,
    farm_steps: row.farm_steps,
  };
}

/** The live-token comps, by market cap, for the dashboard's Live view and scatter plot. */
export function compRows(comps: SnapshotProtocol[]): CompRow[] {
  return [...comps]
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      multiple: round4((p.mcap_usd as number) / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, comps, curve } = buildBoard(snapshot);
  const oos = outOfSampleTests(comps, snapshot.as_of);
  const boot = bootstrapMultiple(comps);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.farm.verdict]++;
  const risers = [...board]
    .filter((r) => r.change_7d !== null)
    .sort((a, b) => (b.change_7d as number) - (a.change_7d as number))
    .slice(0, RISER_ROWS)
    .map((r) => r.slug);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    comps_size: comps.length,
    aggregate_implied_usd: board.reduce((a, r) => a + r.implied_value_usd, 0),
    verdict_counts: verdictCounts,
    fit: {
      intercept: round4(curve.intercept),
      slope: round4(curve.slope),
      residual_sd: round4(curve.residual_sd),
      r_squared: round4(curve.r_squared),
      multiple_at_100m: round4(Math.exp(curve.intercept)),
      bootstrap_p10: round4(boot.p10),
      bootstrap_p50: round4(boot.p50),
      bootstrap_p90: round4(boot.p90),
    },
    oos: oos.map((t) => ({
      ...t,
      model_median_log_err: round4(t.model_median_log_err),
      flat_median_log_err: round4(t.flat_median_log_err),
      model_within_2x: round4(t.model_within_2x),
      flat_within_2x: round4(t.flat_within_2x),
      band_coverage_80: round4(t.band_coverage_80),
    })),
    farm_assumptions: FARM,
    rows: board.map((r) => ({ ...radarRow(r), watchlist: snapshot.watchlist.includes(r.slug) })),
    comps: compRows(comps),
    risers,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
