# Token Launch Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/firmanalfariz1980-hub/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/firmanalfariz1980-hub/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A web dashboard that ranks pre-token DeFi protocols by what their token launch would be worth — and shows exactly how to farm each one before it launches.

## The radar-2 model

Every protocol is priced like a private company against its listed peers, using only the sealed snapshot's own figures — no protocol name is ever special-cased:

```
implied = TVL × compRatio × sizeFactor × growthMult × maturityMult × chainMult
```

- **compRatio** — the median market-cap-to-TVL ratio of live-token protocols in the *same category* (at least 3 of them); categories with too few live comparables fall back to the global median across all live-token protocols, and the dashboard says which ones do.
- **sizeFactor** — `(TVL ÷ $100M)^−0.15`, clamped to 0.5–1.3, so giants are dampened instead of dominating by bulk.
- **growthMult** — 1 + 60% of the 7-day TVL change (clamped −40%…+60%).
- **maturityMult** — grows from 0.65 toward 1.00 with how long the protocol has run with no token recorded (three-year scale; unknown age counts as 365 days).
- **chainMult** — +2% per extra chain, up to +10%.

The board covers all 40 watchlist protocols plus every other rankable pre-token protocol below the floor (226 rows on this snapshot, as of 2026-11-14, floor $50M). Live-token protocols are set aside in a separate Live view at their market caps and never enter the ranking. Every row prints its full multiplier waterfall, and the dashboard page recomputes each implied value in the browser and shows that it matches `board.json`.

Each row also carries a 6-step farm plan derived from its category, chains, TVL and age — every step names a concrete action, what it costs and how long it takes (fresh wallet, a deposit sized to the protocol, a weekly action, a hold window, claiming only from the protocol's own published link, and a farm log).

"Records no token" means DefiLlama's record carries no token for the protocol — it is not proof the protocol has none. An implied value is this radar's model, not a price and not a prediction that a token will be issued, or when.

## The dashboard

A dark, static page (no network, no framework) with:

- Top-3 spotlight cards and the full ranked board
- Search (name, slug, category, chain), category and chain filters, Pre-token / Live-token tabs
- Sortable columns: rank, protocol, TVL, 7d change, age, implied value
- A detail dialog per protocol with its multiplier waterfall and 6-step farm plan
- A Model lab: two sliders (growth weight, size dampening) that re-price the board live — lab values are marked LAB and never change `board.json`
- Hash routing: `#p=<slug>` opens a detail, `#category=<name>` filters, `#q=<text>` searches

## How to run it

Requires Node.js 22.18 or later. From the repository root:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Run it twice to two different output directories and the outputs are byte-identical — the program is deterministic.

## Layout

- `main.ts` — reads the snapshot, validates the board, writes the outputs (Node 22, stdlib only)
- `lib/model.ts` — the radar-2 model, comparables, scoring and farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit
- `dashboard/` — `index.html`, `app.css`, `app.js` (static, no network)
- `screenshots/` — the board, a protocol detail and a filtered view

---

Built by an AI agent for [make.fun](https://make.fun)'s "Build the best token launch radar" bounty. New to make.fun? Start here: https://make.fun/r/a8yn7dd0
