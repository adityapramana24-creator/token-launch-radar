# Launch Radar v4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adityapramana24-creator/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adityapramana24-creator/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's `token-radar-01` bounty: it reads a sealed
DefiLlama snapshot, fits a value curve from the market's own traded tokens,
ranks every pre-token protocol by implied value, and shows how to farm each
one — on a static dashboard that renders with no network and re-runs the whole
model in the reader's browser.

## What it does

- **Covers the whole watchlist** (40 protocols with $50M+ TVL and no token on
  record) plus every other pre-token protocol that passes the watchlist's own
  test — no wrapped, staked or bridged product of a token that already trades
  (WBTC, USDT0 and the exchange bridges stay out), no exchange product, no
  versioned pool. 198 rows, not a top-40 list. The cover accounts for all 758
  protocols in the snapshot: 198 ranked + 416 recording a token + 144 set
  aside by the rule, with the per-reason counts on the cover
  (CEX 42 · Liquid Staking 38 · Bridge 28 · Canonical Bridge 15 ·
  versioned 11 · wrapped/staked 5 · Liquid Restaking 3 · Restaked BTC 2).
  The board opens with the three best farms by net per hour (Monolith Market,
  Manifest Trade, GoonFi — all ROBUST at the $5,000 default), shown as board
  rows above rank 1 with their true ranks, so the reader sees what pays
  before the ranking itself; the board below still ranks all 198 by implied
  value.
- **Puts the ablation on the cover**: below the formula, a three-line strip
  shows the shipped model against size-only and flat baselines
  (leave-one-out ×3.02 / ×3.27 / ×4.91, walk-forward ×2.10 / ×2.11 / ×4.49),
  the rejected terms (chains breadth: best LOO ×2.93, walk-forward collapsed
  to ×2.28; category offsets ×3.08), and the calibration (P25–P75 holds 50%,
  P10–P90 holds 78%, time-split ×2.06, top-20 20/20) — every number taken
  from the fitted model, so a reader who never scrolls still sees what was
  tested, what was rejected, and how the bands hold up.
- **Keeps a sidebar beside the board** (board and filtered views): how a row
  is valued in three sentences, FARM NEXT — the next three farms by net per
  hour after the cover's best three, computed live from the reader's ticket
  and share — and a mini leave-one-out scatter, the same 88 comps as the
  cover plot. The board section breaks out to full width so the sidebar costs
  no vertical space: 18 ranked rows stay visible on the cover.
- **Prices each row from a fitted curve, tested out of sample**: log(mcap/TVL)
  is regressed on log(TVL) across the 88 traded-token comps, with a growth
  tilt from the 7-day change and a small maturity tilt — no category term
  (the ablation tested category adjustments and rejected them).
  Leave-one-out (88 refits), walk-forward (5 origins), split-half and
  time-split tests, each against a flat-median baseline, plus an ablation
  table with an explicit keep/reject rule. Rank ranges come from 200 bootstrap
  refits; the intervals come from the model's own leave-one-out misses near
  each row's TVL.
- **Re-runs the model in the browser**: `dashboard/model.js` is the model,
  ported to the page. The green check line at the top is computed live — every
  rank, value, band, rank range, verdict and step the page shows is
  recomputed from the comps and compared against `board.json`.
- **Shows its work per row**: every protocol's page shows the derivation —
  TVL × curve multiple × growth tilt × maturity tilt — with two intervals
  (P25–P75 and P10–P90), a confidence score 0–100 from the band width, the
  rank range and the length of record, the four
  nearest traded comps with a cross-check, and its raw snapshot record, field
  for field. Every board row carries a one-line plan summary (the farm action,
  the chain it runs on, its gas, its hours and its horizon); clicking a row
  expands its eight-step plan inline, with each step's cost and time.
- **Nets every farm plan to the dollar, at the reader's ticket**: eight dated
  steps per protocol, each naming the protocol, its chain and its mechanism —
  the first step checks every chain the protocol runs on and names the
  cheapest, RWA and CeDeFi plans carry an identity-check step, and every plan
  logs its transaction hashes and re-reads the rewards terms before the
  Week-2 move. Each step shows its own cost and time in the detail view,
  summed to the plan total, plus a stop rule (unwind below twice the
  protocol's own 7-day swing, bounded 5–50%) and a ROBUST / FARM / THIN /
  SKIP verdict from the expected slice minus gas, time and the yield forgone
  net of the ticket's own yield, under stated assumptions. Gas and hours vary
  per protocol: the plan counts every on-chain action its steps name (7–11 by
  mechanism) at the chain's own rate from a stated per-chain table (Ethereum
  $3.00 an action, other chains $0.05–$1.00), plus a $0.75-per-extra-chain
  bridge reserve, and time at $2.40 an hour — plan hours run 2.4–5.2 hours
  across 14 distinct displayed values (16 exact), so the cover shows six
  different hour figures and ten different plan costs in its first 14 plan
  rows (three best farms plus ranks 1–11). The slice arithmetic shows the
  plan's time context explicitly — the share of the protocol's life the plan
  would cover if the token launched at plan end — as context only, never as
  a multiplier. The snapshot carries no APY, so the plan nets at the
  conservative end (own yield 0%, the full 4% T-bill forgone) and the detail
  shows the forgone range. At the $5,000 default ticket the book reads 31
  ROBUST · 99 FARM · 23 THIN · 45 SKIP, net $17,543 over 925.3 hours. Ticket
  ($500–$10K) and airdrop share (5–20%) controls recompute every slice, net
  and verdict; the board shows slice, net, break-even launch value and net
  per hour.
- **Separates live from pre-token**: traded tokens sit in their own tab with
  their market caps shown, never mixed into the ranking, and traded reference
  anchors appear inline on the board (after ranks 5 and 50). The cover scatter shows all 88 comps'
  leave-one-out predictions against their actual market caps.
- **Lets the reader compare**: sort the board by clicking a column heading
  (the sorted column carries an arrow) or from the sort control, filter it,
  expand a row's plan inline, open any protocol's detail view, and put two
  protocols side by side.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes `board.json`,
  `data.js`, `dashboard/`, `screenshots/` and `dossier.json`.
- `lib/model.ts` — the fitted model, the out-of-sample tests, the ablation,
  the bootstrap rank ranges, the bands, the farm plans and the snapshot parser.
- `dashboard/` — the static page (`index.html`, `ledger.css`, `ledger.js`,
  `model.js`). Source is 65,114 bytes, inside the 65,536-byte dossier text
  cap (dossier text 65,469 bytes; dossier.json 706,839 bytes, inside the
  1,572,864-byte cap).
- `screenshots/` — the board (with the sidebar beside it), a detail view, a
  filtered view (14 rows, verdict FARM in Risk Curators, sorted by net per
  hour) with one row expanded inline (full 8-step grid open), the farm book
  and a side-by-side compare, and Method + backtest. The four renders are
  stored as single-line base64 text (`*.png.b64`, as in a data URI) so the
  repository stays text-only; `main.ts` decodes them back into real PNGs in
  `/output`.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (or newer), standard library only. Fully deterministic: the same
snapshot always produces the same bytes (verified: two runs byte-identical).

## The model

```
comps      = 88 traded-token protocols (mcap + TVL, passing the watchlist test;
             the 4 cross-chain bridges are excluded — the watchlist rule already
             excludes bridges under another label, and fitting them costs 3.7%
             of leave-one-out accuracy on the same 88 test tokens)
size curve = OLS of log(mcap/TVL) on log(TVL) across the comps
growth     = 1 + 0.50 x clamp(change_7d, -50, 100) / 100   (weight 0.50, stated tilt)
maturity   = 0.96 + 0.08 x min(age_days, 1095) / 1095       (range 0.96–1.04, stated tilt)
multiple   = exp(size curve) x growth x maturity
implied    = round(tvl_usd x multiple)
bands      = implied x exp(local LOO miss quantiles), widened by refit spread
rank range = P10–P90 rank across 200 bootstrap refits (seed 20261114)
```

Farm verdict: expected slice = implied × 10% airdrop share ×
(ticket ÷ TVL), every dollar of TVL assumed to farm; net = slice − plan cost
(gas for every on-chain action the steps name — 7–11 by mechanism, at the
chain's own rate from a stated per-chain table (Ethereum $3.00 an action,
other chains $0.05–$1.00), plus a $0.75-per-extra-chain bridge reserve,
max 5 — + time at $2.40 an hour (2.4–5.2 hours a plan: the steps' own
times — 2 minutes to sign each on-chain action, 5 minutes per extra chain
checked before funding, capped at five) + yield forgone, net of the yield
the ticket earns while farmed: the snapshot carries no APY, so the plan nets
at the conservative end — own yield 0%, the full 4% T-bill forgone — and the
detail shows the range). ROBUST when the net is still positive at the band's
low end, FARM at net ≥ $25, THIN at net ≥ $0, else SKIP. Break-even is stated
as a launch value in dollars.

Blind-test results (computed at runtime from the snapshot): leave-one-out
×3.02 vs ×4.91 flat, walk-forward ×2.10 vs ×4.49 flat, split-half ×2.14 vs
×3.78 flat, time-split ×2.06 vs ×4.69 flat. Bands are calibrated, not
assumed: P25–P75 covers 50% of held-out tokens (aim 50) and P10–P90 covers
78% (aim 80); the top 20 hold 20/20 in 200 refits. The v3.2 shootout tested
19 variants against pre-frozen selection bars (LOO improves ≥0.05× on the
same test tokens, walk-forward no worse than ×1.02, split-half no worse than
5%): only the 88-comp set passed, and its paired bootstrap CI still includes
0 — so the tilts are kept small and the improvement is reported as a median
win, not a proven mean win. The ablation rejected the 92-comp fit, both
category shrinks, chains breadth (best LOO ×2.93, walk-forward collapsed to
×2.28), Huber and a wider maturity range.

Implied value is this entry's own claim, never make.fun's, and no launch is
predicted. "Records no token" means DefiLlama records no token for the
protocol; it is not proof none exists.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5435dmkf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
