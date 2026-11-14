# Launch Radar

A token launch radar for make.fun's `token-radar-01` bounty: it reads a sealed
DefiLlama snapshot and ranks every pre-token protocol by implied value, with a
farm plan for each, on a static dashboard that renders with no network.

## What it does

- **Covers the whole watchlist** (40 protocols with $50M+ TVL and no token on
  record) plus every other pre-token protocol that passes the watchlist's own
  test — no wrapped, staked or bridged product of a token that already trades
  (WBTC, USDT0 and the exchange bridges stay out), no exchange product, no
  versioned pool. About 250 rows, not a top-40 list.
- **Prices each row from the market**: the multiple is the median
  market-cap-to-TVL ratio of the live-token protocols in the row's own
  category, recomputed from the snapshot on every run. Growth, age with no
  token and chain breadth then move it. No protocol name is special-cased.
- **Separates live from pre-token**: live-token protocols sit in their own
  tab with their market caps shown, never mixed into the ranking.
- **Plans the farm**: six steps per protocol with a cost and a time, derived
  from its category, chain, size and age — including chain-aware gas.
- **Lets the reader try the model**: two sliders reprice the board live.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes `board.json`,
  `data.js`, `dashboard/`, `screenshots/` and `dossier.json`.
- `lib/model.ts` — the model, the farm plans and the snapshot parser.
- `dashboard/` — the static page (`index.html`, `radar.css`, `radar.js`).
- `screenshots/` — the board, a detail view and a filtered view. The three
  renders are stored as single-line base64 text (`*.png.b64`, as in a data
  URI) so the repository stays text-only; `main.ts` decodes them back into
  real PNGs in `/output`.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (or newer), standard library only. Fully deterministic: the same
snapshot always produces the same bytes.

## The model

```
multiple   = median mcap/TVL of live protocols in the category
             (global median when the category has too few live names),
             clamped to [0.05, 2.00]
growth     = clamp(change_7d, -50, 100); null counts as 0
growthMult = 1 + (growth / 100) x 0.5
maturity   = 0.55 + 0.45 x sqrt(min(age_days, 1095) / 1095)
breadth    = 1 + 0.02 x min(chains, 10)
implied    = round(tvl_usd x multiple x growthMult x maturity x breadth)
```

Implied value is this entry's own claim, never make.fun's, and no launch is
predicted. "Records no token" means DefiLlama records no token for the
protocol; it is not proof none exists.
