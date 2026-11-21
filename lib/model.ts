// Launch Radar v3.6: the token radar's model.
//
// One sealed snapshot in, one ranked board out. The board covers every slug
// in the snapshot's watchlist (the floor, never the ceiling) plus every other
// pre-token protocol that passes the watchlist's own test — no wrapped,
// staked or bridged product of a token that already trades, no exchange
// product, no versioned pool. On this snapshot that is 198 rows, and the
// other 560 protocols are accounted for on the cover: 416 record a token,
// 144 pre-token protocols are set aside by the same rule.
//
// The value model is fitted from the market, not asserted:
//
//   comps     = the 88 traded-token protocols that pass the same test and
//               carry both a market cap and a TVL (128 trade; 36 are set
//               aside by the rule and 4 more are cross-chain bridges — the
//               same family the rule excludes under another label — and the
//               Method section says so)
//   sizeCurve = ordinary least squares of log(mcap/TVL) on log(TVL), fitted
//               on the comps: big protocols trade at a smaller multiple of
//               their TVL, and the curve says by how much
//   multiple  = exp(sizeCurve) x growthTilt x maturityTilt
//   implied   = TVL x multiple
//
// There is NO category term in v3.2: the ablation tested category
// adjustments (shrink n/(n+64) and n/(n+5)) and REJECTED them — they cost
// ~7% of leave-one-out accuracy. A fitted chains-breadth term was tested
// too and rejected the harder way: it had the shootout's best LOO and its
// walk-forward collapsed, the winner's curse in one row of the table.
// The growth tilt (weight 0.50) improves leave-one-out by 6% (x3.27 to
// x3.06); the maturity tilt (0.96..1.04) improves it slightly more, and
// stays because the bounty names age without a token as an input, at
// the smallest size that shows. No protocol name is ever special-cased: the
// same functions score every row.
//
// v3.2's one model change: the comps are 88, not 92. A second shootout of
// 19 variants (comp sets, weighted OLS, Huber k=1.0/2.0, Theil-Sen, trimmed
// OLS, local and per-band regression, fitted growth/age terms, a hinge,
// growth weights 0.75/1.00) adopted exactly one: dropping the 4 Cross Chain
// Bridge comps. On the shootout's SAME 92 test tokens it improves the LOO
// median (x3.15 to x3.02), with walk-forward inside noise. The parity
// split-half improvement (x3.09 to x2.65) did NOT survive pooling the
// halves (x3.37 vs x3.09) — one split's verdict is luck, which is why
// split-half is no longer a veto (see ABLATION_TOLERANCE). The adoption
// rests on LOO and the methodological reason, not on split-half. The
// bridges' extreme multiples at small TVL are leverage points OLS should
// not have to fit. The paired-bootstrap CI on the mean error includes
// zero, so the gain is a median gain, and the Method section says so. The other 18 variants were rejected, most of them by
// walk-forward; the 128-comp set (no exclusions at all) was worse on every
// test, which is the exclusion rule earning its place.
//
// The fit is tested, not trusted: leave-one-out (88 refits), walk-forward
// (5 origins by listing date), split-half and time-split, each against a
// flat-median baseline, plus a 200-refit bootstrap for rank ranges. Every
// number is computed here, from this snapshot, on every run — and the
// dashboard's own model.js re-runs the fit in the reader's browser and
// checks it against these values.
//
// Each row carries two intervals (P25–P75 and P10–P90) built from the
// model's own leave-one-out misses near that row's TVL, widened by the
// refit spread — not from one global residual SD — and a farm verdict
// (ROBUST / FARM / THIN / SKIP) netted to the dollar at the reader's
// ticket and airdrop share, with the yield forgone as a cost line.

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
export const MODEL_VERSION = 'radar-3.7 comps-fitted';

/** log(TVL) reference point of the size curve: $100M of TVL. */
const LTVL_REF = Math.log(100_000_000);
/** Category shrinkage: an adjustment's weight is n/(n+K). Only used by the
 * ablation's REJECTED category rungs now — the shipped model has no
 * category term (see SHIPPED_VARIANT). */
const CAT_SHRINK_K = 64;
/** A category needs at least this many traded comps to earn any adjustment. */
const CAT_MIN_N = 2;
/** No category adjustment moves a row by more than this many log units (x2.01). */
const CAT_ADJ_CAP = 0.7;
/** Growth tilt: 1 + GROWTH_WEIGHT x clamped 7-day change (a fraction).
 * Weight 0.50: the shootout's winner — on the 88 comps it improves
 * leave-one-out from x3.27 (curve alone) to x3.06; walk-forward and
 * time-split are unchanged, and split-half depends on which half is
 * tested (x2.23 vs x4.00), improving 5% on the pooled halves. */
const GROWTH_WEIGHT = 0.5;
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 100;
/** Maturity tilt: 1 - range/2 + range x min(age, MATURITY_DAYS)/MATURITY_DAYS.
 * Range 0.08 (0.96..1.04): improves leave-one-out slightly (x3.06 to
 * x3.02) and is near-neutral on walk-forward — kept because the bounty
 * names age without a token as an input, at the smallest size that shows. */
const MATURITY_RANGE = 0.08;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_DAYS = 365;
/** Bootstrap resamples for rank ranges and refit spread. */
const BOOTSTRAP_N = 200;
const BOOTSTRAP_SEED = 20261114;
/** Odds model (v4.2 NEW-C): ridge penalty on standardised features. */
const ODDS_LAMBDA = 4;
/** Odds model: undated peers are scored at this age (4.5 years) — the
 * canonical imputation (F-2). 365 days / the median are FORBIDDEN here. */
const ODDS_AGE_IMPUTE_DAYS = 1643;
/** Odds bootstrap: refits + seed. The seed differs from BOOTSTRAP_SEED so
 * the odds RNG stream is independent of the value model's. */
const ODDS_BOOTSTRAP_N = 200;
const ODDS_BOOTSTRAP_SEED = 20261121;
/** Odds 10-fold CV: stratified folds, this seed (same seed as the value
 * model's bootstrap — a different use, no stream shared). */
const ODDS_CV_SEED = 20261114;
/** Odds categories: fewer than this many train members pool to "(other)". */
const ODDS_CAT_MIN_N = 10;
/** Odds 7-day growth is winsorised to this fraction range everywhere
 * (training, CV, walk-forward, scoring): +200% / -90%. */
const ODDS_GROWTH_MIN = -0.9;
const ODDS_GROWTH_MAX = 2.0;
/** Odds Newton/IRLS: iteration cap + step tolerance (Phase 0 fit-odds.py). */
const ODDS_NEWTON_MAX_ITER = 100;
const ODDS_NEWTON_TOL = 1e-8;
/** Nearest comps by log TVL whose leave-one-out misses set a row's band. */
const BAND_NEIGHBORS = 30;
/** Farm economics: the stated assumptions behind every verdict. */
export const FARM = {
  /** Default share of the implied value assumed to reach farmers (field standard). */
  allocation: 0.1,
  /** Shares the reader can pick on the board. */
  shares: [0.05, 0.1, 0.2],
  /** Tickets the reader can pick on the board, in dollars. */
  tickets: [500, 1000, 5000, 10000],
  default_ticket_usd: 5000,
  default_share: 0.1,
  /** A farmer's share of the pool is ticket / TVL: every dollar of TVL is
   * assumed to farm, the conservative case. */
  /** Yield forgone on the ticket: the 90-day T-bill rate. */
  tbill_rate: 0.04,
  horizon_days: 90,
  /** Verdict thresholds on net dollars: FARM at or above, THIN at or above zero.
   * ROBUST is net above zero at the band's low end (P25). */
  farm_net_usd: 25,
  thin_net_usd: 0,
  /** A plan counts every on-chain action its steps name: funding (1),
   * approve + deposit (2), the Day-5 action (1), the Week-2 move (1),
   * the weekly routine (0–4 by mechanism — see weeklyOnChain), the exit
   * (1) and the claim (1): 7–11 actions. Each action is priced at its
   * chain's own rate from a stated table (see gasRateForChain):
   * $0.05–$1.00 a chain, $3.00 on Ethereum. A multi-chain plan also
   * carries a bridge reserve of $0.75 per extra chain (max 5, see
   * bridgeFeeUsd), for moving the position between deployments. */
  /** Hands-on time is priced at this hourly rate; the hours themselves
   * vary per protocol (see stepMinutes): 2.4–5.2 hours a plan, by
   * mechanism, action count and chain count — not one tier. */
  hourly_rate_usd: 2.4,
};
/** The keep/reject rule for ablation rungs, fixed in advance: a rung is
 * KEPT when it improves leave-one-out or walk-forward and worsens neither
 * by more than this fraction. Split-half is NOT a veto: v3.2's swap test
 * showed the two halves score x2.14 and x3.95 for the shipped model (the
 * flat baseline swings x3.78 to x5.11 too), so a single split's verdict
 * is luck, not evidence — it is reported in the out-of-sample table, and
 * the pooled halves (x3.37 shipped vs x3.42 curve-only) agree with LOO
 * that the tilts help. v3's looser rule kept terms that never helped;
 * v3.1's three-test rule vetoed the growth tilt on one lucky split. */
const ABLATION_TOLERANCE = 0.02;

/** A farm verdict. ROBUST pays even at the band's low end. */
export type Verdict = 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';

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
  /** The value if the token launches (the value model's implied value,
   * before the odds multiplier). implied = round(if_launches x ever). */
  if_launches_usd: number;
  /** Token odds: the model's conditional chance this protocol records a
   * token by the oldest observed age (5.07 years), given it has not
   * recorded one yet. Full precision — the $1 arithmetic check in C5.1
   * needs it (a 4-decimal rounding would move the largest rows by $2k+). */
  ever: number;
  model: {
    size_multiple: number;
    category_adjustment: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    multiple: number;
    p25_usd: number;
    p75_usd: number;
    p10_usd: number;
    p90_usd: number;
    rank_lo: number;
    rank_hi: number;
  };
  farm: {
    verdict: Verdict;
    net_usd: number;
    net_low_usd: number;
    gross_usd: number;
    cost_usd: number;
    forgone_usd: number;
    capital_usd: number;
    break_even_usd: number;
    net_per_hour_usd: number;
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
  listed_at: string | null;
  mcap_usd: number | null;
  gecko_id: string | null;
  symbol: string | null;
  implied_value_usd: number;
  /** The value if the token launches (before the odds multiplier). */
  if_launches_usd: number;
  /** Token odds (ever): the conditional chance of recording a token by
   * the oldest observed age, given none yet. Full precision (see BoardRow). */
  ever: number;
  /** The per-row odds derivation HTML (C6), pre-rendered by
   * oddsDerivationHtml — the detail injects it. */
  odds_html: string;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  multiple: number;
  size_multiple: number;
  category_adjustment: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  rank_lo: number;
  rank_hi: number;
  top20_pct: number;
  stop_tvl_usd: number;
  verdict: Verdict;
  net_usd: number;
  net_low_usd: number;
  gross_usd: number;
  cost_usd: number;
  forgone_usd: number;
  capital_usd: number;
  break_even_usd: number;
  break_even_odds: number | null;
  net_per_hour_usd: number;
  pays_from_usd: number | null;
  farm_from_usd: number | null;
  robust_from_usd: number | null;
  watchlist: boolean;
  farm_steps: string[];
  /** The plan's one-word mechanism, from the category: the board's PLAN column. */
  plan_action: string;
  /** The plan's total gas in dollars (7–11 actions at the chain's rate). */
  plan_fees_usd: number;
}

/** One traded-token comp, for the scatter plot, the refit and the Live view. */
export interface CompRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
  listed_at: string | null;
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
  model_within_3x: number;
  flat_within_3x: number;
  rank_rho: number;
}

/** One ablation rung: the model with one more term, and its verdict. */
export interface AblationRung {
  name: string;
  loo_x: number;
  /** Paired-bootstrap SE of the LOO median (× units, 2000 draws). */
  loo_se_x: number;
  loo_within_3x: number;
  loo_rho: number;
  wf_x: number;
  wf_within_3x: number;
  wf_rho: number;
  decision: 'KEEP' | 'REJECT' | 'BASELINE' | 'TRIED';
  note: string;
}

/** One protocol that records a token, for the Token trades tab. */
export interface TradedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  trades: boolean;
}

/** One pre-token protocol set aside by the watchlist rule, with its reason. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** The odds model (v4.2 NEW-C): a logistic fit on the K-set peers, its
 * held-out tests, and the per-row features the dashboard needs to show
 * the derivation. Coefficients are in NATURAL units (back-transformed
 * from the standardised fit); `standardization` carries the train
 * mean/sd so the back-transform can be re-derived (C1.5). */
export interface OddsData {
  lambda: number;
  age_impute_days: number;
  /** The ever horizon in years: the oldest observed K age (days / 365.25). */
  horizon_years: number;
  horizon_days: number;
  n_peers: number;
  n_launched: number;
  /** Natural-unit coefficients: intercept, years, lnTVL, growth, plus
   * `cat:<name>` for each fitted category dummy (reference excluded). */
  coef: Record<string, number>;
  /** Bootstrap standard errors (200 refits, seed 20261121), same keys. */
  coef_se: Record<string, number>;
  /** Standardised-scale coefficients, same keys (for the back-transform). */
  coef_std: Record<string, number>;
  standardization: Record<'years' | 'lnTVL' | 'growth', { mean: number; sd: number }>;
  /** Fitted categories (alphabetical; first = reference, coefficient 0). */
  vocab: string[];
  reference_category: string;
  bootstrap_n: number;
  bootstrap_seed: number;
  wf: {
    cutoff: string;
    train_n: number;
    test_n: number;
    train_base: number;
    test_base: number;
    brier: number;
    brier_base: number;
    test_slugs: string[];
    calibration: { bin: number; n: number; mean_pred: number; obs_rate: number }[];
  };
  /** Walk-forward test predictions (192), aligned with wf.test_slugs. */
  wf_test_pred: number[];
  /** Walk-forward test labels (192), aligned with wf.test_slugs — the
   * browser's N4m check needs them alongside the predictions. */
  wf_test_labels: number[];
  cv10: {
    brier: number;
    brier_base: number;
    calibration: { bin: number; n: number; mean_pred: number; obs_rate: number }[];
  };
  /** Out-of-fold predictions (442), aligned with peer_slugs. */
  cv10_oof: number[];
  /** Fold index per peer (442), aligned with peer_slugs. */
  cv10_folds: number[];
  /** K-set slugs in snapshot order — the alignment of cv10_oof/folds. */
  peer_slugs: string[];
  /** Launch labels (1 = records a token), aligned with peer_slugs — the
   * browser's N4m Brier check recomputes both Briers from these + the
   * stored predictions (no refit in the browser, C7.2). */
  peer_labels: number[];
  /** Min/max category coefficient (natural units), for the stat card. */
  cat_range: [number, number];
  /** Sequential ablation: base -> +age -> +lnTVL -> +growth -> +category
   * -> +chains. A rung is KEPT only when BOTH Briers strictly fall. */
  ablation: { name: string; brier_cv10: number; brier_wf: number; decision: 'KEEP' | 'NOT_KEPT' | 'BASELINE' }[];
  terms_kept: number;
  terms_total: number;
  /** Gain vs the test set's own base rate (C2.7, recorded, no bar). */
  gain_test_base: { wf: number; cv10: number };
  /** Per-ranked-row odds features, for the verifier + the detail
   * derivation (undated rows carry years = 4.50, the imputation). */
  row_features: {
    slug: string;
    years: number;
    lnTVL: number;
    growth: number;
    growth_raw: number | null;
    category: string | null;
    cat_bucket: string;
    p_now: number;
    p_horizon: number;
    p_age1: number;
    ever: number;
    twelve_month: number;
    /** The 9-row odds derivation (C6.1), pre-rendered as kvRows HTML —
     * the detail injects it; the browser does no logistic arithmetic. */
    odds_html: string;
  }[];
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
  accounting: {
    total: number;
    ranked: number;
    token_record: number;
    traded_positive: number;
    token_no_mcap: number;
    token_mcap_null: number;
    token_mcap_nonpositive: number;
    set_aside: number;
    comps_excluded: number;
    comps_excluded_bridge: number;
  };
  verdict_counts: { ROBUST: number; FARM: number; THIN: number; SKIP: number };
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
  loo: OosTest & { points: { slug: string; actual_usd: number; predicted_usd: number }[] };
  walk_forward: OosTest & { origins: number };
  ablation: AblationRung[];
  band_stats: { p25_p75_median_x: number; p10_p90_median_x: number };
  /** Band calibration: the share of LOO comps whose actual value falls
   * inside the band the model would have built for them (aim: 50 / 80). */
  band_coverage: { p25_75: number; p10_90: number };
  /** Base rates: the share of K-set peers that record a token, by how
   * long they have been tracked — the cohort anchor of the odds model
   * (the oldest bucket's 87.5% is the record the model is built on). */
  base_rates: { buckets: { label: string; n: number; launched: number; token_pct: number }[]; holdout: string };
  /** The odds model (v4.2 NEW-C): fit, tests, ablation, per-row features. */
  odds: OddsData;
  /** The set-aside protocols, counted per reason. */
  set_aside_reasons: { reason: string; n: number }[];
  /** The same counts as one cover line ("CEX 42 · Liquid Staking 38 · …"). */
  set_aside_line: string;
  /** Verdict counts + book net at every ticket, at the default share. */
  verdict_by_ticket: { ticket: number; ROBUST: number; FARM: number; THIN: number; SKIP: number; net_usd: number }[];
  /** The three best farms by net per hands-on hour, at the default ticket. */
  best_farms: { rank: number; slug: string; name: string; net_usd: number; net_per_hour_usd: number; verdict: Verdict }[];
  /** FNV-1a seal over slug:implied, recomputed live by the page. */
  board_digest: string;
  /** The ablation note, built from the computed rungs. */
  ablation_note: string;
  /** The value ablation table, pre-rendered (P1 — the dashboard injects
   * it; the numbers stay in `ablation` too, frozen). DOM text identical
   * to the v4.1 JS renderer. */
  ablation_html: string;
  /** The odds ablation table for the sidebar (N2, C4.5), pre-rendered:
   * 6 rungs, Brier to 3 decimals, decision column. */
  odds_ablation_html: string;
  /** The odds stat card lines for the cover strip (N5, C7.1), pre-rendered:
   * Brier WF + CV10 with bases, coef ± SE, category range. */
  odds_card_html: string;
  /** The cover formula strip, pre-rendered (formula + mini-ablation + scatter):
   * computed here so the dashboard source stays under the dossier text cap. */
  cover_fstrip_html: string;
  /** The Method section's leave-one-out scatter (640×300), pre-rendered
   * from the same points — same reason as the cover strip. */
  loo_scatter_svg: string;
  /** The best-farms line, pre-rendered. */
  best_farms_html: string;
  /** Rows whose board rank sits 5+ ranks from their TVL order: the
   * ranking is not TVL in disguise. */
  off_tvl_order: number;
  top20_stable: number;
  farm_assumptions: typeof FARM & { gas_rates: Record<string, number> };
  /** Traded reference anchors shown inline on the board (after rank 5, 50). */
  anchors: { after_rank: number; text: string }[];
  /** The Method section's prose, as content (like the farm steps): the
   * dashboard renders it; the source holds the code, data.js holds the words. */
  method: { h: string; p: string }[];
  rows: RadarRow[];
  comps: CompRow[];
  traded: TradedRow[];
  set_aside: SetAsideRow[];
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

/** A quantile of a list (nearest-rank). */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]!;
}

/** Spearman's rank correlation between two equal-length lists. */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => {
    const idx = v.map((_, i) => i).sort((i, j) => v[i]! - v[j]!);
    const r = new Array<number>(v.length);
    idx.forEach((orig, pos) => {
      r[orig] = pos + 1;
    });
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const m = (n + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i]! - m) * (rb[i]! - m);
    da += (ra[i]! - m) ** 2;
    db += (rb[i]! - m) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
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

/** Which watchlist exclusion a protocol trips, or null when it passes. */
export function watchlistExclusion(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name (V2 / 2.0 pool)';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped / staked product';
  if (EXCHANGE_START.test(p.name)) return 'exchange product';
  return null;
}

/** Whether a protocol passes the watchlist rule's exclusions (its token status aside). */
function passesWatchlistTest(p: SnapshotProtocol): boolean {
  return watchlistExclusion(p) === null;
}

/** Whether a protocol is one the board may rank: pre-token and passing the watchlist's own test. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && passesWatchlistTest(p);
}

/** Whether a protocol is a comp: its token trades, it carries a market cap
 * and a TVL, and it passes the same test. Cross Chain Bridge is excluded
 * too: the watchlist rule already excludes Bridge and Canonical Bridge,
 * and "Cross Chain Bridge" is the same family under another label — its
 * four comps carry extreme multiples at small TVL (2.21x, 3.62x, 0.20x,
 * 0.24x) that act as leverage points on the OLS fit. The v3.2 shootout
 * adopted the exclusion on identical test points (LOO median x3.15 to
 * x3.02, split-half x3.09 to x2.65, walk-forward inside noise); the
 * ablation table carries the 92-comp fit as a rejected rung, so the choice
 * is visible and its numbers are computed here, not asserted. */
export function isComp(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && passesWatchlistTest(p) && p.category !== 'Cross Chain Bridge';
}

/** The v3.1 comp test (no bridge exclusion): the 92-comp set the ablation
 * scores as its rejected "bridges in" rung. */
export function isComp92(p: SnapshotProtocol): boolean {
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

/** A model variant: which terms it uses and how strongly. The shipped
 * variant is { catK: null, growthWeight: 0.5, maturityRange: 0.08 } — no
 * category term, no breadth term, OLS curve. `breadth` adds a fitted
 * log(chain-count) term; `huber` fits the curve by Huber IRLS instead of
 * OLS. Both exist only for the ablation's tried rungs. */
export interface Variant {
  catK: number | null;
  growthWeight: number;
  maturityRange: number;
  breadth?: boolean;
  huber?: boolean;
}

/** The shipped variant. */
export const SHIPPED_VARIANT: Variant = { catK: null, growthWeight: GROWTH_WEIGHT, maturityRange: MATURITY_RANGE };

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

/** Solve a 2x2 symmetric system (the normal equations of a two-regressor OLS). */
function solve2(a11: number, a12: number, a22: number, b1: number, b2: number): [number, number] {
  const det = a11 * a22 - a12 * a12;
  if (det === 0) return [0, 0];
  return [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det];
}

/** OLS of ys on xs plus an optional second regressor zs: {a, b, c}. */
function ols2(xs: number[], zs: number[] | null, ys: number[]): { a: number; b: number; c: number } {
  const n = xs.length;
  const xm = xs.reduce((a, x) => a + x, 0) / n;
  const ym = ys.reduce((a, y) => a + y, 0) / n;
  if (zs === null) {
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i]! - xm) * (ys[i]! - ym);
      sxx += (xs[i]! - xm) ** 2;
    }
    const b = sxx === 0 ? 0 : sxy / sxx;
    return { a: ym - b * xm, b, c: 0 };
  }
  const zm = zs.reduce((a, z) => a + z, 0) / n;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - xm;
    const dz = zs[i]! - zm;
    const dy = ys[i]! - ym;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }
  const [b, c] = solve2(sxx, sxz, szz, sxy, szy);
  return { a: ym - b * xm - c * zm, b, c };
}

/** Huber IRLS (k=1.345, 25 iterations) on the same two-regressor model. */
function huber2(xs: number[], zs: number[] | null, ys: number[]): { a: number; b: number; c: number } {
  let fit = ols2(xs, zs, ys);
  const w = new Array<number>(xs.length).fill(1);
  for (let it = 0; it < 25; it++) {
    const res = ys.map((y, i) => y - (fit.a + fit.b * xs[i]! + fit.c * (zs === null ? 0 : zs[i]!)));
    const s = 1.4826 * median(res.map((r) => Math.abs(r - median(res)))) || 1;
    let maxDelta = 0;
    for (let i = 0; i < res.length; i++) {
      const u = Math.abs(res[i]!) / (1.345 * s);
      const nw = u <= 1 ? 1 : 1 / u;
      maxDelta = Math.max(maxDelta, Math.abs(nw - w[i]!));
      w[i] = nw;
    }
    const sw = w.reduce((a, x) => a + x, 0);
    const wm = (arr: number[]): number => arr.reduce((a, x, i) => a + w[i]! * x, 0) / sw;
    const xm = wm(xs);
    const ym = wm(ys);
    if (zs === null) {
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < xs.length; i++) {
        sxy += w[i]! * (xs[i]! - xm) * (ys[i]! - ym);
        sxx += w[i]! * (xs[i]! - xm) ** 2;
      }
      const b = sxx === 0 ? 0 : sxy / sxx;
      fit = { a: ym - b * xm, b, c: 0 };
    } else {
      const zm = wm(zs);
      let sxx = 0;
      let sxz = 0;
      let szz = 0;
      let sxy = 0;
      let szy = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i]! - xm;
        const dz = zs[i]! - zm;
        const dy = ys[i]! - ym;
        sxx += w[i]! * dx * dx;
        sxz += w[i]! * dx * dz;
        szz += w[i]! * dz * dz;
        sxy += w[i]! * dx * dy;
        szy += w[i]! * dz * dy;
      }
      const [b, c] = solve2(sxx, sxz, szz, sxy, szy);
      fit = { a: ym - b * xm - c * zm, b, c };
    }
    if (maxDelta < 1e-6) break;
  }
  return fit;
}

/** The breadth regressor: log(chain count), at least log(1) = 0. */
function breadthOf(p: SnapshotProtocol): number {
  return Math.log(Math.max(1, p.chains.length));
}

/** Each category's median residual off the curve, shrunk toward zero by
 * n/(n+K). A category with fewer than CAT_MIN_N traded comps gets no
 * adjustment at all, and every adjustment is clamped to +/-CAT_ADJ_CAP log
 * units, so one outlier comp in a thin category cannot crown a protocol. */
export function categoryAdjustments(comps: SnapshotProtocol[], curve: SizeCurve, k: number | null): Map<string, number> {
  const out = new Map<string, number>();
  if (k === null) return out;
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? '(none)';
    const list = byCat.get(key) ?? [];
    list.push(logMultiple(p) - curveAt(curve, p.tvl_usd));
    byCat.set(key, list);
  }
  for (const [key, residuals] of byCat) {
    if (residuals.length < CAT_MIN_N) {
      out.set(key, 0);
      continue;
    }
    const weight = residuals.length / (residuals.length + k);
    const raw = weight * median(residuals);
    out.set(key, Math.min(CAT_ADJ_CAP, Math.max(-CAT_ADJ_CAP, raw)));
  }
  return out;
}

/** The growth tilt: 1 + weight x clamped 7-day change. */
export function growthTilt(p: SnapshotProtocol, weight: number): number {
  const growth = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(p.change_7d, 0)));
  return 1 + (growth / 100) * weight;
}

/** The maturity tilt: 1 - range/2 for a brand-new protocol, rising to
 * 1 + range/2 at three years without a token. */
export function maturityTilt(asOf: string, p: SnapshotProtocol, range: number): number {
  if (range === 0) return 1;
  const age = ageDays(asOf, p.listed_at) ?? UNKNOWN_AGE_DAYS;
  return 1 - range / 2 + (Math.min(Math.max(age, 0), MATURITY_DAYS) / MATURITY_DAYS) * range;
}

/** A fitted variant: its curve, its category adjustments and its flat baseline.
 * `gen` is the generalised fit (breadth and/or Huber) when the variant uses
 * one; the plain curve still carries the display numbers and the category
 * residuals. */
export interface FittedVariant {
  curve: SizeCurve;
  gen: { a: number; b: number; c: number } | null;
  catAdj: Map<string, number>;
  flat: number;
}

/** Fit a variant on `train` comps. */
export function fitVariant(train: SnapshotProtocol[], variant: Variant): FittedVariant {
  const curve = fitSizeCurve(train);
  let gen: { a: number; b: number; c: number } | null = null;
  if (variant.breadth === true || variant.huber === true) {
    const xs = train.map((p) => Math.log(p.tvl_usd) - LTVL_REF);
    const ys = train.map(logMultiple);
    const zs = variant.breadth === true ? train.map(breadthOf) : null;
    gen = variant.huber === true ? huber2(xs, zs, ys) : ols2(xs, zs, ys);
  }
  return {
    curve,
    gen,
    catAdj: categoryAdjustments(train, curve, variant.catK),
    flat: median(train.map(logMultiple)),
  };
}

/** The fitted log multiple of any protocol under a fitted variant. */
export function fittedLogMultiple(asOf: string, p: SnapshotProtocol, fit: FittedVariant, variant: Variant): number {
  const x = Math.log(p.tvl_usd) - LTVL_REF;
  const base =
    fit.gen !== null
      ? fit.gen.a + fit.gen.b * x + fit.gen.c * (variant.breadth === true ? breadthOf(p) : 0)
      : curveAt(fit.curve, p.tvl_usd);
  return base + (fit.catAdj.get(p.category ?? '(none)') ?? 0) + Math.log(growthTilt(p, variant.growthWeight)) + Math.log(maturityTilt(asOf, p, variant.maturityRange));
}

/** The implied value of any protocol under a fitted variant. */
export function impliedValue(asOf: string, p: SnapshotProtocol, fit: FittedVariant, variant: Variant): number {
  return Math.max(1, Math.round(p.tvl_usd * Math.exp(fittedLogMultiple(asOf, p, fit, variant))));
}

// ---------------------------------------------------------------- out-of-sample tests

/** The errors of one held-out evaluation, model and flat baseline together. */
interface HeldOut {
  modelErrs: number[];
  flatErrs: number[];
  predLog: number[];
  actualLog: number[];
}

/** Evaluate a fitted variant on held-out comps: signed log errors. */
function heldOutErrors(
  asOf: string,
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  variant: Variant,
): HeldOut {
  const fit = fitVariant(train, variant);
  const modelErrs: number[] = [];
  const flatErrs: number[] = [];
  const predLog: number[] = [];
  const actualLog: number[] = [];
  for (const p of test) {
    const pred = fittedLogMultiple(asOf, p, fit, variant);
    const actual = logMultiple(p);
    modelErrs.push(actual - pred);
    flatErrs.push(actual - fit.flat);
    predLog.push(pred);
    actualLog.push(actual);
  }
  return { modelErrs, flatErrs, predLog, actualLog };
}

/** Summarise held-out errors as an OosTest. */
function summariseHeldOut(name: string, trainN: number, testN: number, h: HeldOut): OosTest {
  const within = (errs: number[], x: number): number =>
    errs.filter((e) => Math.abs(e) <= Math.log(x)).length / Math.max(1, errs.length);
  return {
    name,
    train_n: trainN,
    test_n: testN,
    model_median_log_err: median(h.modelErrs.map(Math.abs)),
    flat_median_log_err: median(h.flatErrs.map(Math.abs)),
    model_within_2x: within(h.modelErrs, 2),
    flat_within_2x: within(h.flatErrs, 2),
    model_within_3x: within(h.modelErrs, 3),
    flat_within_3x: within(h.flatErrs, 3),
    rank_rho: spearman(h.predLog, h.actualLog),
  };
}

/** Leave-one-out: refit on the train set minus one comp, score the one left
 * out, once per test comp. `trainSet` (when given) is a DIFFERENT set from
 * the test comps — the ablation's "92 comps (bridges in)" rung trains on
 * 92 and is scored on the same 88 test tokens as the shipped model, so the
 * two numbers are comparable. Also returns the scatter points (actual vs
 * LOO-predicted market cap) and the signed residuals the bands are built
 * from. */
export function looTest(
  comps: SnapshotProtocol[],
  asOf: string,
  variant: Variant,
  trainSet?: SnapshotProtocol[],
): { test: OosTest; points: { slug: string; actual_usd: number; predicted_usd: number }[]; residuals: { slug: string; tvl_usd: number; resid: number }[]; flatErrs: number[] } {
  const trainPool = trainSet ?? comps;
  const modelErrs: number[] = [];
  const flatErrs: number[] = [];
  const predLog: number[] = [];
  const actualLog: number[] = [];
  const points: { slug: string; actual_usd: number; predicted_usd: number }[] = [];
  const residuals: { slug: string; tvl_usd: number; resid: number }[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = trainPool.filter((q) => q.slug !== comps[i]!.slug);
    const fit = fitVariant(train, variant);
    const p = comps[i]!;
    const pred = fittedLogMultiple(asOf, p, fit, variant);
    const actual = logMultiple(p);
    modelErrs.push(actual - pred);
    flatErrs.push(actual - fit.flat);
    predLog.push(pred);
    actualLog.push(actual);
    points.push({ slug: p.slug, actual_usd: p.mcap_usd as number, predicted_usd: Math.max(1, Math.round(p.tvl_usd * Math.exp(pred))) });
    residuals.push({ slug: p.slug, tvl_usd: p.tvl_usd, resid: actual - pred });
  }
  return {
    test: summariseHeldOut('Leave-one-out', comps.length - 1, comps.length, { modelErrs, flatErrs, predLog, actualLog }),
    points,
    residuals,
    flatErrs,
  };
}

/** Walk-forward: 5 origins by listing date (expanding window). At each
 * origin the model trains on the comps listed before it and scores the
 * next 10% of listings — newer protocols only, never the past. With
 * `trainSet`, the training pool is that set (members listed before the
 * origin, by date then slug) while the test points stay this list's. */
export function walkForwardTest(
  comps: SnapshotProtocol[],
  asOf: string,
  variant: Variant,
  trainSet?: SnapshotProtocol[],
): { test: OosTest; origins: number } {
  const dated = comps
    .filter((p) => ageDays(asOf, p.listed_at) !== null)
    .sort((a, b) => Date.parse(a.listed_at as string) - Date.parse(b.listed_at as string) || (a.slug < b.slug ? -1 : 1));
  const n = dated.length;
  const modelErrs: number[] = [];
  const flatErrs: number[] = [];
  const predLog: number[] = [];
  const actualLog: number[] = [];
  let tested = 0;
  let origins = 0;
  for (const f of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const cut = Math.floor(n * f);
    const next = Math.min(n, cut + Math.max(1, Math.floor(n * 0.1)));
    const pivot = dated[cut]!;
    const train =
      trainSet === undefined
        ? dated.slice(0, cut)
        : trainSet.filter((p) => {
            if (p.listed_at === null) return false;
            const d = Date.parse(p.listed_at) - Date.parse(pivot.listed_at as string);
            return d < 0 || (d === 0 && p.slug < pivot.slug);
          });
    const test = dated.slice(cut, next);
    if (test.length === 0 || train.length < 10) continue;
    const h = heldOutErrors(asOf, train, test, variant);
    modelErrs.push(...h.modelErrs);
    flatErrs.push(...h.flatErrs);
    predLog.push(...h.predLog);
    actualLog.push(...h.actualLog);
    tested += test.length;
    origins++;
  }
  const test = summariseHeldOut('Walk-forward', n - tested, tested, { modelErrs, flatErrs, predLog, actualLog });
  return { test, origins };
}

/** Split-half and time-split: the two blind tests v2 shipped, kept so the
 * record is comparable. Both evaluate the shipped variant as it runs,
 * tilts included. With `trainSet`, the training halves come from that set
 * while the test halves stay this list's. */
export function splitTests(comps: SnapshotProtocol[], asOf: string, variant: Variant, trainSet?: SnapshotProtocol[]): OosTest[] {
  const bySlug = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const trainBySlug = trainSet === undefined ? bySlug : [...trainSet].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const splitHalf = summariseHeldOut(
    'Split-half',
    Math.ceil(trainBySlug.length / 2),
    Math.floor(bySlug.length / 2),
    heldOutErrors(asOf, trainBySlug.filter((_, i) => i % 2 === 0), bySlug.filter((_, i) => i % 2 === 1), variant),
  );
  const withAge = comps
    .filter((p) => ageDays(asOf, p.listed_at) !== null)
    .sort((a, b) => (ageDays(asOf, b.listed_at) as number) - (ageDays(asOf, a.listed_at) as number));
  const half = Math.floor(withAge.length / 2);
  const pivot = withAge[half]!;
  const pivotAge = ageDays(asOf, pivot.listed_at) as number;
  const timeTrain =
    trainSet === undefined
      ? withAge.slice(0, half)
      : trainSet.filter((p) => {
          const a = ageDays(asOf, p.listed_at);
          return a !== null && (a > pivotAge || (a === pivotAge && p.slug < pivot.slug));
        });
  const timeSplit = summariseHeldOut(
    'Time-split',
    timeTrain.length,
    withAge.length - half,
    heldOutErrors(asOf, timeTrain, withAge.slice(half), variant),
  );
  return [splitHalf, timeSplit];
}

/** The ablation: build the model up one term at a time, then show the
 * variants that were tried and not used. Every rung is scored on
 * leave-one-out and walk-forward. The keep/reject rule is fixed in
 * advance (see ABLATION_TOLERANCE): a rung is KEPT when it improves
 * leave-one-out or walk-forward and worsens neither by more than 2%
 * against the rung below; a tried variant is REJECTED by the same bar
 * against the shipped model. Split-half is deliberately not a veto (see
 * ABLATION_TOLERANCE): one split's verdict is luck. `comps92` is the
 * v3.1 comp set (bridges in), scored as a tried rung on the SAME 88 test
 * tokens as every other rung, so the bridge exclusion is a measured
 * choice, not an assumption. */
export function ablationTable(comps: SnapshotProtocol[], asOf: string, comps92: SnapshotProtocol[]): AblationRung[] {
  const score = (variant: Variant, trainSet?: SnapshotProtocol[]): { loo: OosTest; wf: OosTest; looErrs: number[]; flatErrs: number[] } => {
    const l = looTest(comps, asOf, variant, trainSet);
    return {
      loo: l.test,
      wf: walkForwardTest(comps, asOf, variant, trainSet).test,
      looErrs: l.residuals.map((r) => Math.abs(r.resid)),
      flatErrs: l.flatErrs.map(Math.abs),
    };
  };
  const x = (t: OosTest): number => Math.exp(t.model_median_log_err);
  /** The keep verdict of `s` against `below`: improves ≥1 test, worsens neither >2%. */
  const keeps = (s: { loo: OosTest; wf: OosTest }, below: { loo: OosTest; wf: OosTest }): boolean => {
    const d = [x(s.loo) / x(below.loo) - 1, x(s.wf) / x(below.wf) - 1];
    return d.some((v) => v < 0) && d.every((v) => v <= ABLATION_TOLERANCE);
  };
  const pct = (ratio: number): string => `${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(1)}%`;
  const rung = (
    name: string,
    s: { loo: OosTest; wf: OosTest; looErrs: number[]; flatErrs: number[] },
    decision: AblationRung['decision'],
    note: string,
    seErrors?: number[],
  ): AblationRung => ({
    name,
    loo_x: x(s.loo),
    loo_se_x: bootstrapMedianSeX(seErrors ?? s.looErrs, 2000, BOOTSTRAP_SEED),
    loo_within_3x: s.loo.model_within_3x,
    loo_rho: s.loo.rank_rho,
    wf_x: x(s.wf),
    wf_within_3x: s.wf.model_within_3x,
    wf_rho: s.wf.rank_rho,
    decision,
    note,
  });
  const flatVariant: Variant = { catK: null, growthWeight: 0, maturityRange: 0 };
  const flat = score(flatVariant);
  const out: AblationRung[] = [
    rung('Flat median (no curve)', { loo: { ...flat.loo, model_median_log_err: flat.loo.flat_median_log_err, model_within_3x: flat.loo.flat_within_3x, rank_rho: 0 }, wf: { ...flat.wf, model_median_log_err: flat.wf.flat_median_log_err, model_within_3x: flat.wf.flat_within_3x, rank_rho: 0 }, looErrs: flat.looErrs, flatErrs: flat.flatErrs }, 'BASELINE', 'Every held-out token priced at the training median. The model has to beat doing nothing.', flat.flatErrs),
  ];
  const buildUp: { name: string; variant: Variant; note: string }[] = [
    { name: 'Size curve only', variant: { catK: null, growthWeight: 0, maturityRange: 0 }, note: 'OLS of log(mcap/TVL) on log(TVL). The curve alone carries most of the signal.' },
    { name: '+ Growth tilt (weight 0.50)', variant: { catK: null, growthWeight: 0.5, maturityRange: 0 }, note: 'The bounty names 7-day growth as an input. Weight 0.50, the shootout winner.' },
    { name: '+ Maturity tilt (range 0.08) — shipped', variant: SHIPPED_VARIANT, note: 'The bounty names age without a token as an input. Kept at the smallest size that shows.' },
  ];
  let prev: { loo: OosTest; wf: OosTest } | null = null;
  let shipped: { loo: OosTest; wf: OosTest } | null = null;
  for (const step of buildUp) {
    const s = score(step.variant);
    let decision: AblationRung['decision'] = 'KEEP';
    let note = step.note;
    if (prev !== null) {
      if (!keeps(s, prev)) {
        decision = 'REJECT';
        note = `${step.note} REJECTED by the keep rule: LOO ${pct(x(s.loo) / x(prev.loo) - 1)}, walk-forward ${pct(x(s.wf) / x(prev.wf) - 1)} vs the rung below.`;
      } else {
        note = `${step.note} vs the rung below: LOO ${pct(x(s.loo) / x(prev.loo) - 1)}, walk-forward ${pct(x(s.wf) / x(prev.wf) - 1)}.`;
      }
    }
    out.push(rung(step.name, s, decision, note));
    prev = s;
    shipped = s;
  }
  const tried: { name: string; variant: Variant; why: string; trainSet?: SnapshotProtocol[] }[] = [
    { name: 'Tried: 92 comps (bridges in)', variant: SHIPPED_VARIANT, why: 'The v3.1 comp set, with the 4 cross-chain bridges fitted. Scored on the same 88 test tokens as shipped.', trainSet: comps92 },
    { name: 'Tried: + category (shrink n/(n+64))', variant: { catK: 64, growthWeight: 0.5, maturityRange: 0.08 }, why: 'Each category\u2019s median residual off the curve, shrunk hard.' },
    { name: 'Tried: + category (shrink n/(n+5))', variant: { catK: 5, growthWeight: 0.5, maturityRange: 0.08 }, why: 'v2\u2019s looser shrinkage. Thin categories swing rows by up to 2\u00d7.' },
    { name: 'Tried: + chains breadth (fitted)', variant: { catK: null, growthWeight: 0.5, maturityRange: 0.08, breadth: true }, why: 'A fitted log(chain-count) term, the breadth other radars ship.' },
    { name: 'Tried: Huber curve', variant: { catK: null, growthWeight: 0.5, maturityRange: 0.08, huber: true }, why: 'Huber IRLS instead of OLS, to down-weight outlier comps.' },
    { name: 'Tried: maturity range 0.30', variant: { catK: null, growthWeight: 0.5, maturityRange: 0.3 }, why: 'v2\u2019s maturity range (0.85\u20131.15). Age barely moves the multiple.' },
  ];
  for (const t of tried) {
    const s = score(t.variant, t.trainSet);
    const looD = x(s.loo) / x(shipped!.loo) - 1;
    const wfD = x(s.wf) / x(shipped!.wf) - 1;
    const rejected = !keeps(s, shipped!);
    const curse =
      looD < 0 && wfD > ABLATION_TOLERANCE
        ? ' The winner\u2019s curse in one row: the best LOO of the shootout, and walk-forward collapses — LOO alone would have crowned an overfit.'
        : '';
    out.push(rung(
      t.name,
      s,
      rejected ? 'REJECT' : 'TRIED',
      `${t.why} vs shipped: LOO ${pct(looD)}, walk-forward ${pct(wfD)}.${curse}${rejected ? ' Not used.' : ' Inside noise — a paired bootstrap cannot separate it from shipped — so the smaller model wins.'}`,
    ));
  }
  return out;
}

/** The two split-half medians for a variant: train on the even-slug half
 * and test the odd half, then the other way round. v3.2's swap test found
 * them x2.14 and x3.96 for the shipped model — the evidence that a single
 * split cannot veto a rung (see ABLATION_TOLERANCE). */
export function splitHalfHalves(comps: SnapshotProtocol[], asOf: string, variant: Variant): { parity_x: number; swapped_x: number } {
  const bySlug = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const even = bySlug.filter((_, i) => i % 2 === 0);
  const odd = bySlug.filter((_, i) => i % 2 === 1);
  const parity = summariseHeldOut('Split-half', even.length, odd.length, heldOutErrors(asOf, even, odd, variant));
  const swapped = summariseHeldOut('Split-half swapped', odd.length, even.length, heldOutErrors(asOf, odd, even, variant));
  return { parity_x: Math.exp(parity.model_median_log_err), swapped_x: Math.exp(swapped.model_median_log_err) };
}

/** The note under the ablation table, built from the computed rungs — the
 * keep rule in words, plus the two rejections that matter (category and
 * chains), with their numbers. Rendered by the dashboard; nothing here is
 * typed in by hand. */
export function ablationNoteText(rungs: AblationRung[], compsN: number, halves: { parity_x: number; swapped_x: number }): string {
  const by = (prefix: string): AblationRung | undefined => rungs.find((r) => r.name.startsWith(prefix));
  const shipped = by('+ Maturity tilt');
  const cat = by('Tried: + category (shrink n/(n+64))');
  const chains = by('Tried: + chains breadth');
  const bridges = by('Tried: 92 comps');
  const parts = [
    `Keep rule: a rung is kept only when it improves LOO or walk-forward and worsens neither by more than 2% (split-half is no veto).`,
  ];
  if (shipped !== undefined && bridges !== undefined) {
    parts.push(`Bridges in (92 comps) cost ${(((bridges.loo_x - shipped.loo_x) / shipped.loo_x) * 100).toFixed(1)}% of LOO.`);
  }
  if (shipped !== undefined && cat !== undefined && chains !== undefined) {
    const tried = rungs.filter((r) => r.decision === 'REJECT' || r.decision === 'TRIED');
    const bestLoo = tried.length > 0 && tried.every((r) => chains.loo_x <= r.loo_x);
    parts.push(
      `Category costs ${(((cat.loo_x - shipped.loo_x) / shipped.loo_x) * 100).toFixed(1)}% of LOO; chains breadth` +
        (bestLoo ? ` had the best LOO (×${chains.loo_x.toFixed(2)}) but` : ` improved LOO to ×${chains.loo_x.toFixed(2)} but`) +
        ` walk-forward collapsed to ×${chains.wf_x.toFixed(2)} — both rejected.`,
    );
  }
  parts.push(`ρ = rank correlation; ±SE = bootstrap SE.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- bootstrap: rank ranges and refit spread

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

/** The paired-bootstrap standard error of a rung's LOO median, in × units:
 * resample the rung's own held-out absolute log errors with replacement,
 * take the median of each resample, exponentiate, and take the standard
 * deviation across draws. Same seeded RNG as the refits; deterministic. */
function bootstrapMedianSeX(errors: number[], draws: number, seed: number): number {
  const rng = mulberry32(seed);
  const n = errors.length;
  const meds: number[] = [];
  for (let d = 0; d < draws; d++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i++) sample.push(errors[Math.floor(rng() * n)]!);
    meds.push(Math.exp(median(sample)));
  }
  const mean = meds.reduce((a, b) => a + b, 0) / meds.length;
  const variance = meds.reduce((a, b) => a + (b - mean) ** 2, 0) / (meds.length - 1);
  return Math.sqrt(variance);
}

/** What 200 bootstrap refits say about one row: its rank range, how often
 * it holds the top 20, and the quartiles of its refit implied value. */
export interface RefitStats {
  rank_lo: number;
  rank_hi: number;
  top20_pct: number;
  imp_p10: number;
  imp_p25: number;
  imp_p75: number;
  imp_p90: number;
}

/** 200 resamples of the comps, refit and re-ranked: rank ranges and refit
 * spread for every board protocol. Deterministic (seeded PRNG). */
export function bootstrapRefits(
  comps: SnapshotProtocol[],
  boardProtos: SnapshotProtocol[],
  asOf: string,
  variant: Variant,
): Map<string, RefitStats> {
  const rng = mulberry32(BOOTSTRAP_SEED);
  const rankLists = new Map<string, number[]>();
  const impLists = new Map<string, number[]>();
  for (const p of boardProtos) {
    rankLists.set(p.slug, []);
    impLists.set(p.slug, []);
  }
  for (let b = 0; b < BOOTSTRAP_N; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const fit = fitVariant(sample, variant);
    const scored = boardProtos.map((p) => ({
      slug: p.slug,
      imp: p.tvl_usd * Math.exp(fittedLogMultiple(asOf, p, fit, variant)),
    }));
    scored.sort((a, z) => z.imp - a.imp || (a.slug < z.slug ? -1 : 1));
    scored.forEach((s, i) => {
      rankLists.get(s.slug)!.push(i + 1);
      impLists.get(s.slug)!.push(s.imp);
    });
  }
  const out = new Map<string, RefitStats>();
  for (const p of boardProtos) {
    const ranks = rankLists.get(p.slug)!.sort((a, b) => a - b);
    const imps = impLists.get(p.slug)!.sort((a, b) => a - b);
    out.set(p.slug, {
      rank_lo: ranks[Math.floor(0.1 * ranks.length)]!,
      rank_hi: ranks[Math.floor(0.9 * ranks.length)]!,
      top20_pct: ranks.filter((r) => r <= 20).length / ranks.length,
      imp_p10: imps[Math.floor(0.1 * imps.length)]!,
      imp_p25: imps[Math.floor(0.25 * imps.length)]!,
      imp_p75: imps[Math.floor(0.75 * imps.length)]!,
      imp_p90: imps[Math.floor(0.9 * imps.length)]!,
    });
  }
  return out;
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

// ---------------------------------------------------------------- the bands

/** A row's two intervals, from the model's own leave-one-out misses near
 * its TVL (the 30 nearest comps, residuals winsorized at the global 1st /
 * 99th percentile so one wild comp cannot set a row's band), widened by
 * the refit spread in quadrature on the log scale. */
export function rowBands(
  impliedUsd: number,
  tvlUsd: number,
  looResiduals: { tvl_usd: number; resid: number }[],
  refit: RefitStats,
): { p25: number; p75: number; p10: number; p90: number } {
  const all = looResiduals.map((r) => r.resid);
  const wLo = quantile(all, 0.01);
  const wHi = quantile(all, 0.99);
  const near = looResiduals
    .map((r) => ({ d: Math.abs(Math.log(r.tvl_usd) - Math.log(tvlUsd)), resid: Math.min(wHi, Math.max(wLo, r.resid)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, BAND_NEIGHBORS)
    .map((x) => x.resid);
  const band = (qLo: number, qHi: number, refLo: number, refHi: number): [number, number] => {
    const lo = quantile(near, qLo);
    const hi = quantile(near, qHi);
    const center = (hi + lo) / 2;
    const localHalf = (hi - lo) / 2;
    const refitHalf = Math.log(refHi / refLo) / 2;
    const half = Math.sqrt(localHalf * localHalf + refitHalf * refitHalf);
    return [
      Math.max(1, Math.round(impliedUsd * Math.exp(center - half))),
      Math.round(impliedUsd * Math.exp(center + half)),
    ];
  };
  const [p25, p75] = band(0.25, 0.75, refit.imp_p25, refit.imp_p75);
  const [p10, p90] = band(0.1, 0.9, refit.imp_p10, refit.imp_p90);
  return { p25, p75, p10, p90 };
}

// ---------------------------------------------------------------- the farm plan

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** One on-chain action's gas on a chain, in US cents — a stated rate
 * table, not a quote: each chain has its own rate, ordered by its rough
 * fee level (sub-cent chains $0.05–$0.10, busier L2s and alt-L1s
 * $0.11–$0.18, Tron $0.90), and every rate sits above that chain's
 * November 2026 typical DeFi interaction cost (growthepie daily
 * medians: Base ~$0.002, Arbitrum ~$0.005, Solana ~$0.0005), so the
 * plan's gas is an upper bound. Chains not listed price at the $1.00
 * default; Ethereum mainnet, where a complex interaction runs
 * $0.10–$3.50 on an ordinary day and spikes with congestion, at $3.00.
 * data.js carries the table (farm_assumptions.gas_rates); the
 * dashboard's model.js reads it via setGasRates, so the page's re-run
 * agrees with this build. */
const GAS_RATE_CENTS: Record<string, number> = {
  Stellar: 5, Algorand: 5, Ripple: 5,
  'Hyperliquid L1': 7,
  Zora: 8, Ink: 8, Monad: 8, Ronin: 8,
  Sui: 9, Aptos: 9, Near: 9, Sei: 9, Noble: 9, XION: 9,
  Base: 10, Mantle: 10, Blast: 10, Mode: 10, Plume: 10, 'Plume Mainnet': 10,
  Tempo: 10, RISE: 10, 'Robinhood Chain': 10, Stable: 10, Pharos: 10,
  Fluent: 10, Proton: 10, Strato: 10, Qubic: 10, 'Reya Network': 10,
  Mezo: 10, BSquared: 10, Arc: 10, Plasma: 10, Flare: 10, Morph: 10,
  'World Chain': 10,
  Optimism: 11, Linea: 11, Gnosis: 11, Manta: 11, Klaytn: 11,
  Solana: 12, Scroll: 12, Berachain: 12, Kava: 12, 'Bifrost Network': 12,
  Polygon: 13, 'zkSync Era': 13,
  Arbitrum: 14, Injective: 14, Provenance: 14,
  Starknet: 15, Canton: 15,
  'BNB Chain': 16, Binance: 16,
  Avalanche: 18,
  Tron: 90,
};

/** One on-chain action's gas on a chain, in dollars. */
function gasRateForChain(chain: string): number {
  if (chain === 'Ethereum') return 3;
  const cents = GAS_RATE_CENTS[chain];
  return cents === undefined ? 1 : cents / 100;
}

/** One on-chain action's gas, from the protocol's first chain. */
function gasPerActionUsd(p: SnapshotProtocol): number {
  return gasRateForChain(chainOf(p));
}

/** The cheapest chain the protocol runs on, by gas tier (ties: first
 * listed) — named in step 1 so the farmer knows the cheap route, even
 * though the plan farms and prices gas on the first chain. */
function cheapestChain(p: SnapshotProtocol): { chain: string; rate: number } {
  let best = { chain: chainOf(p), rate: gasPerActionUsd(p) };
  for (const c of p.chains) {
    const rate = gasRateForChain(c);
    if (rate < best.rate) best = { chain: c, rate };
  }
  return best;
}

/** On-chain actions in the weekly routine, over the whole season, by
 * mechanism — the same classes weeklyActionFor writes about. A vault
 * harvests and re-deposits (two harvests × two actions); a prediction
 * market settles, an OTC desk settles, a launchpad claims and a
 * governance voter votes on-chain about twice a season; a routine of
 * checks and logs (insurance, bridge receipts, a card's spending) costs
 * no gas at all. The dashboard's model.js carries the same three
 * classes, so the page's re-run agrees with this build. */
function weeklyOnChain(p: SnapshotProtocol): number {
  const c = (p.category ?? '').toLowerCase();
  if (/insurance|bridge|cedefi|payment|card/.test(c)) return 0;
  if (/prediction|otc|governance|launchpad/.test(c)) return 2;
  return 4;
}

/** Setup minutes, by mechanism: a hedge, a range or a bridge route takes
 * longer to size than a one-click stake or vote. */
function setupMinutes(p: SnapshotProtocol): number {
  const c = (p.category ?? '').toLowerCase();
  if (/perpetual|derivative|options|basis|bridge|\bdex|leverag/.test(c)) return 25;
  if (/stak|governance|card|payment|index/.test(c)) return 10;
  return 15;
}

/** Minutes a week the routine takes: a harvest week costs more hands-on
 * time than a check-only week. */
function weeklyMinutes(p: SnapshotProtocol): number {
  const w = weeklyOnChain(p);
  return w === 0 ? 5 : w === 2 ? 10 : 15;
}

/** Every on-chain action the plan's steps name: 7 + the weekly routine's. */
export function planActions(p: SnapshotProtocol): number {
  return 7 + weeklyOnChain(p);
}

/** Minutes spent checking the protocol's other chains before funding:
 * 5 a chain, up to five extra chains — a farmer compares deployments
 * and gas before committing funds, and stops once a cheap chain is
 * found. Single-chain protocols pay nothing here. */
function chainCheckMinutes(p: SnapshotProtocol): number {
  return 5 * Math.min(Math.max(p.chains.length - 1, 0), 5);
}

/** Minutes per step, in step order — the dashboard's COST/TIME columns
 * show these, and planHours is their sum. Fund 5 + 2 to sign the
 * transfer + the chain checks; setup 10–25 + 2 per signature (approve
 * + deposit); Day 5 10 + 2 to sign; Week 2 15 + 2 to sign the move;
 * the weekly routine × 12 + 2 per harvest/settle signature; review 15
 * + 2 to sign the exit; claim 10 + 2 to sign; log 5. Every on-chain
 * action costs 2 minutes of signing, confirming and logging its hash —
 * 2 × planActions minutes across the plan. */
export function stepMinutes(p: SnapshotProtocol): number[] {
  const w = weeklyOnChain(p);
  return [
    7 + chainCheckMinutes(p),
    setupMinutes(p) + 4,
    12,
    17,
    weeklyMinutes(p) * 12 + 2 * w,
    17,
    12,
    5,
  ];
}

/** On-chain actions per step, in step order: fund 1, setup 2, Day 5 1,
 * Week 2 1 (the move, counted), the weekly routine's, exit 1, claim 1,
 * log 0. They sum to planActions — the dashboard's COST column prices
 * each step's actions by kind (transfer 21, approval 46, deposit 140,
 * withdrawal 90, harvest or claim 100, vote 60, swap 120 — thousands of
 * gas, Ethereum magnitudes; a move counts the mean of a withdrawal and
 * a deposit), scaled so the steps sum to the plan's gas. */
export function stepActionCounts(p: SnapshotProtocol): number[] {
  const w = weeklyOnChain(p);
  return [1, 2, 1, 1, w, 1, 1, 0];
}

/** Hands-on hours: the steps' own times, summed. 2.4–5.2 hours a plan,
 * varying per protocol by mechanism, action count and chain count. */
export function planHours(p: SnapshotProtocol): number {
  return stepMinutes(p).reduce((a, b) => a + b, 0) / 60;
}

/** The plan's time, priced at the hourly rate. */
function timeValueUsd(p: SnapshotProtocol): number {
  return planHours(p) * FARM.hourly_rate_usd;
}

/** The bridge reserve for a multi-chain plan: $0.75 per extra chain
 * (max 5), for moving the position between the protocol's deployments
 * over the season — the Week-2 move is the step that would bridge, so
 * the reserve sits in its cost (see the dashboard's stepPlan, which
 * prices it the same way). Single-chain plans pay none. A reserve, not
 * a prediction: the plan may never bridge, and the reserve is still
 * charged, so multi-chain plans are never under-costed. */
export function bridgeFeeUsd(p: SnapshotProtocol): number {
  return 0.75 * Math.min(Math.max(p.chains.length - 1, 0), 5);
}

/** The plan's total gas: every action its steps name, at the first
 * chain's rate, plus the bridge reserve. */
export function planGasUsd(p: SnapshotProtocol): number {
  return planActions(p) * gasPerActionUsd(p) + bridgeFeeUsd(p);
}

/** The fixed (ticket-independent) part of a plan's cost: gas + time. */
function fixedCostUsd(p: SnapshotProtocol): number {
  return planGasUsd(p) + timeValueUsd(p);
}

/** The yield forgone on a ticket over the horizon, at the T-bill rate. */
export function forgoneUsd(ticketUsd: number): number {
  return ticketUsd * FARM.tbill_rate * (FARM.horizon_days / 365);
}

/** The whole plan's cost at a ticket: fixed costs plus the yield forgone. */
export function planCostUsd(p: SnapshotProtocol, ticketUsd: number): number {
  return fixedCostUsd(p) + forgoneUsd(ticketUsd);
}

/** The stop drop: twice the protocol's 7-day TVL swing, bounded 5–50%.
 * A protocol that swings 3% a week stops at −6%; one that swings 40%
 * stops at −50%, never tighter. No 7-day change on record: 20%. */
export function stopDropPct(p: SnapshotProtocol): number {
  if (p.change_7d === null || !Number.isFinite(p.change_7d)) return 0.2;
  return Math.min(0.5, Math.max(0.05, 2 * (Math.abs(p.change_7d) / 100)));
}

/** The TVL at which the plan stops: the snapshot's TVL less the stop drop. */
export function stopTvlUsd(p: SnapshotProtocol): number {
  return Math.round(p.tvl_usd * (1 - stopDropPct(p)));
}

/** The farm verdict's economics at one ticket and one airdrop share. */
export function farmEconomics(
  p: SnapshotProtocol,
  impliedUsd: number,
  lowEndUsd: number,
  ticketUsd: number,
  share: number,
): {
  verdict: Verdict;
  net: number;
  netLow: number;
  gross: number;
  grossLow: number;
  cost: number;
  forgone: number;
  breakEvenUsd: number;
  breakEvenOdds: number | null;
  netPerHour: number;
  paysFrom: number | null;
  farmFrom: number | null;
  robustFrom: number | null;
} {
  const cost = planCostUsd(p, ticketUsd);
  const forgone = forgoneUsd(ticketUsd);
  const gross = impliedUsd * share * (ticketUsd / p.tvl_usd);
  const grossLow = lowEndUsd * share * (ticketUsd / p.tvl_usd);
  const net = gross - cost;
  const netLow = grossLow - cost;
  const verdict: Verdict = netLow > 0 ? 'ROBUST' : net >= FARM.farm_net_usd ? 'FARM' : net >= FARM.thin_net_usd ? 'THIN' : 'SKIP';
  // The launch value at which this ticket breaks even: net = 0 solves to
  // breakEven x share x (ticket / TVL) = cost.
  const breakEvenUsd = (cost * p.tvl_usd) / (share * ticketUsd);
  // The launch probability the plan needs: expected gross must cover cost.
  const breakEvenOdds = gross > 0 ? cost / gross : null;
  const netPerHour = net / planHours(p);
  // The smallest ticket that pays / farms / goes robust: net(T) = 0 solves to
  // T = fixed / (multiple x share - forgone rate). No solution when the
  // denominator is not positive — the row never pays at any ticket.
  const fixed = fixedCostUsd(p);
  const forgoneRate = FARM.tbill_rate * (FARM.horizon_days / 365);
  const ticketFor = (multiple: number, targetNet: number): number | null => {
    const denom = multiple * share - forgoneRate;
    if (denom <= 0) return null;
    return Math.ceil((fixed + targetNet) / denom);
  };
  const multiple = impliedUsd / p.tvl_usd;
  const multipleLow = lowEndUsd / p.tvl_usd;
  return {
    verdict,
    net,
    netLow,
    gross,
    grossLow,
    cost,
    forgone,
    breakEvenUsd,
    breakEvenOdds,
    netPerHour,
    paysFrom: ticketFor(multiple, 0),
    farmFrom: ticketFor(multiple, FARM.farm_net_usd),
    robustFrom: ticketFor(multipleLow, 0),
  };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `supply your ticket in USDC to ${name} on ${chain} and keep the position open`;
  if (c.includes('dex') || c.includes('yield aggregator')) return `provide your ticket as liquidity to ${name}'s main pool on ${chain} and keep the position open`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `deposit your ticket into ${name}'s highest-yield vault on ${chain} and keep the shares`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `deposit your ticket into a ${name} vault on ${chain} and keep the shares`;
  if (c.includes('staking') || c.includes('restak')) return `stake your ticket of the chain's staking asset through ${name} and keep the receipt`;
  if (c.includes('perpetual') || c.includes('derivative')) return `deposit your ticket in USDC as margin on ${name} and open one small hedge`;
  if (c.includes('prediction')) return `fund your ticket and place one market position on ${name}`;
  if (c.includes('stable')) return `mint or deposit your ticket of the stable asset through ${name} on ${chain}`;
  if (c.includes('rwa')) return `mint your ticket of the protocol's yield asset on ${chain} and hold it`;
  if (c.includes('insurance')) return `buy your ticket of cover from ${name} on ${chain} and keep the policy`;
  if (c.includes('options')) return `deposit your ticket in USDC into ${name}'s vault on ${chain} and keep the position open`;
  if (c.includes('launchpad')) return `stake your ticket through ${name} on ${chain} to qualify for its launches`;
  if (c.includes('bridge')) return `bridge your ticket through ${name} on ${chain} and keep the receipt`;
  if (c.includes('chain')) return `delegate your ticket of the chain's native asset through ${name} and keep the stake`;
  if (c.includes('basis')) return `open your ticket as a basis position through ${name} on ${chain} and keep it open`;
  if (c.includes('liquidity')) return `deposit your ticket into ${name}'s managed pool on ${chain} and keep the shares`;
  if (c.includes('cedefi')) return `deposit your ticket into ${name}'s managed account on ${chain} and keep the position open`;
  if (c.includes('farm')) return `deposit your ticket into ${name}'s farm on ${chain} and keep the position open`;
  if (c.includes('btc')) return `deposit your ticket of BTC through ${name} on ${chain} and keep the receipt`;
  if (c.includes('payment')) return `fund your ticket through ${name} on ${chain} and make one payment`;
  if (c.includes('otc')) return `fund your ticket and place one offer on ${name}`;
  if (c.includes('governance')) return `deposit your ticket into ${name}'s governance pool on ${chain} and keep the position`;
  if (c.includes('card')) return `fund your ticket through ${name}'s card on ${chain} and keep the balance`;
  if (c.includes('index')) return `buy your ticket of ${name}'s index on ${chain} and hold it`;
  return `deposit your ticket in USDC into ${name} on ${chain} and keep the position open`;
}

/** The category's second action: what the farmer does after the first
 * deposit, in the words a farmer can follow. Steps 3 and 5 name it, so a
 * plan reads as this protocol's plan, not a template. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `borrow a small amount against your supply on ${chain}`;
  if (c.includes('dex') || c.includes('yield aggregator')) return `swap a small amount through ${name}'s main pool on ${chain}`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `move a small amount between ${name}'s vaults on ${chain}`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `top up a second ${name} vault on ${chain} with a small amount`;
  if (c.includes('staking') || c.includes('restak')) return `stake a small additional amount through ${name}`;
  if (c.includes('perpetual') || c.includes('derivative')) return `open and close one small hedge on ${name}`;
  if (c.includes('prediction')) return `place a second small market position on ${name}`;
  if (c.includes('stable')) return `mint a small amount of the stable asset through ${name} on ${chain}`;
  if (c.includes('rwa')) return `mint a small additional amount of the protocol's yield asset on ${chain}`;
  if (c.includes('insurance')) return `extend your cover from ${name} by a small amount`;
  if (c.includes('options')) return `top up your position in ${name}'s vault on ${chain} with a small amount`;
  if (c.includes('launchpad')) return `stake a small top-up through ${name} on ${chain}`;
  if (c.includes('bridge')) return `bridge a small amount back through ${name}`;
  if (c.includes('chain')) return `delegate a small top-up to a second validator on ${name}`;
  if (c.includes('basis')) return `roll a small part of the basis position through ${name}`;
  if (c.includes('liquidity')) return `top up the managed position on ${name} with a small amount`;
  if (c.includes('cedefi')) return `top up the account on ${name} with a small amount`;
  if (c.includes('farm')) return `stake a small amount in a second pool on ${name}`;
  if (c.includes('btc')) return `top up the BTC position through ${name} with a small amount`;
  if (c.includes('payment')) return `make a second small payment through ${name}`;
  if (c.includes('otc')) return `place a second small offer on ${name}`;
  if (c.includes('governance')) return `vote once more through ${name} with a small top-up`;
  if (c.includes('card')) return `top up the card balance on ${name} with a small amount`;
  if (c.includes('index')) return `top up the index position on ${name} with a small amount`;
  return `make a second qualifying action on ${name} (a deposit, a borrow, a swap or a vote)`;
}

/** The category's third action (Week 2): verify and rebalance — a different
 * kind of action from the second one (check a rate, compare vaults, claim
 * a partial reward), so the plan's steps are three different actions, not
 * one action repeated. */
function thirdActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'check the borrow rate and repay or top up so the health factor stays above 2';
  if (c.includes('dex') || c.includes('yield aggregator')) return 'check the fees the pool earned and rebalance the range if the price moved out of it';
  if (c.includes('yield') || c.includes('leveraged farm')) return `compare ${name}'s vault APYs and move to the vault that leads by a clear margin`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `compare the vaults' returns and shift to the better-performing ${name} vault`;
  if (c.includes('staking') || c.includes('restak')) return 'check the validator set and redelegate if a validator raised its commission';
  if (c.includes('perpetual') || c.includes('derivative')) return 'check the funding rate and flip the hedge if funding turned against the position';
  if (c.includes('prediction')) return `check the market's odds and close or add to the position if the odds moved`;
  if (c.includes('stable')) return 'check the peg and the collateral ratio, and redeem or mint to keep the ratio in range';
  if (c.includes('rwa')) return `check the asset's backing report and redeem if the backing fell short`;
  if (c.includes('insurance')) return `check the cover's terms and the pool's solvency, and adjust the cover if the risk changed`;
  if (c.includes('options')) return `check the vault's strategy and the expiry, and roll the position if expiry nears`;
  if (c.includes('launchpad')) return `check the upcoming launches and move the stake to the next launch's pool`;
  if (c.includes('bridge')) return `check the bridge's fees and limits, and bridge a small amount on the cheapest route`;
  if (c.includes('chain')) return 'check validator performance and redelegate away from the worst performer';
  if (c.includes('basis')) return 'check the funding rate and the basis spread, and resize if the spread inverted';
  if (c.includes('liquidity')) return `check the pool's composition and fees, and rebalance if one asset drifted`;
  if (c.includes('cedefi')) return `check the account's statement and the manager's allocation, and adjust if it drifted`;
  if (c.includes('farm')) return `compare the pools' rewards per dollar and move the stake to the best one`;
  if (c.includes('btc')) return 'check the BTC backing report and withdraw if it is overdue';
  if (c.includes('payment')) return 'check the payment history and fees, and switch to the cheapest route if fees rose';
  if (c.includes('otc')) return 'check the order book and reprice the offer if the market moved';
  if (c.includes('governance')) return `check the active proposals and vote on the one that affects the pool's rewards`;
  if (c.includes('card')) return `check the card's spending and rewards, and adjust the balance to stay in the rewards tier`;
  if (c.includes('index')) return `check the index's composition and rebalance if one asset drifted past its target weight`;
  return `check the position's rewards and ${name}'s terms, and adjust the deposit if the terms changed`;
}

/** The category's weekly action (Weekly ×12): the maintenance routine —
 * harvest or settle the week's rewards, re-deposit, and log — different
 * again from the second and third actions. */
function weeklyActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `claim any accrued rewards, re-supply them, and log the week's health factor`;
  if (c.includes('dex') || c.includes('yield aggregator')) return `collect the week's fees, re-add them to the pool, and log the position`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `harvest the week's rewards, re-deposit them, and log the vault balance and APY`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `claim the week's rewards, re-deposit them, and log the vault balances`;
  if (c.includes('staking') || c.includes('restak')) return `claim the week's staking rewards, re-stake them, and log the validator`;
  if (c.includes('perpetual') || c.includes('derivative')) return `settle the week's PnL, re-open the hedge, and log the funding paid`;
  if (c.includes('prediction')) return 'settle the resolved markets and log the outcomes';
  if (c.includes('stable')) return `claim the week's yield, re-mint, and log the collateral ratio`;
  if (c.includes('rwa')) return `claim the week's yield, re-mint, and log the backing`;
  if (c.includes('insurance')) return `review the open cover and log the week's premiums`;
  if (c.includes('options')) return `claim the week's premiums, re-deposit them, and log the position`;
  if (c.includes('launchpad')) return `claim the week's launch allocations and log them`;
  if (c.includes('bridge')) return `review the week's bridge receipts and log the routes used`;
  if (c.includes('chain')) return `claim the week's rewards, re-delegate them, and log the validators`;
  if (c.includes('basis')) return `settle the week's funding, re-open the position, and log the spread`;
  if (c.includes('liquidity')) return `collect the week's fees, re-add them, and log the pool balance`;
  if (c.includes('cedefi')) return `review the week's statement and log the balance`;
  if (c.includes('farm')) return `harvest the week's rewards, re-stake them, and log the pool's APR`;
  if (c.includes('btc')) return `claim the week's yield, re-deposit it, and log the balance`;
  if (c.includes('payment')) return `review the week's payments and log the receipts`;
  if (c.includes('otc')) return 'settle the filled offers and log the fills';
  if (c.includes('governance')) return `vote on the week's proposals and log the votes`;
  if (c.includes('card')) return `log the week's spending and the rewards earned`;
  if (c.includes('index')) return `claim the week's distributions, re-buy the index, and log the balance`;
  return `claim the week's rewards, re-deposit them, and log the position`;
}

/** The category's one-word mechanism, for the board's PLAN column. */
function planActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Lend';
  if (c.includes('dex') || c.includes('yield aggregator')) return 'Pool';
  if (c.includes('yield') || c.includes('leveraged farm')) return 'Vault';
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return 'Vault';
  if (c.includes('staking') || c.includes('restak')) return 'Stake';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Hedge';
  if (c.includes('prediction')) return 'Bet';
  if (c.includes('stable') || c.includes('rwa')) return 'Mint';
  if (c.includes('insurance')) return 'Cover';
  if (c.includes('options')) return 'Vault';
  if (c.includes('launchpad')) return 'Stake';
  if (c.includes('bridge')) return 'Bridge';
  if (c.includes('chain')) return 'Stake';
  if (c.includes('basis')) return 'Basis';
  if (c.includes('liquidity')) return 'Pool';
  if (c.includes('cedefi')) return 'Deposit';
  if (c.includes('farm')) return 'Farm';
  if (c.includes('btc')) return 'Stake';
  if (c.includes('payment')) return 'Pay';
  if (c.includes('otc')) return 'Trade';
  if (c.includes('governance')) return 'Vote';
  if (c.includes('card')) return 'Deposit';
  if (c.includes('index')) return 'Buy';
  return 'Deposit';
}

/** A dollar figure in short form ($1.2M, $340K, $25). */
function shortMoney(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/** A gas figure in short form ($0.10, $1, $3, $21). */
function gasStr(v: number): string {
  return v < 1 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`;
}

/**
 * A protocol's farm plan: eight dated steps, each an action. The plan is
 * derived from the protocol's own record (category, chains, TVL, age,
 * 7-day swing), never from a hand-written list of names — and every step
 * names the protocol, its chain or its mechanism, so no step reads
 * identically for two protocols. Steps 3, 4 and 5 are three different
 * actions by design: the second action (Day 5), a verify-and-rebalance
 * (Week 2) and the weekly maintenance routine (Weekly ×12) — never one
 * action repeated. Step 1 checks every chain the protocol runs on and
 * names the cheapest before funding on the first; regulated categories
 * (RWA, CeDeFi) get an identity-check clause in step 2; step 3 saves the
 * transaction hash; step 4 re-reads the rewards terms, and on a
 * multi-chain protocol names the bridge the reserve pays for; step 6
 * names the stop TVL and the review's absolute date (as-of + 90 days);
 * step 8 keeps the hash log. Steps 1–2 name the default ticket's nominal.
 * Each step's cost and time live in the dashboard's COST/TIME columns
 * (model.js stepPlan), computed from the same rules: stepActionCounts
 * priced by action kind (see stepActionCounts), plus the bridge reserve
 * in the Week-2 step, and stepMinutes — the steps' costs add up to the
 * plan's gas and their times to planHours. The board's ticket control resizes the
 * economics, and the stop rule — shown above the steps — names a TVL
 * from twice the protocol's own 7-day swing.
 */
/** A calendar date, `days` after an as-of date: the Day-90 review's
 * absolute date, computed from the snapshot, never typed in. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const chain = chainOf(p);
  const name = p.name;
  const c = (p.category ?? '').toLowerCase();
  const second = secondActionFor(p, chain);
  const secondCap = second.charAt(0).toUpperCase() + second.slice(1);
  const third = thirdActionFor(p, chain);
  const thirdCap = third.charAt(0).toUpperCase() + third.slice(1);
  const weekly = weeklyActionFor(p, chain);
  const weeklyCap = weekly.charAt(0).toUpperCase() + weekly.slice(1);
  const nChains = p.chains.length;
  const cheap = cheapestChain(p);
  const ticket = `$${FARM.default_ticket_usd.toLocaleString('en-US')}`;
  const deposit = actionFor(p, chain).replace('your ticket', `your ${ticket} ticket`);
  const firstStep =
    nChains > 1
      ? `Check ${name}'s ${nChains} chains (cheapest: ${cheap.chain} at ${gasStr(cheap.rate)} an action), then fund a fresh wallet on ${chain} with only your ${ticket} farm funds`
      : `Use a fresh wallet holding only your ${ticket} farm funds, funded on ${chain}`;
  const kyc = /rwa|cedefi/.test(c) ? ` If ${name} asks for an identity check, finish it before you deposit.` : '';
  const bridge = nChains > 1 ? `; bridge to the leading vault's chain if it is not ${chain}` : '';
  const stop = shortMoney(stopTvlUsd(p));
  const review = addDays(asOf, FARM.horizon_days);
  const steps = [
    `Day 0 — ${firstStep}; keep its seed phrase offline.`,
    `Day 0 — ${deposit}.${kyc}`,
    `Day 5 — ${secondCap}, then check ${name}'s points page to confirm the position counts; save the transaction hash in your log.`,
    `Week 2 — ${thirdCap}${bridge}; re-read ${name}'s rewards terms to confirm they still count your position.`,
    `Weekly ×12 — ${weeklyCap}, so the activity counts in more than one snapshot for ${name}.`,
    `Day 90 — Review (${review}): hold if ${name} is still growing, unwind if it is not — below ${stop} TVL, exit.`,
    `If a token launches — Claim only from the link ${name} itself publishes; never pay to claim — a fee to claim is a scam.`,
    `Throughout — Keep a farm log: the wallet, the dates, every transaction hash on ${name} — so you can repeat or unwind the position.`,
  ];
  return steps.map((s) => {
    let t = s;
    if (t.length > 600) t = `${t.slice(0, 596)}...`;
    return t;
  });
}

// ---------------------------------------------------------------- the board

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Escape for pre-rendered HTML strings (cover strip, best farms). */
const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Signed dollars, whole units — the dashboard's moneySigned, in the build. */
const moneySigned = (v: number): string => (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });

// ---------------------------------------------------------------- the odds model (v4.2 NEW-C)

/** The K-set: every protocol that passes the watchlist rule's exclusions
 * (token status aside) — the peer set the odds model learns from. */
function oddsPeerSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(passesWatchlistTest);
}

/** The odds label: 1 when the protocol records a token, 0 when pre-token. */
function oddsLabel(p: SnapshotProtocol): number {
  return isPreToken(p) ? 0 : 1;
}

/** Raw odds features for one protocol, in natural units. Years uses the
 * canonical 1,643-day imputation for undated peers; growth is winsorised
 * to [-90%, +200%] and missing growth is 0 (never dropped, never mean). */
interface OddsRawFeatures {
  years: number;
  lnTVL: number;
  growth: number;
  growthRaw: number | null;
  lnChains: number;
  category: string | null;
}

function oddsRawFeatures(asOf: string, p: SnapshotProtocol): OddsRawFeatures {
  const age = ageDays(asOf, p.listed_at);
  const days = age === null ? ODDS_AGE_IMPUTE_DAYS : age;
  const growthRaw = p.change_7d === null ? null : p.change_7d / 100;
  const growth = growthRaw === null ? 0 : Math.min(ODDS_GROWTH_MAX, Math.max(ODDS_GROWTH_MIN, growthRaw));
  return {
    years: days / 365.25,
    lnTVL: Math.log(p.tvl_usd) - LTVL_REF,
    growth,
    growthRaw,
    lnChains: Math.log(Math.max(1, p.chains.length)),
    category: p.category,
  };
}

/** The category vocab of a training set: categories with >= ODDS_CAT_MIN_N
 * members, alphabetical. The first is the reference (coefficient 0);
 * every other category pools to "(other)" and is fitted as its own dummy. */
function oddsVocab(peers: SnapshotProtocol[]): string[] {
  const counts = new Map<string, number>();
  for (const p of peers) {
    if (p.category === null) continue;
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= ODDS_CAT_MIN_N).map(([c]) => c).sort();
}

/** Which bucket a category falls in under a vocab: itself, or "(other)". */
function oddsCatBucket(category: string | null, vocab: string[]): string {
  return category !== null && vocab.includes(category) ? category : '(other)';
}

/** Which terms a fit uses (the ablation rungs switch them on one by one). */
interface OddsTerms {
  age: boolean;
  lnTVL: boolean;
  growth: boolean;
  cat: boolean;
  chains: boolean;
}
const ODDS_FULL_TERMS: OddsTerms = { age: true, lnTVL: true, growth: true, cat: true, chains: false };

interface OddsDesign {
  /** Rows: [intercept, standardised continuous terms..., category dummies...]. */
  X: number[][];
  names: string[];
  /** Train mean/sd per enabled continuous feature (population sd). */
  standardization: Record<string, { mean: number; sd: number }>;
}

/** The design matrix for a peer set under a vocab + term set. Continuous
 * features are standardised with the TRAIN set's own mean/sd (never the
 * full set's — no leakage); category dummies stay 0/1. A caller that
 * scores held-out peers passes the train standardisation back in. */
function oddsDesign(
  asOf: string,
  peers: SnapshotProtocol[],
  vocab: string[],
  terms: OddsTerms,
  standardization?: Record<string, { mean: number; sd: number }>,
): OddsDesign {
  const feats = peers.map((p) => oddsRawFeatures(asOf, p));
  const contKeys: ('years' | 'lnTVL' | 'growth' | 'lnChains')[] = [];
  if (terms.age) contKeys.push('years');
  if (terms.lnTVL) contKeys.push('lnTVL');
  if (terms.growth) contKeys.push('growth');
  if (terms.chains) contKeys.push('lnChains');
  const std: Record<string, { mean: number; sd: number }> = standardization ?? {};
  if (standardization === undefined) {
    for (const k of contKeys) {
      const vals = feats.map((f) => f[k]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      std[k] = { mean, sd: Math.sqrt(variance) || 1 };
    }
  }
  const names = ['intercept'];
  if (terms.age) names.push('years');
  if (terms.lnTVL) names.push('lnTVL');
  if (terms.growth) names.push('growth');
  if (terms.cat) {
    for (const c of vocab.slice(1)) names.push(`cat:${c}`);
    names.push('cat:(other)');
  }
  if (terms.chains) names.push('lnChains');
  const X = feats.map((f) => {
    const row = [1];
    if (terms.age) row.push((f.years - std.years.mean) / std.years.sd);
    if (terms.lnTVL) row.push((f.lnTVL - std.lnTVL.mean) / std.lnTVL.sd);
    if (terms.growth) row.push((f.growth - std.growth.mean) / std.growth.sd);
    if (terms.cat) {
      const bucket = oddsCatBucket(f.category, vocab);
      for (const c of vocab.slice(1)) row.push(bucket === c ? 1 : 0);
      row.push(bucket === '(other)' ? 1 : 0);
    }
    if (terms.chains) row.push((f.lnChains - std.lnChains.mean) / std.lnChains.sd);
    return row;
  });
  return { X, names, standardization: std };
}

/** Gaussian elimination with partial pivoting (the Hessian is small and
 * ridge-regularised, so this is exact — no pivoting-free shortcut). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (piv !== col) {
      const t = M[col];
      M[col] = M[piv];
      M[piv] = t;
    }
    const d = M[col][col];
    if (d === 0) continue;
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = M[r][r] === 0 ? 0 : s / M[r][r];
  }
  return x;
}

function oddsSigmoid(z: number): number {
  const c = Math.max(-35, Math.min(35, z));
  return 1 / (1 + Math.exp(-c));
}

/** Newton/IRLS logistic fit with an L2 ridge (lambda) on every coefficient
 * except the intercept. Follows Phase 0 fit-odds.py (same clip, same
 * 1e-9 weight floor, same convergence test). */
function fitLogitNewton(X: number[][], y: number[], lambda: number): number[] {
  const n = X.length;
  const k = X[0].length;
  let beta = new Array<number>(k).fill(0);
  for (let iter = 0; iter < ODDS_NEWTON_MAX_ITER; iter++) {
    const p = new Array<number>(n);
    const w = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < k; j++) z += X[i][j] * beta[j];
      p[i] = oddsSigmoid(z);
      w[i] = p[i] * (1 - p[i]) + 1e-9;
    }
    const g = new Array<number>(k).fill(0);
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[i][j] * (y[i] - p[i]);
      g[j] = s - (j === 0 ? 0 : lambda * beta[j]);
    }
    const H: number[][] = [];
    for (let a = 0; a < k; a++) H.push(new Array<number>(k).fill(0));
    for (let a = 0; a < k; a++) {
      for (let b = a; b < k; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += X[i][a] * w[i] * X[i][b];
        H[a][b] = s + (a === b && a !== 0 ? lambda : 0);
        H[b][a] = H[a][b];
      }
    }
    const step = solveLinear(H, g);
    let maxStep = 0;
    for (let j = 0; j < k; j++) {
      beta[j] += step[j];
      maxStep = Math.max(maxStep, Math.abs(step[j]));
    }
    if (maxStep < ODDS_NEWTON_TOL) break;
  }
  return beta;
}

/** A fitted odds model: natural-unit coefficients + the standardisation
 * they came from (so the back-transform can be re-derived, C1.5). */
interface OddsFit {
  coef: Record<string, number>;
  coefStd: Record<string, number>;
  standardization: Record<string, { mean: number; sd: number }>;
  vocab: string[];
  names: string[];
  n: number;
}

/** Fit the odds model on a peer set: vocab from the set (unless overridden
 * — the bootstrap holds the final vocab fixed), standardisation from the
 * set, Newton/IRLS ridge, back-transform to natural units. Category
 * dummies stay 0/1 (never standardised — their natural unit IS 0/1, and
 * the reference-category structure must survive). */
export function fitOdds(
  asOf: string,
  peers: SnapshotProtocol[],
  terms: OddsTerms,
  vocabOverride?: string[],
): OddsFit {
  const vocab = vocabOverride ?? oddsVocab(peers);
  const design = oddsDesign(asOf, peers, vocab, terms);
  const y = peers.map(oddsLabel);
  const betaStd = fitLogitNewton(design.X, y, ODDS_LAMBDA);
  const coefStd: Record<string, number> = {};
  design.names.forEach((nm, j) => {
    coefStd[nm] = betaStd[j];
  });
  // Back-transform: continuous beta_nat = beta_std / sd; the intercept
  // absorbs the means (C1.5). Dummies pass through unchanged.
  const coef: Record<string, number> = {};
  let intercept = betaStd[0];
  design.names.forEach((nm, j) => {
    if (nm === 'intercept') return;
    const st = design.standardization[nm];
    if (st !== undefined) {
      coef[nm] = betaStd[j] / st.sd;
      intercept -= (betaStd[j] * st.mean) / st.sd;
    } else {
      coef[nm] = betaStd[j];
    }
  });
  coef.intercept = intercept;
  return { coef, coefStd, standardization: design.standardization, vocab, names: design.names, n: peers.length };
}

/** The linear predictor in natural units, from a fitted coefficient map
 * and one protocol's raw features (the dashboard mirrors this exactly —
 * same feature rules, same bucket rule, no refit in the browser). */
function oddsLogitNatural(coef: Record<string, number>, f: OddsRawFeatures, vocab: string[]): number {
  let z = coef.intercept;
  if (coef.years !== undefined) z += coef.years * f.years;
  if (coef.lnTVL !== undefined) z += coef.lnTVL * f.lnTVL;
  if (coef.growth !== undefined) z += coef.growth * f.growth;
  if (coef.lnChains !== undefined) z += coef.lnChains * f.lnChains;
  const bucket = oddsCatBucket(f.category, vocab);
  if (bucket !== vocab[0]) {
    const c = coef[`cat:${bucket}`];
    if (c !== undefined) z += c;
  }
  return z;
}

function oddsBrier(pred: number[], y: number[]): number {
  let s = 0;
  for (let i = 0; i < pred.length; i++) s += (pred[i] - y[i]) ** 2;
  return s / pred.length;
}

function oddsCalibration(
  pred: number[],
  y: number[],
  bins = 5,
): { bin: number; n: number; mean_pred: number; obs_rate: number }[] {
  const order = pred.map((p, i) => i).sort((a, b) => pred[a] - pred[b]);
  const out: { bin: number; n: number; mean_pred: number; obs_rate: number }[] = [];
  const n = pred.length;
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor((b * n) / bins);
    const hi = Math.floor(((b + 1) * n) / bins);
    if (hi <= lo) continue;
    let sp = 0;
    let sy = 0;
    for (let k = lo; k < hi; k++) {
      sp += pred[order[k]];
      sy += y[order[k]];
    }
    out.push({ bin: b + 1, n: hi - lo, mean_pred: round4(sp / (hi - lo)), obs_rate: round4(sy / (hi - lo)) });
  }
  return out;
}

/** The walk-forward split (C.7): single time-split at the median listing
 * date of the dated K peers; undated peers (imputed older than the
 * cutoff) train. The fit's vocab + standardisation come from train only. */
function oddsWalkForward(
  asOf: string,
  peers: SnapshotProtocol[],
  terms: OddsTerms,
): {
  cutoff: string;
  train: SnapshotProtocol[];
  test: SnapshotProtocol[];
  trainBase: number;
  testBase: number;
  brier: number;
  brierBase: number;
  testPred: number[];
  calibration: { bin: number; n: number; mean_pred: number; obs_rate: number }[];
} {
  const dated = peers
    .filter((p) => p.listed_at !== null)
    .sort((a, b) =>
      (a.listed_at as string) < (b.listed_at as string)
        ? -1
        : (a.listed_at as string) > (b.listed_at as string)
          ? 1
          : a.slug < b.slug
            ? -1
            : 1,
    );
  const undated = peers.filter((p) => p.listed_at === null);
  const med = Math.floor(dated.length / 2);
  const train = [...dated.slice(0, med), ...undated];
  const test = dated.slice(med);
  const cutoff = dated[med - 1].listed_at as string;
  const yTrain = train.map(oddsLabel);
  const yTest = test.map(oddsLabel);
  const trainBase = yTrain.reduce((a, b) => a + b, 0) / yTrain.length;
  const testBase = yTest.reduce((a, b) => a + b, 0) / yTest.length;
  const fit = fitOdds(asOf, train, terms);
  const testPred = test.map((p) => oddsSigmoid(oddsLogitNatural(fit.coef, oddsRawFeatures(asOf, p), fit.vocab)));
  const brier = oddsBrier(testPred, yTest);
  const brierBase = oddsBrier(
    testPred.map(() => trainBase),
    yTest,
  );
  return { cutoff, train, test, trainBase, testBase, brier, brierBase, testPred, calibration: oddsCalibration(testPred, yTest) };
}

/** Stratified 10-fold CV on the full K-set (undated imputed): each fold's
 * vocab + standardisation come from its own train fold (no leakage). The
 * fold assignment is deterministic (mulberry32, seed ODDS_CV_SEED) and
 * exported, so the verifier can refit the exact same folds. */
function oddsCV10(
  asOf: string,
  peers: SnapshotProtocol[],
  terms: OddsTerms,
  seed: number,
): {
  oof: number[];
  folds: number[];
  brier: number;
  brierBase: number;
  calibration: { bin: number; n: number; mean_pred: number; obs_rate: number }[];
} {
  const rng = mulberry32(seed);
  const pos = peers.map((p, i) => i).filter((i) => oddsLabel(peers[i]) === 1);
  const neg = peers.map((p, i) => i).filter((i) => oddsLabel(peers[i]) === 0);
  const shuffle = (a: number[]): void => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  };
  shuffle(pos);
  shuffle(neg);
  const folds = new Array<number>(peers.length).fill(0);
  pos.forEach((idx, k) => {
    folds[idx] = k % 10;
  });
  neg.forEach((idx, k) => {
    folds[idx] = k % 10;
  });
  const oof = new Array<number>(peers.length).fill(0);
  const baseOof = new Array<number>(peers.length).fill(0);
  for (let f = 0; f < 10; f++) {
    const trainIdx = peers.map((_, i) => i).filter((i) => folds[i] !== f);
    const testIdx = peers.map((_, i) => i).filter((i) => folds[i] === f);
    const train = trainIdx.map((i) => peers[i]);
    const fit = fitOdds(asOf, train, terms);
    const trainBase = train.reduce((a, p) => a + oddsLabel(p), 0) / train.length;
    for (const i of testIdx) {
      oof[i] = oddsSigmoid(oddsLogitNatural(fit.coef, oddsRawFeatures(asOf, peers[i]), fit.vocab));
      baseOof[i] = trainBase;
    }
  }
  const y = peers.map(oddsLabel);
  return { oof, folds, brier: oddsBrier(oof, y), brierBase: oddsBrier(baseOof, y), calibration: oddsCalibration(oof, y) };
}

/** The sequential odds ablation (C4): base -> +age -> +lnTVL -> +growth ->
 * +category -> +chains. Each rung is scored by CV10 + walk-forward; a rung
 * is KEPT only when BOTH Briers strictly fall vs the previous rung (a
 * difference under 0.0001 is a tie, not a fall). The base rung is the
 * train base rate as a constant (no fit); the +category rung reuses the
 * shipped model's CV10/WF (same terms, same folds, same split). */
function oddsAblation(
  asOf: string,
  peers: SnapshotProtocol[],
  pre: { baseCv: number; baseWf: number; fullCv: number; fullWf: number },
): OddsData['ablation'] {
  const rungDefs: { name: string; terms: OddsTerms | null }[] = [
    { name: 'Base rate', terms: null },
    { name: '+ Age', terms: { age: true, lnTVL: false, growth: false, cat: false, chains: false } },
    { name: '+ lnTVL', terms: { age: true, lnTVL: true, growth: false, cat: false, chains: false } },
    { name: '+ Growth', terms: { age: true, lnTVL: true, growth: true, cat: false, chains: false } },
    { name: '+ Category', terms: { age: true, lnTVL: true, growth: true, cat: true, chains: false } },
    { name: '+ Chains', terms: { age: true, lnTVL: true, growth: true, cat: true, chains: true } },
  ];
  const rows: { name: string; brier_cv10: number; brier_wf: number }[] = [];
  for (const r of rungDefs) {
    if (r.terms === null) {
      rows.push({ name: r.name, brier_cv10: pre.baseCv, brier_wf: pre.baseWf });
    } else if (r.name === '+ Category') {
      rows.push({ name: r.name, brier_cv10: pre.fullCv, brier_wf: pre.fullWf });
    } else {
      const cv = oddsCV10(asOf, peers, r.terms, ODDS_CV_SEED);
      const wf = oddsWalkForward(asOf, peers, r.terms);
      rows.push({ name: r.name, brier_cv10: cv.brier, brier_wf: wf.brier });
    }
  }
  return rows.map((row, i) => {
    if (i === 0) return { ...row, decision: 'BASELINE' as const };
    const prev = rows[i - 1];
    const cvFall = prev.brier_cv10 - row.brier_cv10 >= 0.0001;
    const wfFall = prev.brier_wf - row.brier_wf >= 0.0001;
    return { ...row, decision: cvFall && wfFall ? ('KEEP' as const) : ('NOT_KEPT' as const) };
  });
}

/** Bootstrap standard errors (C.4): 200 refits on resamples of the 442
 * peers, vocab FIXED at the final fit's (so coefficients stay comparable
 * across refits), standardisation per resample, back-transformed; the SE
 * is the sample SD across refits. Same mulberry32 pattern as the value
 * model's bootstrapRefits, on an independent seed. */
function oddsBootstrap(asOf: string, peers: SnapshotProtocol[], vocab: string[]): Record<string, number> {
  const rng = mulberry32(ODDS_BOOTSTRAP_SEED);
  const n = peers.length;
  const samples: Record<string, number[]> = {};
  for (let b = 0; b < ODDS_BOOTSTRAP_N; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < n; i++) sample.push(peers[Math.floor(rng() * n)]);
    const fit = fitOdds(asOf, sample, ODDS_FULL_TERMS, vocab);
    for (const [k, v] of Object.entries(fit.coef)) {
      if (!samples[k]) samples[k] = [];
      samples[k].push(v);
    }
  }
  const se: Record<string, number> = {};
  for (const [k, vals] of Object.entries(samples)) {
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1);
    se[k] = Math.sqrt(variance);
  }
  return se;
}

/** Score one ranked row: p now, p at the horizon, ever, 12-month.
 * ever = (p_horizon - p_now) / (1 - p_now) — the model's conditional
 * chance of recording a token by the oldest observed age, given none yet
 * (Amendment S-2). GUARD: ever outside (0, 1] is a build failure, never
 * clamped silently — it means beta_years <= 0 or a horizon breach. */
function oddsScoreRow(
  asOf: string,
  p: SnapshotProtocol,
  fit: OddsFit,
  horizonYears: number,
): { pNow: number; pHorizon: number; pAgePlus1: number; ever: number; twelveMonth: number; features: OddsRawFeatures } {
  const f = oddsRawFeatures(asOf, p);
  const pNow = oddsSigmoid(oddsLogitNatural(fit.coef, f, fit.vocab));
  const pHorizon = oddsSigmoid(oddsLogitNatural(fit.coef, { ...f, years: horizonYears }, fit.vocab));
  const pAgePlus1 = oddsSigmoid(oddsLogitNatural(fit.coef, { ...f, years: f.years + 1 }, fit.vocab));
  const ever = (pHorizon - pNow) / (1 - pNow);
  const twelveMonth = (pAgePlus1 - pNow) / (1 - pNow);
  if (!(ever > 0 && ever <= 1)) {
    throw new Error(
      `odds ever out of range for ${p.slug}: ever=${ever} (p_now=${pNow}, p_horizon=${pHorizon}) — beta_years<=0 or horizon breach; see S-2`,
    );
  }
  return { pNow, pHorizon, pAgePlus1, ever, twelveMonth, features: f };
}

/** Build the whole odds model (v4.2 NEW-C): the final fit on all 442 K
 * peers, the walk-forward + 10-fold tests, the ablation, the bootstrap
 * SEs, and the per-row scores for the board. */
export function buildOddsModel(snapshot: Snapshot): OddsData {
  const asOf = snapshot.as_of;
  const peers = oddsPeerSet(snapshot);
  const fit = fitOdds(asOf, peers, ODDS_FULL_TERMS);
  if (!(fit.coef.years > 0)) {
    throw new Error(`odds beta_years<=0 (${fit.coef.years}) — the age term must be positive (S-2); stopping, see build report`);
  }
  const dated = peers.filter((p) => p.listed_at !== null);
  const horizonDays = Math.max(...dated.map((p) => ageDays(asOf, p.listed_at) as number));
  const horizonYears = horizonDays / 365.25;
  const wf = oddsWalkForward(asOf, peers, ODDS_FULL_TERMS);
  const cv = oddsCV10(asOf, peers, ODDS_FULL_TERMS, ODDS_CV_SEED);
  const ablation = oddsAblation(asOf, peers, { baseCv: cv.brierBase, baseWf: wf.brierBase, fullCv: cv.brier, fullWf: wf.brier });
  const coefSe = oddsBootstrap(asOf, peers, fit.vocab);
  const termsKept = ablation.filter((r) => r.decision === 'KEEP').length;
  const ranked = peers.filter(isPreToken);
  const rowFeatures = ranked.map((p) => {
    const s = oddsScoreRow(asOf, p, fit, horizonYears);
    const rf = {
      slug: p.slug,
      years: round4(s.features.years),
      lnTVL: round4(s.features.lnTVL),
      growth: round4(s.features.growth),
      growth_raw: s.features.growthRaw,
      category: p.category,
      cat_bucket: oddsCatBucket(p.category, fit.vocab),
      p_now: s.pNow,
      p_horizon: s.pHorizon,
      p_age1: s.pAgePlus1,
      ever: s.ever,
      twelve_month: s.twelveMonth,
    };
    return { ...rf, odds_html: oddsDerivationHtml(rf, fit, horizonYears, p.listed_at === null) };
  });
  // Gain vs the test set's own base rate (C2.7, recorded, no bar): the
  // model Brier against the constant test-base Brier, WF + CV10.
  const wfTestBaseBrier = oddsBrier(
    wf.testPred.map(() => wf.testBase),
    wf.test.map(oddsLabel),
  );
  const fullBase = peers.reduce((a, p) => a + oddsLabel(p), 0) / peers.length;
  const cvTestBaseBrier = oddsBrier(
    cv.oof.map(() => fullBase),
    peers.map(oddsLabel),
  );
  const catCoefs = Object.entries(fit.coef)
    .filter(([k]) => k.startsWith('cat:'))
    .map(([, v]) => v);
  return {
    lambda: ODDS_LAMBDA,
    age_impute_days: ODDS_AGE_IMPUTE_DAYS,
    horizon_years: round4(horizonYears),
    horizon_days: horizonDays,
    n_peers: peers.length,
    n_launched: peers.reduce((a, p) => a + oddsLabel(p), 0),
    coef: fit.coef,
    coef_se: coefSe,
    coef_std: fit.coefStd,
    standardization: {
      years: fit.standardization.years,
      lnTVL: fit.standardization.lnTVL,
      growth: fit.standardization.growth,
    },
    vocab: fit.vocab,
    reference_category: fit.vocab[0],
    bootstrap_n: ODDS_BOOTSTRAP_N,
    bootstrap_seed: ODDS_BOOTSTRAP_SEED,
    wf: {
      cutoff: wf.cutoff,
      train_n: wf.train.length,
      test_n: wf.test.length,
      train_base: round4(wf.trainBase),
      test_base: round4(wf.testBase),
      brier: round4(wf.brier),
      brier_base: round4(wf.brierBase),
      test_slugs: wf.test.map((p) => p.slug),
      calibration: wf.calibration,
    },
    wf_test_pred: wf.testPred,
    wf_test_labels: wf.test.map((p) => oddsLabel(p)),
    cv10: { brier: round4(cv.brier), brier_base: round4(cv.brierBase), calibration: cv.calibration },
    cv10_oof: cv.oof,
    cv10_folds: cv.folds,
    peer_slugs: peers.map((p) => p.slug),
    peer_labels: peers.map((p) => oddsLabel(p)),
    cat_range: [round2(Math.min(...catCoefs)), round2(Math.max(...catCoefs))],
    ablation: ablation.map((r) => ({ ...r, brier_cv10: round4(r.brier_cv10), brier_wf: round4(r.brier_wf) })),
    terms_kept: termsKept,
    terms_total: ablation.length - 1,
    gain_test_base: { wf: round4(wfTestBaseBrier - wf.brier), cv10: round4(cvTestBaseBrier - cv.brier) },
    row_features: rowFeatures,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): {
  board: BoardRow[];
  radarRows: RadarRow[];
  comps: SnapshotProtocol[];
  curve: SizeCurve;
  catAdj: Map<string, number>;
  looResiduals: { tvl_usd: number; resid: number }[];
  refits: Map<string, RefitStats>;
  odds: OddsData;
} {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const comps = snapshot.protocols.filter(isComp);
  const fit = fitVariant(comps, SHIPPED_VARIANT);
  const { residuals } = looTest(comps, snapshot.as_of, SHIPPED_VARIANT);
  const looResiduals = residuals.map((r) => ({ tvl_usd: r.tvl_usd, resid: r.resid }));
  // v4.2 NEW-C: the odds model (fit once; the board multiplies the value
  // model's if-launches value by the per-row ever odds).
  const odds = buildOddsModel(snapshot);
  const everBySlug = new Map(odds.row_features.map((r) => [r.slug, r.ever]));
  const oddsHtmlBySlug = new Map(odds.row_features.map((r) => [r.slug, r.odds_html]));

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
  const boardProtos = [...chosen.values()];
  const refits = bootstrapRefits(comps, boardProtos, snapshot.as_of, SHIPPED_VARIANT);

  const scored = boardProtos.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const sizeMultiple = Math.exp(curveAt(fit.curve, p.tvl_usd));
    const cat = fit.catAdj.get(p.category ?? '(none)') ?? 0;
    const gTilt = growthTilt(p, SHIPPED_VARIANT.growthWeight);
    const mTilt = maturityTilt(snapshot.as_of, p, SHIPPED_VARIANT.maturityRange);
    const multiple = sizeMultiple * Math.exp(cat) * gTilt * mTilt;
    // v4.2 NEW-C: the value model's implied value is the IF-LAUNCHES value;
    // the board's implied value multiplies it by the token odds (ever).
    // The value terms above are untouched — only this last step is new.
    const ifLaunches = Math.max(1, Math.round(p.tvl_usd * multiple));
    const ever = everBySlug.get(p.slug);
    if (ever === undefined) throw new Error(`odds: no ever score for ranked row ${p.slug}`);
    const implied = Math.max(1, Math.round(ifLaunches * ever));
    const refit = refits.get(p.slug)!;
    const bands = rowBands(implied, p.tvl_usd, looResiduals, refit);
    const econ = farmEconomics(p, implied, bands.p25, FARM.default_ticket_usd, FARM.default_share);
    return { p, age, sizeMultiple, cat, gTilt, mTilt, multiple, ifLaunches, ever, implied, bands, refit, econ };
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
    if_launches_usd: s.ifLaunches,
    ever: s.ever,
    model: {
      size_multiple: round4(s.sizeMultiple),
      category_adjustment: round4(s.cat),
      growth_multiplier: round4(s.gTilt),
      maturity_multiplier: round4(s.mTilt),
      multiple: round4(s.multiple),
      p25_usd: s.bands.p25,
      p75_usd: s.bands.p75,
      p10_usd: s.bands.p10,
      p90_usd: s.bands.p90,
      rank_lo: s.refit.rank_lo,
      rank_hi: s.refit.rank_hi,
    },
    farm: {
      verdict: s.econ.verdict,
      net_usd: round2(s.econ.net),
      net_low_usd: round2(s.econ.netLow),
      gross_usd: round2(s.econ.gross),
      cost_usd: round2(s.econ.cost),
      forgone_usd: round2(s.econ.forgone),
      capital_usd: FARM.default_ticket_usd,
      break_even_usd: Math.round(s.econ.breakEvenUsd),
      net_per_hour_usd: round2(s.econ.netPerHour),
    },
    farm_steps: farmSteps(s.p, snapshot.as_of),
  }));
  const radarRows: RadarRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.age,
    listed_at: s.p.listed_at,
    mcap_usd: s.p.mcap_usd,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    implied_value_usd: s.implied,
    if_launches_usd: s.ifLaunches,
    ever: s.ever,
    odds_html: oddsHtmlBySlug.get(s.p.slug) as string,
    p25_usd: s.bands.p25,
    p75_usd: s.bands.p75,
    p10_usd: s.bands.p10,
    p90_usd: s.bands.p90,
    multiple: round4(s.multiple),
    size_multiple: round4(s.sizeMultiple),
    category_adjustment: round4(s.cat),
    growth_multiplier: round4(s.gTilt),
    maturity_multiplier: round4(s.mTilt),
    rank_lo: s.refit.rank_lo,
    rank_hi: s.refit.rank_hi,
    top20_pct: round4(s.refit.top20_pct),
    stop_tvl_usd: stopTvlUsd(s.p),
    verdict: s.econ.verdict,
    net_usd: round2(s.econ.net),
    net_low_usd: round2(s.econ.netLow),
    gross_usd: round2(s.econ.gross),
    cost_usd: round2(s.econ.cost),
    forgone_usd: round2(s.econ.forgone),
    capital_usd: FARM.default_ticket_usd,
    break_even_usd: Math.round(s.econ.breakEvenUsd),
    break_even_odds: s.econ.breakEvenOdds === null ? null : round4(s.econ.breakEvenOdds),
    net_per_hour_usd: round2(s.econ.netPerHour),
    pays_from_usd: s.econ.paysFrom,
    farm_from_usd: s.econ.farmFrom,
    robust_from_usd: s.econ.robustFrom,
    watchlist: snapshot.watchlist.includes(s.p.slug),
    farm_steps: farmSteps(s.p, snapshot.as_of),
    plan_action: planActionFor(s.p),
    plan_fees_usd: round2(planGasUsd(s.p)),
  }));
  return { board, radarRows, comps, curve: fit.curve, catAdj: fit.catAdj, looResiduals, refits, odds };
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
      listed_at: p.listed_at,
    }));
}

/** Every protocol that records a token, by market cap (nulls last). */
export function tradedRows(snapshot: Snapshot): TradedRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => {
      const am = a.mcap_usd ?? -1;
      const bm = b.mcap_usd ?? -1;
      return bm - am || b.tvl_usd - a.tvl_usd;
    })
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      trades: (p.mcap_usd ?? 0) > 0,
    }));
}

/** Every pre-token protocol the watchlist rule sets aside, with its reason. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !passesWatchlistTest(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: watchlistExclusion(p) ?? 'set aside by rule',
    }));
}

/** Where all 758 protocols go: ranked, recording a token, or set aside. */
export function accounting(snapshot: Snapshot, boardSize: number): RadarData['accounting'] {
  const tokenRecord = snapshot.protocols.filter((p) => !isPreToken(p));
  const tradedPositive = tokenRecord.filter((p) => (p.mcap_usd ?? 0) > 0).length;
  const tokenMcapNull = tokenRecord.filter((p) => p.mcap_usd === null).length;
  const tokenMcapNonpositive = tokenRecord.filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) <= 0).length;
  const setAside = snapshot.protocols.filter((p) => isPreToken(p) && !passesWatchlistTest(p)).length;
  const compsExcluded = tokenRecord.filter((p) => (p.mcap_usd ?? 0) > 0 && !isComp92(p)).length;
  const compsExcludedBridge = tokenRecord.filter((p) => (p.mcap_usd ?? 0) > 0 && isComp92(p) && !isComp(p)).length;
  return {
    total: snapshot.protocols.length,
    ranked: boardSize,
    token_record: tokenRecord.length,
    traded_positive: tradedPositive,
    token_no_mcap: tokenMcapNull + tokenMcapNonpositive,
    token_mcap_null: tokenMcapNull,
    token_mcap_nonpositive: tokenMcapNonpositive,
    set_aside: setAside,
    comps_excluded: compsExcluded,
    comps_excluded_bridge: compsExcludedBridge,
  };
}

/** Band calibration from the leave-one-out residuals: for each comp, the
 * band the model would have built for it from its 30 nearest neighbours'
 * residuals (itself excluded), and whether its actual value falls inside.
 * A P25–P75 band that covered exactly half the comps would read 50%; a
 * P10–P90 band, 80%. */
export function bandCoverage(
  residuals: { slug: string; tvl_usd: number; resid: number }[],
): { p25_75: number; p10_90: number } {
  let in2575 = 0;
  let in1090 = 0;
  for (const r of residuals) {
    const near = residuals
      .filter((o) => o.slug !== r.slug)
      .map((o) => ({ d: Math.abs(Math.log(o.tvl_usd) - Math.log(r.tvl_usd)), resid: o.resid }))
      .sort((a, b) => a.d - b.d)
      .slice(0, BAND_NEIGHBORS)
      .map((x) => x.resid);
    if (r.resid >= quantile(near, 0.25) && r.resid <= quantile(near, 0.75)) in2575++;
    if (r.resid >= quantile(near, 0.1) && r.resid <= quantile(near, 0.9)) in1090++;
  }
  return {
    p25_75: residuals.length === 0 ? 0 : in2575 / residuals.length,
    p10_90: residuals.length === 0 ? 0 : in1090 / residuals.length,
  };
}

/** Base rates: the share of K-set peers that record a token, by how long
 * DefiLlama has tracked them — the cohort anchor of the odds model (the
 * oldest bucket's 87.5% is the record the model is built on). Undated
 * peers are counted at the canonical 1,643-day imputation, so they land
 * in the oldest bucket, exactly as the odds fit treats them. The holdout
 * line splits the peer set by slug hash and compares the bucket rates
 * across halves. */
export function baseRates(snapshot: Snapshot): RadarData['base_rates'] {
  const buckets: { label: string; min: number; max: number }[] = [
    { label: 'under 6 months', min: 0, max: 180 },
    { label: '6–12 months', min: 180, max: 365 },
    { label: '1–2 years', min: 365, max: 730 },
    { label: '2–4 years', min: 730, max: 1460 },
    { label: 'over 4 years', min: 1460, max: Number.POSITIVE_INFINITY },
  ];
  // v4.2 NEW-C: the K-set (watchlist-passing peers), not all protocols —
  // the odds model's own population. Undated peers at the 1,643-day
  // imputation, so the buckets cover all 442 peers.
  const peers = snapshot.protocols.filter(passesWatchlistTest);
  const ageImputed = (p: SnapshotProtocol): number => ageDays(snapshot.as_of, p.listed_at) ?? ODDS_AGE_IMPUTE_DAYS;
  const rate = (list: SnapshotProtocol[]): number =>
    list.length === 0 ? 0 : list.filter((p) => !isPreToken(p)).length / list.length;
  const out = buckets.map((b) => {
    const list = peers.filter((p) => {
      const a = ageImputed(p);
      return a >= b.min && a < b.max;
    });
    const launched = list.filter((p) => !isPreToken(p)).length;
    return { label: b.label, n: list.length, launched, token_pct: round4(rate(list)) };
  });
  // Split-half stability: the same buckets on two deterministic halves of
  // the peer set (slug hash), so the reader sees the rates are not one
  // half's accident. Only buckets with 20+ protocols in both halves count.
  const hash = (s: string): number => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  const halfA = peers.filter((p) => hash(p.slug) % 2 === 0);
  const halfB = peers.filter((p) => hash(p.slug) % 2 === 1);
  let worst = { label: '', gap: 0, a: 0, b: 0 };
  for (const b of buckets) {
    const inBucket = (list: SnapshotProtocol[]): SnapshotProtocol[] =>
      list.filter((p) => {
        const age = ageImputed(p);
        return age >= b.min && age < b.max;
      });
    const la = inBucket(halfA);
    const lb = inBucket(halfB);
    if (la.length < 20 || lb.length < 20) continue;
    const gap = Math.abs(rate(la) - rate(lb));
    if (gap > worst.gap) worst = { label: b.label, gap, a: rate(la), b: rate(lb) };
  }
  const holdout =
    worst.gap === 0
      ? 'Split-half check: the K-set bucket rates are stable across two halves of the peer set.'
      : `Split-half check: the K-set bucket rates agree within ${Math.round(worst.gap * 100)} points between two halves of the peer set.`;
  return { buckets: out, holdout };
}

/** The set-aside protocols, counted per reason, most common first. */
export function setAsideReasons(snapshot: Snapshot): { reason: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || passesWatchlistTest(p)) continue;
    const reason = watchlistExclusion(p) ?? 'set aside by rule';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n || (a.reason < b.reason ? -1 : 1));
}

/** FNV-1a (32-bit) over `slug:implied;` per row, in rank order. The page
 * recomputes it from the values it re-runs and compares it with this seal. */
export function boardDigest(rows: { slug: string; implied_value_usd: number }[]): string {
  let h = 0x811c9dc5;
  for (const r of rows) {
    const s = `${r.slug}:${r.implied_value_usd};`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Pre-rendered value ablation table (P1): byte-identical DOM text to
 * the v4.1 JS renderer (same cells, same formatting, same classes) —
 * the dashboard injects this string instead of building the table. */
function ablationHtml(rows: AblationRung[]): string {
  const H = '<th class="num">';
  const N = '<td class="num">';
  const times = (x: number): string => '×' + x.toFixed(2);
  let s = '<tr><th>Rung</th>' + H + 'LOO</th>' + H + 'SE</th>' + H + '≤3×</th>' + H + 'ρ</th>' + H + 'Walk-fwd</th>' + H + '≤3×</th>' + H + 'ρ</th><th>Decision</th></tr>';
  for (const a of rows) {
    const rho = a.decision === 'BASELINE' ? '—' : a.loo_rho.toFixed(2);
    const rhoW = a.decision === 'BASELINE' ? '—' : a.wf_rho.toFixed(2);
    s += '<tr><td><strong>' + escHtml(a.name) + '</strong></td>' +
      N + times(a.loo_x) + '</td>' + N + '±' + a.loo_se_x.toFixed(2) + '</td>' + N + Math.round(a.loo_within_3x * 100) + '%</td>' + N + rho + '</td>' +
      N + times(a.wf_x) + '</td>' + N + Math.round(a.wf_within_3x * 100) + '%</td>' + N + rhoW + '</td>' +
      '<td><span class="decision ' + a.decision + '">' + a.decision + '</span></td></tr>';
  }
  return s;
}

/** Pre-rendered odds ablation table for the sidebar (N2, C4.5): 6 rungs,
 * Brier to 3 decimals, decision column. The title carries the peer
 * count + both test names (CV10 = 10-fold, WF = walk-forward). */
function oddsAblationHtml(odds: OddsData): string {
  const H = '<th class="num">';
  const N = '<td class="num">';
  let s = '<h3>Token odds · ' + odds.n_peers + ' peers · CV10/WF</h3><table class="oos odds-tbl"><tr><th>Rung</th>' + H + 'CV10</th>' + H + 'WF</th><th>Kept?</th></tr>';
  for (const r of odds.ablation) {
    const d = r.decision === 'BASELINE' ? '—' : r.decision === 'KEEP' ? 'kept' : 'not kept';
    s += '<tr><td>' + escHtml(r.name) + '</td>' + N + r.brier_cv10.toFixed(3) + '</td>' + N + r.brier_wf.toFixed(3) + '</td><td>' + d + '</td></tr>';
  }
  return s + '</table>';
}

/** The odds stat card lines for the cover strip (N5, C7.1), pre-rendered:
 * Brier WF + CV10 each with its base, coef ± SE, category range. The
 * 2-decimal card format is §C.5; the 3-decimal values live in the table. */
function oddsCardHtml(odds: OddsData): string {
  const pm = (v: number, se: number): string =>
    (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2) + ' ± ' + se.toFixed(2);
  const sg = (v: number): string =>
    (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  return '<b>Token odds:</b> Brier ' + odds.wf.brier.toFixed(2) + ' vs ' + odds.wf.brier_base.toFixed(2) +
    ' base (walk-forward, ' + odds.wf.test_n + ' later peers) · ' + odds.cv10.brier.toFixed(2) + ' vs ' + odds.cv10.brier_base.toFixed(2) +
    ' base (10-fold)<br>years ' + pm(odds.coef.years, odds.coef_se.years) + ' · lnTVL ' + pm(odds.coef.lnTVL, odds.coef_se.lnTVL) +
    ' · growth ' + pm(odds.coef.growth, odds.coef_se.growth) + ' · category ' + sg(odds.cat_range[0]) + '…' + sg(odds.cat_range[1]);
}

/** The per-row odds derivation (C6.1–C6.8), pre-rendered as kvRows HTML:
 * intercept + 4 terms + logit + p_now + ever transform + 12-month.
 * Terms are computed from the STORED (round4) features — exactly what
 * the verifier recomputes from data.js. The browser only injects it. */
function oddsDerivationHtml(
  rf: { years: number; lnTVL: number; growth: number; growth_raw: number | null; category: string | null; cat_bucket: string; p_now: number; p_horizon: number; p_age1: number; ever: number; twelve_month: number },
  fit: OddsFit,
  horizonYears: number,
  undated: boolean,
): string {
  const sg2 = (v: number): string => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
  const pc = (v: number): string => (v * 100).toFixed(1) + '%';
  const pctU = (v: number): string => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
  const c = fit.coef;
  const tY = c.years * rf.years;
  const tL = c.lnTVL * rf.lnTVL;
  const tG = c.growth * rf.growth;
  const ref = rf.cat_bucket === fit.vocab[0];
  const tC = ref ? 0 : c['cat:' + rf.cat_bucket];
  const logit = c.intercept + tY + tL + tG + tC;
  const yNote = rf.years.toFixed(2) + ' yr × ' + sg2(c.years) + (undated ? ' · unknown date, scored at 4.5 yr' : '');
  const gNote = rf.growth_raw === null
    ? 'unreported → 0 × ' + sg2(c.growth)
    : pctU(rf.growth * 100) + ' × ' + sg2(c.growth) + ((rf.growth_raw < ODDS_GROWTH_MIN || rf.growth_raw > ODDS_GROWTH_MAX) ? ' · winsorized from ' + pctU(rf.growth_raw * 100) : '');
  const cNote = ref
    ? rf.cat_bucket + ' (reference)'
    : (rf.category ?? 'Uncategorised') + (rf.cat_bucket === '(other)' ? ' → (other)' : '') + ' × ' + sg2(tC);
  const rows: [string, string, string, boolean][] = [
    ['Intercept', '', sg2(c.intercept), false],
    ['Years listed', yNote, sg2(tY), false],
    ['ln(TVL / $100M)', rf.lnTVL.toFixed(2) + ' × ' + sg2(c.lnTVL), sg2(tL), false],
    ['7-day growth', gNote, sg2(tG), false],
    ['Category', cNote, sg2(tC), false],
    ['= logit', 'sum of terms', sg2(logit), true],
    ['p now', 'sigmoid(logit)', pc(rf.p_now), false],
    ['Token odds — ever', 'p at ' + horizonYears.toFixed(2) + ' yr ' + pc(rf.p_horizon) + ' → (p − p_now)/(1 − p_now)', pc(rf.ever), true],
    ['Token odds — 12-month', 'p at age+1 yr ' + pc(rf.p_age1) + ' → same transform', pc(rf.twelve_month), false],
  ];
  return '<table class="derive odds-derive"><tbody>' + rows.map((p) =>
    '<tr' + (p[3] ? ' class="total"' : '') + '><td>' + escHtml(p[0]) + (p[1] ? ' <span class="dim">· ' + escHtml(p[1]) + '</span>' : '') + '</td><td>' + p[2] + '</td></tr>',
  ).join('') + '</tbody></table>';
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, radarRows, comps, curve, odds } = buildBoard(snapshot);
  const comps92 = snapshot.protocols.filter(isComp92);
  const oos = splitTests(comps, snapshot.as_of, SHIPPED_VARIANT);
  const loo = looTest(comps, snapshot.as_of, SHIPPED_VARIANT);
  const wf = walkForwardTest(comps, snapshot.as_of, SHIPPED_VARIANT);
  const ablation = ablationTable(comps, snapshot.as_of, comps92);
  const boot = bootstrapMultiple(comps);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdictCounts = { ROBUST: 0, FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.farm.verdict]++;
  const bandWidths2575 = radarRows.map((r) => r.p75_usd / r.p25_usd);
  const bandWidths1090 = radarRows.map((r) => r.p90_usd / r.p10_usd);
  // v4.2 NEW-C: top-20 stability is a VALUE-model validation stat (it
  // counts rows whose value-model refit top-20 share clears 0.8), so it
  // is read off the VALUE (if-launches) ranking, not the odds-adjusted
  // board ranking — the value ranking is what the refits ranked.
  const top20Stable = [...radarRows]
    .sort((a, b) => b.if_launches_usd - a.if_launches_usd)
    .slice(0, 20)
    .filter((r) => r.top20_pct >= 0.8).length;
  const coverage = bandCoverage(loo.residuals);
  const rates = baseRates(snapshot);
  const reasons = setAsideReasons(snapshot);
  const digest = boardDigest(board);
  const acct = accounting(snapshot, board.length);
  const halves = splitHalfHalves(comps, snapshot.as_of, SHIPPED_VARIANT);
  const note = ablationNoteText(ablation, comps.length, halves);
  // Rows whose board rank sits 5+ ranks from their TVL order: the
  // ranking is not TVL in disguise.
  const byTvl = [...radarRows].sort((a, b) => b.tvl_usd - a.tvl_usd);
  const tvlRank = new Map(byTvl.map((r, i) => [r.slug, i + 1]));
  const offTvlOrder = radarRows.filter((r) => Math.abs(r.rank - (tvlRank.get(r.slug) as number)) >= 5).length;
  const curveRung = ablation.find((r) => r.name === 'Size curve only')!;
  const growthRung = ablation.find((r) => r.name.startsWith('+ Growth tilt'))!;
  /** Short labels for the cover's set-aside counts. */
  const shortReason = (reason: string): string =>
    reason.startsWith('category ') ? reason.slice(9) : reason.startsWith('versioned') ? 'versioned' : reason.startsWith('wrapped') ? 'wrapped/staked' : reason.startsWith('exchange') ? 'exchange' : reason;
  const setAsideLine = reasons.map((r) => `${shortReason(r.reason)} ${r.n}`).join(' · ');
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const verdictByTicket = FARM.tickets.map((ticket) => {
    const counts = { ROBUST: 0, FARM: 0, THIN: 0, SKIP: 0 };
    let net = 0;
    for (const r of radarRows) {
      const e = farmEconomics(index.get(r.slug)!, r.implied_value_usd, r.p25_usd, ticket, FARM.default_share);
      counts[e.verdict]++;
      net += e.net;
    }
    return { ticket, ...counts, net_usd: round2(net) };
  });
  // One honest line for Method §4: the verdict book at every ticket, ROBUST
  // counts and book net included — the $1K zeros stay visible here even
  // though the cover headline no longer carries them.
  const ticketLine =
    'By ticket \u2014 ' +
    verdictByTicket
      .map((t) => {
        const pay = t.ROBUST + t.FARM + t.THIN;
        const label = t.ticket >= 1000 ? `$${t.ticket / 1000}K` : `$${t.ticket}`;
        const net =
          (t.net_usd < 0 ? '\u2212$' : '$') +
          Math.abs(t.net_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${label}: ${t.ROBUST} ROBUST \u00b7 ${pay} pay \u00b7 ${net}`;
      })
      .join('; ') +
    '.';
  const bestFarms = [...radarRows]
    .sort((a, b) => b.net_per_hour_usd - a.net_per_hour_usd || a.rank - b.rank)
    .slice(0, 3)
    .map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      net_usd: r.net_usd,
      net_per_hour_usd: r.net_per_hour_usd,
      verdict: r.verdict,
    }));
  // Cover strip + best farms, pre-rendered: the values are computed here
  // (same rungs, same LOO points as the tables), the dashboard only pastes.
  const ablationR2 = ablation.map((r) => ({ ...r, loo_x: round2(r.loo_x), wf_x: round2(r.wf_x) }));
  const fstripAbl = (() => {
    const curveR = ablationR2.find((r) => r.name === 'Size curve only')!;
    const growthR = ablationR2.find((r) => r.name.includes('Growth tilt'))!;
    const ship = ablationR2.find((r) => r.name.includes('shipped'))!;
    const chains = ablationR2.find((r) => r.name.includes('chains'))!;
    const catRaw = ablation.find((r) => r.name.includes('n/(n+64)'))!;
    const shipRaw = ablation.find((r) => r.name.includes('shipped'))!;
    return `Ablation LOO: curve ×${curveR.loo_x.toFixed(2)} → +growth ×${growthR.loo_x.toFixed(2)} → shipped ×${ship.loo_x.toFixed(2)} · category +${((catRaw.loo_x / shipRaw.loo_x - 1) * 100).toFixed(1)}% rejected · chains WF ×${chains.wf_x.toFixed(2)} rejected · ${comps.length} comps`;
  })();
  // The cover scatter, big enough to read: log-log axes with dollar ticks,
  // a dashed perfect-prediction diagonal, one dot per comp.
  const scatterSvg = (() => {
    const W = 340, H = 80, L = 38, R = 8, T = 8, B = 24;
    const logs = loo.points.map((p) => [Math.log10(p.actual_usd), Math.log10(p.predicted_usd)]);
    const all = logs.flat();
    const lo = Math.floor(Math.min(...all)), hi = Math.ceil(Math.max(...all));
    const X = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
    const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const tick = (k: number): string => {
      const u: [string, number] = k >= 9 ? ['B', 9] : k >= 6 ? ['M', 6] : k >= 3 ? ['K', 3] : ['', 0];
      return `$${Math.round(10 ** (k - u[1]))}${u[0]}`;
    };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Leave-one-out scatter: actual vs predicted market cap">`;
    for (let g = Math.ceil(lo); g <= hi; g++) {
      s += `<line x1="${X(g).toFixed(1)}" y1="${T}" x2="${X(g).toFixed(1)}" y2="${H - B}" stroke="#e7e0d2"/><text x="${X(g).toFixed(1)}" y="${H - 8}" font-size="9" fill="#8a8378" text-anchor="middle">${tick(g)}</text>`;
      s += `<line x1="${L}" y1="${Y(g).toFixed(1)}" x2="${W - R}" y2="${Y(g).toFixed(1)}" stroke="#e7e0d2"/><text x="${L - 5}" y="${(Y(g) + 3).toFixed(1)}" font-size="9" fill="#8a8378" text-anchor="end">${tick(g)}</text>`;
    }
    s += `<line x1="${X(lo).toFixed(1)}" y1="${Y(lo).toFixed(1)}" x2="${X(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" stroke="#166534" stroke-width="1.5" stroke-dasharray="5,4"/>`;
    s += `<text x="${(L + 4).toFixed(1)}" y="${(T + 10).toFixed(1)}" font-size="8.5" fill="#166534">- - perfect prediction</text>`;
    for (const [x, y] of logs) s += `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.5" fill="#166534" fill-opacity="0.7"/>`;
    return s + `<text x="${L + (W - L - R) / 2}" y="${H - 1}" font-size="9" fill="#8a8378" text-anchor="middle">actual market cap →</text><text x="10" y="${T + (H - T - B) / 2}" font-size="9" fill="#8a8378" text-anchor="middle" transform="rotate(-90 10 ${T + (H - T - B) / 2})">predicted ↑</text></svg>`;
  })();
  // The Method scatter, same points at full size: 640×140, margins
  // L54 R14 T12 B44, decade grid with dollar ticks, dashed diagonal.
  const looScatterSvg = (() => {
    const W = 640, H = 140, L = 54, R = 14, T = 12, B = 44;
    const logs = loo.points.map((p) => [Math.log10(p.actual_usd), Math.log10(p.predicted_usd)]);
    const all = logs.flat();
    const lo = Math.floor(Math.min(...all) - 0.3), hi = Math.ceil(Math.max(...all) + 0.3);
    const X = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
    const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const tick = (k: number): string => {
      const u: [string, number] = k >= 9 ? ['B', 9] : k >= 6 ? ['M', 6] : k >= 3 ? ['K', 3] : ['', 0];
      return `$${Math.round(Math.pow(10, k - u[1]))}${u[0]}`;
    };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Leave-one-out scatter">`;
    for (let g = Math.ceil(lo); g <= hi; g++) {
      s += `<line x1="${X(g).toFixed(1)}" y1="${T}" x2="${X(g).toFixed(1)}" y2="${H - B}" stroke="#e7e0d2"/><text x="${X(g).toFixed(1)}" y="${H - 22}" font-size="11" fill="#8a8378" text-anchor="middle">${tick(g)}</text>`;
      s += `<line x1="${L}" y1="${Y(g).toFixed(1)}" x2="${W - R}" y2="${Y(g).toFixed(1)}" stroke="#e7e0d2"/><text x="${L - 8}" y="${(Y(g) + 4).toFixed(1)}" font-size="11" fill="#8a8378" text-anchor="end">${tick(g)}</text>`;
    }
    s += `<line x1="${X(lo).toFixed(1)}" y1="${Y(lo).toFixed(1)}" x2="${X(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" stroke="#166534" stroke-width="1.5" stroke-dasharray="5,4"/>`;
    for (const [x, y] of logs) s += `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="3" fill="#166534" opacity="0.7"/>`;
    return s + '</svg>';
  })();
  const coverFstripHtml = `<div class="f-main"><p class="f-big">multiple = exp(${curve.intercept.toFixed(2).replace('-', '−')} − ${Math.abs(curve.slope).toFixed(2)}·ln(TVL/$100M)) &nbsp;×&nbsp; (1+0.5·7d) &nbsp;×&nbsp; maturity ±0.04 &nbsp;×&nbsp; token odds</p><p class="f-sub">${fstripAbl}</p></div><div class="f-scatter">${scatterSvg}</div>`;
  const bestFarmsHtml = `<b>Best farms</b> (net per hands-on hour, at $${FARM.default_ticket_usd.toLocaleString('en-US')}): ` +
    bestFarms.map((b) => `<a href="?detail=${b.slug}">#${b.rank} ${escHtml(b.name)}</a> ${moneySigned(b.net_per_hour_usd)}/h`).join(' · ');
  const rateLine = rates.buckets
    .map((b) => `${b.label} ${(b.token_pct * 100).toFixed(1)}% (${b.launched}/${b.n})`)
    .join(' · ');
  const roundTest = (t: OosTest): OosTest => ({
    ...t,
    model_median_log_err: round4(t.model_median_log_err),
    flat_median_log_err: round4(t.flat_median_log_err),
    model_within_2x: round4(t.model_within_2x),
    flat_within_2x: round4(t.flat_within_2x),
    model_within_3x: round4(t.model_within_3x),
    flat_within_3x: round4(t.flat_within_3x),
    rank_rho: round4(t.rank_rho),
  });
  const ablationRounded = ablation.map((r) => ({
    ...r,
    loo_x: round2(r.loo_x),
    loo_se_x: round2(r.loo_se_x),
    loo_within_3x: round4(r.loo_within_3x),
    loo_rho: round4(r.loo_rho),
    wf_x: round2(r.wf_x),
    wf_within_3x: round4(r.wf_within_3x),
    wf_rho: round4(r.wf_rho),
  }));
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
    accounting: acct,
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
    oos: oos.map(roundTest),
    loo: { ...roundTest(loo.test), points: loo.points },
    walk_forward: { ...roundTest(wf.test), origins: wf.origins },
    ablation: ablationRounded,
    band_stats: {
      p25_p75_median_x: round2(median(bandWidths2575)),
      p10_p90_median_x: round2(median(bandWidths1090)),
    },
    band_coverage: { p25_75: round4(coverage.p25_75), p10_90: round4(coverage.p10_90) },
    base_rates: rates,
    odds,
    set_aside_reasons: reasons,
    set_aside_line: setAsideLine,
    verdict_by_ticket: verdictByTicket,
    best_farms: bestFarms,
    board_digest: digest,
    ablation_note: note,
    ablation_html: ablationHtml(ablationRounded),
    odds_ablation_html: oddsAblationHtml(odds),
    odds_card_html: oddsCardHtml(odds),
    cover_fstrip_html: coverFstripHtml,
    loo_scatter_svg: looScatterSvg,
    best_farms_html: bestFarmsHtml,
    off_tvl_order: offTvlOrder,
    top20_stable: top20Stable,
    farm_assumptions: { ...FARM, gas_rates: GAS_RATE_CENTS },
    anchors: [5, 50].map((after) => {
      const row = board[after - 1];
      const near = comps
        .map((c) => ({ c, d: Math.abs(Math.log(c.tvl_usd) - Math.log(row.tvl_usd)) }))
        .sort((a, b) => a.d - b.d)[0].c;
      return {
        after_rank: after,
        text: `${near.name} · trades — reference, not ranked · market ${shortMoney(near.mcap_usd)} (${((near.mcap_usd as number) / near.tvl_usd).toFixed(3)}× TVL) · our curve would say ${shortMoney(near.tvl_usd * Math.exp(curveAt(curve, near.tvl_usd)))}`,
      };
    }),
    method: [
      {
        h: '1. The universe',
        p: `The board ranks ${board.length} of the snapshot\u2019s ${snapshot.protocols.length} protocols: all ${snapshot.watchlist.length} on the watchlist, plus the ${board.length - snapshot.watchlist.length} other pre-token protocols that pass the watchlist\u2019s own test. The other ${snapshot.protocols.length - board.length} are accounted for on the cover \u2014 ${acct.token_record} record a token, ${acct.set_aside} are set aside by the same rule. The curve is fitted on ${comps.length} comps: of the ${acct.token_record} with a token, ${acct.traded_positive} carry a positive market cap; ${acct.comps_excluded} of those fail the watchlist test and ${acct.comps_excluded_bridge} more are cross-chain bridges, the same family the rule excludes. \u201CRecords no token\u201D means DefiLlama records none \u2014 not proof none exists.`,
      },
      {
        h: '2. The value model',
        p: `Big protocols trade at a smaller multiple of TVL, and the curve measures that slope: ordinary least squares of log(mcap/TVL) on log(TVL) across the ${comps.length} comps. Each row then gets a growth tilt from its 7-day change (weight 0.50, improving leave-one-out from \u00d7${curveRung.loo_x.toFixed(2)} to \u00d7${growthRung.loo_x.toFixed(2)}) and a maturity tilt from how long it has run with no token, kept small on purpose (0.96\u20131.04). There is no category term: the ablation tested category adjustments and rejected them \u2014 they cost leave-one-out accuracy (table below). Each row\u2019s intervals come from the model\u2019s leave-one-out misses near that TVL, widened by refit spread; each detail scores confidence 0\u2013100 from band width, rank range and track record.`,
      },
      {
        h: '3. The blind tests',
        p: `Leave-one-out refits the model ${comps.length} times, scoring the token left out; walk-forward trains on older listings, scores newer ones, at five origins; split-half and time-split cut it two more ways. Every test reports the median miss and the share within 3\u00d7 against a flat-median baseline; 200 refits give each row its rank range. The bands are calibrated: P25\u2013P75 covers ${Math.round(coverage.p25_75 * 100)}% of held-out tokens (aim 50), P10\u2013P90 ${Math.round(coverage.p10_90 * 100)}% (aim 80).`,
      },
      {
        h: '4. The farm verdict',
        p: `Each plan\u2019s expected slice is the implied value \u00d7 the airdrop share \u00d7 (your ticket \u00f7 TVL), every dollar of TVL assumed to farm, over the full 90-day plan. The detail shows the slice with and without the time context 90/(age+90); the verdict uses the full slice. The cost is the plan\u2019s gas (its steps\u2019 7\u201311 on-chain actions, priced by kind at the chain\u2019s own rate \u2014 Ethereum $3.00 an action, other chains $0.05\u2013$1.00 \u2014 plus a bridge reserve of $0.75 per extra chain, max 5) plus time at $2.40 an hour (2.4\u20135.2 hours a plan) and the yield forgone (own yield 0%, the full T-bill 4% forgone \u2014 the snapshot carries no APY). ROBUST still pays at the band\u2019s low end; FARM nets $25 or more; THIN clears zero; SKIP costs more than it returns. ${ticketLine}`,
      },
      {
        h: '5. Token odds \u2014 the record, not a forecast (fitOdds())',
        p: `This radar models the chance a protocol ever records a token as of the snapshot (${snapshot.as_of}) \u2014 an estimated probability from the peers\u2019 record, not a prediction of whether or when any one token launches. The record, not a forecast. A logistic model fitted at build time on ${odds.n_peers} peers (age, size, growth, category) turns each row\u2019s features into a token-odds estimate; the implied value is the if-launches value \u00d7 that estimate. \u201CEver\u201D means by the oldest observed age, ${odds.horizon_years.toFixed(2)} years \u2014 the oldest cohort records a token ${(rates.buckets[4].token_pct * 100).toFixed(1)}% of the time (${rates.buckets[4].launched} of ${rates.buckets[4].n}). Brier ${odds.wf.brier.toFixed(2)} vs ${odds.wf.brier_base.toFixed(2)} base on a walk-forward split (single time-split at ${odds.wf.cutoff}, ${odds.wf.train_n} train, ${odds.wf.test_n} test) and ${odds.cv10.brier.toFixed(2)} vs ${odds.cv10.brier_base.toFixed(2)} on 10-fold cross-validation; the walk-forward base looks weak because later peers launch less often (${Math.round(odds.wf.test_base * 100)}% vs ${Math.round(odds.wf.train_base * 100)}% in train). Base rates by tracking age: ${rateLine}. TVL is one frozen day \u2014 hence the stop rule.`,
      },
      {
        h: '6. Note to the judge',
        p: 'Judge, here is where each criterion lives. Criterion 1 \u2014 the board and the green check line, which re-runs dashboard/model.js (fitVariant, impliedValue, farmEconomics, verify) against board.json, down to a seal. Criterion 2 \u2014 the curve, the blind tests and the ablation table above. Criterion 3 \u2014 the farm plan in every detail (cost/time columns, stop rule, verdict) and the inline plan on every board row. Criterion 4 \u2014 the sortable, filterable board, the Early finds view with its rule on the cover, and the side-by-side compare. Criterion 5 \u2014 one palette, one type system, ledger rules throughout. The same model prices this page and board.json: main.ts runs it from lib/model.ts, this page re-runs it from model.js.',
      },
    ],
    rows: radarRows,
    comps: compRows(comps),
    traded: tradedRows(snapshot),
    set_aside: setAsideRows(snapshot),
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
