# Launch Radar v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adityapramana24-creator/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adityapramana24-creator/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's `token-radar-01` bounty: it reads a sealed
DefiLlama snapshot, fits a value curve from the market's own traded tokens,
ranks every pre-token protocol by implied value, and shows how to farm each
one — on a static dashboard that renders with no network.

## What it does

- **Covers the whole watchlist** (40 protocols with $50M+ TVL and no token on
  record) plus every other pre-token protocol that passes the watchlist's own
  test — no wrapped, staked or bridged product of a token that already trades
  (WBTC, USDT0 and the exchange bridges stay out), no exchange product, no
  versioned pool. 198 rows, not a top-40 list.
- **Prices each row from a fitted curve, tested out of sample**: log(mcap/TVL)
  is regressed on log(TVL) across the 92 traded-token comps, with a shrunk
  category adjustment per row. The model is refit on half the comps and scored
  on the half it never saw (split-half and time-split tests, each against a
  flat-median baseline), and the curve is bootstrapped 200 times. The dashboard
  shows the test results, not just the claims.
- **Shows its work per row**: every protocol's page shows the derivation —
  TVL × curve multiple × category adjustment × growth tilt × maturity tilt —
  with an 80% interval from the fit's residual dispersion.
- **Nets every farm plan to the dollar**: six steps per protocol with a cost
  and a time, plus a FARM / THIN / SKIP verdict from the expected farmer share
  of the implied value minus the plan's gas and time, under stated
  assumptions.
- **Separates live from pre-token**: traded tokens sit in their own section
  with their market caps shown, never mixed into the ranking. The scatter plot
  shows all 92 comps against the fitted curve.
- **Lets the reader compare**: sort and filter the board, open any protocol's
  detail view, and put two protocols side by side.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes `board.json`,
  `data.js`, `dashboard/`, `screenshots/` and `dossier.json`.
- `lib/model.ts` — the fitted model, the out-of-sample tests, the farm plans
  and the snapshot parser.
- `dashboard/` — the static page (`index.html`, `ledger.css`, `ledger.js`).
- `screenshots/` — the board, a detail view, a filtered view and the fitted
  curve. The four renders are stored as single-line base64 text (`*.png.b64`,
  as in a data URI) so the repository stays text-only; `main.ts` decodes them
  back into real PNGs in `/output`.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (or newer), standard library only. Fully deterministic: the same
snapshot always produces the same bytes.

## The model

```
comps      = 92 traded-token protocols (mcap + TVL, passing the watchlist test)
size curve = OLS of log(mcap/TVL) on log(TVL) across the comps
catAdj     = category median residual off the curve, shrunk n/(n+5);
             nothing for a category with fewer than 2 traded comps,
             clamped to ±0.7 log units (at most ×2 either way)
growth     = 1 + 0.25 x clamp(change_7d, -50, 100) / 100   (stated tilt, ±25%)
maturity   = 0.85 + 0.30 x min(age_days, 1095) / 1095       (stated tilt)
multiple   = exp(size curve + catAdj) x growth x maturity
implied    = round(tvl_usd x multiple)
80% band   = implied x exp(±1.2816 x residual SD)
```

Farm verdict: expected gross = implied × 15% farmer allocation ×
(capital ÷ (TVL × 5% actively farming)), ×1.5 for protocols listed under a
year ago; net = gross − plan cost (setup gas + 4 weeks of weekly gas + claim
gas + time). FARM at net ≥ $25, THIN at net ≥ $0, else SKIP.

Implied value is this entry's own claim, never make.fun's, and no launch is
predicted. "Records no token" means DefiLlama records no token for the
protocol; it is not proof none exists.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5435dmkf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
