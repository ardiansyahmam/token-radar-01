# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ardiansyahmam/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ardiansyahmam/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — a dashboard that ranks pre-token protocols by implied value, computed from a frozen DefiLlama snapshot (14 Nov 2026, 758 protocols, 40 on the watchlist), with a concrete farm plan for each protocol. Implied value is a model estimate, not a price, not a promise, and not a prediction of when — or whether — a token will launch. "No token recorded is not proof that no token exists."

## Run it

Requires Node 22, standard library only — no dependencies to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

This writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies the dashboard and screenshots into `out/`. Open the dashboard from `out/dashboard/index.html` (static files, no network needed).

## Model

Each pre-token protocol gets an implied value

```
V = round(TVL × R_category × F_growth × F_age × F_chains)
```

- **R_category** — median mcap/TVL of the traded anchors in the same category, shrunk toward the global median with prior 8, capped at 3.0. A category with no anchor falls back to the global median.
- **F_growth** — `1 + clamp(change_7d, −50, +50) / 200` (0.75–1.25; 1 when unknown).
- **F_age** — `1 + 0.15 × min(days tracked / 730, 1)` (1 when the listing date is unknown).
- **F_chains** — `1 + 0.025 × min(max(chains − 1, 0), 4)` (max +10%).

The board has 200 rows: 40 watchlist rows plus 160 early rows. Traded anchors are never ranked — they only calibrate the category ratios. The program is fully deterministic: no clock, no randomness, no network; two runs over the same snapshot write byte-identical output.

<sub>Entered on [make.fun](https://make.fun/?ref=m4e2jcyf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
