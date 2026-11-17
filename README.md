# Pre-TGE Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ardiansyahmam/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ardiansyahmam/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Pre-TGE Radar — a dashboard that ranks pre-token protocols by implied value, computed from a frozen DefiLlama snapshot (14 Nov 2026, 758 protocols, 40 on the watchlist), with a concrete, costed farm plan for each protocol. Implied value is a model estimate, not a price, not a promise, and not a prediction of when — or whether — a token will launch. "No token recorded is not proof that no token exists."

## Run it

Requires Node 22, standard library only — no dependencies to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

This writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies the dashboard and screenshots into `out/`. Open the dashboard from `out/dashboard/index.html` (static files, no network needed).

## Model (radar-3)

Each pre-token protocol gets an implied value

```
V = round( 10^(a + b·log10(TVL) + offset_category) × F_growth × F_age × F_chains )
```

- **Fit** — OLS on the 128 traded anchors: log10(mcap) = a + b·log10(TVL), a = 3.0247, b = 0.5223. Market cap grows with the square root of TVL: ten times the TVL is worth only about 3.3× as much, so a flat multiple would overprice the big and underprice the small.
- **Offset** — per-category median residual (log10(mcap) minus the fitted line), shrunk toward 0 with prior 8: offset = (median × n) / (n + 8), clamped to [−1, +1]. A category with no anchor gets offset 0.
- **R_category** — the fitted multiple at the protocol's own TVL: 10^(a + b·log10(TVL) + offset) / TVL. It bends with size, so it is per-row, not per-category.
- **F_growth** — `1 + clamp(change_7d, −50, +50) / 200` (0.75–1.25; 1 when unknown).
- **F_age** — `1 + 0.15 × min(days tracked / 730, 1)` (1 when the listing date is unknown).
- **F_chains** — `1 + 0.025 × min(max(chains − 1, 0), 4)` (max +10%).
- **Band** — implied × 10^q25 to × 10^q75 of the residuals over all 128 anchors (×0.30–×4.09): the middle half of the market's own scatter, a sensitivity range, not a confidence interval.

## Validation

- **Leave-one-out (n=128):** median error factor ×4.0 (p75 ×8.5), 32% of predictions within 2× of the true market cap, 45% within 3×. The radar-2 approach (per-category median mcap/TVL, also left out) manages only ×5.1 median.
- **Time-split:** fit on the 47 older anchors, tested on the 48 newer (cutoff 2024-02-18): median ×3.1, 33% within 2×, 50% within 3×. Radar-2 on the same split: ×5.4. 33 anchors were excluded from the split because listed_at is null.
- The market's scatter is wide: even the better model is typically off by a factor of three to four. Implied value ranks protocols; it does not price them.

## Farm economics

- **Allocation** — the low band × 0.00075 (0.075%): the assumed one-wallet share if the token launches. A planning figure, not a promise; doubling the share halves every break-even odds.
- **Total cost** — capital (tiered by TVL: $50 / $100 / $150 / $250) plus gas: 2 + ceil(hold days / 7) + 1 transactions at $5 each, the midpoint of the $2–$8 range (the low/high totals use $2 and $8).
- **Net (if launch)** = allocation − total cost. **Break-even odds** = total cost / allocation: the launch probability at which farming breaks even.
- **Farming** — odds ≤ 2%; **Marginal** — ≤ 5%; **Skip** — above 5%. On this snapshot: 18 Farming, 79 Marginal, 101 Skip.

## Board

The board has 198 rows: 40 watchlist rows plus 158 early rows. 342 pre-token protocols were audited (198 ranked + 144 screened products set aside). Traded anchors are never ranked — they only calibrate the fit. Ranked (198) + already trade (128) + set aside (432) = 758 protocols. The program is fully deterministic: no clock, no randomness, no network; two runs over the same snapshot write byte-identical output.

<sub>Entered on [make.fun](https://make.fun/?ref=m4e2jcyf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
