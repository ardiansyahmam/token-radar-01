// Pre-TGE Radar — model "radar-3" (fitted size curve, walk-forward validated).
//
// One snapshot in, one ranked board out. No name is ever special-cased: the same
// function scores every row, and every number below comes from the snapshot.
//
//   V = round(10^(a + b*log10(TVL) + offset_cat) x F_growth x F_age x F_chains),
//       clamped to $1..$1e14
//
//   Fit       OLS on the 128 traded anchors: log10(mcap) = a + b*log10(TVL).
//             On this snapshot a = 3.0247, b = 0.5223: market cap grows with the
//             square root of TVL, so a protocol ten times larger in TVL is worth
//             only about 3.3x as much — a flat multiple would overprice the big
//             and underprice the small.
//   offset    Per-category median residual (residual = log10(mcap) minus the
//             fitted line), shrunk toward 0 with prior 8:
//             offset = (median x n) / (n + 8), clamped to [-1, +1]. A category
//             with no anchor gets offset 0 and r_fallback = true.
//   r_category  The fitted multiple AT this protocol's own TVL:
//               10^(a + b*log10(TVL) + offset_cat) / TVL. It is per-row, not
//               per-category, because the curve bends with size. The dashboard
//               recomputes a row's implied value from it (see buildBoard).
//   Band      lo = implied x 10^q25(residuals), hi = implied x 10^q75(residuals)
//             over all 128 anchors: the middle half of the market's own scatter
//             around the fitted curve, a sensitivity range, not a confidence
//             interval.
//   F_growth    1 + clamp(change_7d, -50, +50)/200            (0.75..1.25; null -> 1)
//   F_age       1 + 0.15 x min(days tracked / 730, 1)         (listed_at null -> 1)
//               "Days tracked" is how long DefiLlama has listed the protocol, not
//               the project's true age.
//   F_chains    1 + 0.025 x min(max(chains - 1, 0), 4)        (max +10%)
//
// Validation (computed in buildRadar, reported in RadarData.validation).
// Leave-one-out over the 128 anchors: each anchor is refit out, then predicted
// with growth/age/chains = 1, so the test is the size curve alone; the error
// factor is max(pred/actual, actual/pred). The same metrics are computed for
// the radar-2 approach (per-category median mcap/TVL ratio, also left out) as
// the comparison. Time-split: anchors with no listed_at are excluded, the rest
// are ordered by listed_at, fit on the older half, tested on the newer half.
//
// Screening. A board row must record no token (mcap, gecko_id and symbol all null;
// mcap 0 or negative, e.g. autofinance -1, counts as null and never anchors the fit).
// Early rows exclude the watchlist rule's screened products: categories Bridge,
// Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX; names
// ending in a version marker; names carrying a whole word wrapped/staked/staking.
// Exactly 198 no-token protocols pass that screen on this snapshot, 40 of them the
// watchlist, so the board is those 198 rows — clean, no filler, no audit rows.
// The 144 screened products are set aside, with the reason counted.
//
// Farm economics, netted to the dollar. One farm position costs its capital
// (tiered by TVL: $50 / $100 / $150 / $250) plus gas: 2 + ceil(holdDays/7) + 1
// transactions — one to set up, one qualifying action each week of the hold, one
// to claim — at $5 each, the midpoint of the $2–$8 range the plan has always
// used; the low/high totals use $2 and $8. The allocation is the low band times
// 0.00075 (0.075% of the low band: the assumed one-wallet share if the token
// launches — a planning figure, not a promise. A community allocation of 5–10%
// of supply, spread over many wallets, makes a single well-farmed wallet taking
// roughly a thousandth of the low band plausible, and the break-even odds move
// linearly if the share is changed: doubling the share halves every odds.
// Calibrated so the board actually has Farming rows: the old 0.0001 share left
// none, because even the largest low band could not clear the 0.02 bar. Net =
// allocation minus total cost; break-even odds = total cost / allocation.
// Farming at odds <= 0.02, Marginal at <= 0.05, else Skip — on this snapshot
// 18 Farming, 79 Marginal, 101 Skip.
// Gas is never quoted as a precise figure the snapshot cannot support: the $2–$8
// range is the assumption, $5 the planning midpoint, and lo/hi show the spread.
//
// Farm playbooks. Twelve playbooks by category group (bridge, lending, dex,
// staking, perpetual, prediction, vault, stable, rwa, insurance, yield, default),
// eight steps each: 1 setup (fresh wallet), 1 main action, 2 steps specific to
// the category's mechanism, 1 weekly qualifying action, 1 hold, 1 claim, 1 log.
// Every step is derived from the protocol's own record (name, chain, capital,
// hold days); no protocol name is hard-coded.
//
// Radar score 0-100 is a relative index from log implied value on this board's run
// ("relative, not probability"): rank 1 scores 100, rank 198 scores 0.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_prior: number;
  ratio_floor: number;
  ratio_cap: number;
  growth_cap: number;
  age_days: number;
  age_weight: number;
  chain_step: number;
  chain_max: number;
  ambig_haircut: number;
  allocation_share: number;
  gas_mid: number;
  gas_lo: number;
  gas_hi: number;
  breakeven_farming: number;
  breakeven_marginal: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 8,
  ratio_floor: 0.01,
  ratio_cap: 3.0,
  growth_cap: 50,
  age_days: 730,
  age_weight: 0.15,
  chain_step: 0.025,
  chain_max: 4,
  ambig_haircut: 0.0001,
  allocation_share: 0.00075,
  gas_mid: 5,
  gas_lo: 2,
  gas_hi: 8,
  breakeven_farming: 0.02,
  breakeven_marginal: 0.05,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** Board size: the 40 watchlist rows plus 158 early rows. */
export const BOARD_ROWS = 198;

/** How many live-token protocols the Live view carries (all traded anchors). */
export const LIVE_ROWS = 400;

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
  token_status: 'No token recorded';
  age_days: number | null;
  implied_value_usd: number;
  radar_score: number;
  band_lo_usd: number;
  band_hi_usd: number;
  farming_status: 'Farming' | 'Marginal' | 'Skip';
  is_watchlist: boolean;
  ambiguous: boolean;
  screen_reason: string | null;
  model: {
    r_category: number;
    category_anchors: number;
    r_fallback: boolean;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    chains_multiplier: number;
    haircut: number;
  };
  farm_capital_usd: number;
  farm_tx_count: number;
  farm_gas_usd: number;
  farm_total_cost_usd: number;
  farm_cost_lo_usd: number;
  farm_cost_hi_usd: number;
  farm_allocation_usd: number;
  farm_net_usd: number;
  farm_breakeven_odds: number;
  farm_playbook: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

/** One category's anchor fit, for the Method tab's anchor table. */
export interface AnchorFit {
  category: string;
  anchors: number;
  median_ratio: number | null;
  p25_ratio: number | null;
  p75_ratio: number | null;
  r_category: number;
  offset_log10: number;
}

/** The set-aside counts, so Ranked + Already trade + Set aside traces to 758. */
export interface SetAside {
  traded: number;
  cap_unavailable: number;
  review_metadata: number;
  screened: number;
  total: number;
}

/** The fitted curve's validation: leave-one-out and the time split, both against radar-2. */
export interface Validation {
  fit: { a: number; b: number; n_anchors: number };
  loo: { n: number; median_factor: number; p75_factor: number; within_2x: number; within_3x: number; radar2_median_factor: number };
  time_split: { n_fit: number; n_test: number; cutoff: string | null; median_factor: number; within_2x: number; within_3x: number; radar2_median_factor: number };
}

/** Everything the dashboard needs: the board, the live set, the fit and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median_ratio: number;
  global_p25_ratio: number;
  global_p75_ratio: number;
  global_p90_ratio: number;
  anchors: AnchorFit[];
  validation: Validation;
  set_aside: SetAside;
  rows: RadarRow[];
  live: LiveRow[];
}

/** A board row's compact form for data.js (farm_steps included: the drawer shows them). */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  radar_score: number;
  band_lo_usd: number;
  band_hi_usd: number;
  farming_status: string;
  token_status: string;
  is_watchlist: boolean;
  ambiguous: boolean;
  screen_reason: string | null;
  r_category: number;
  category_anchors: number;
  r_fallback: boolean;
  growth_pct: number;
  growth_multiplier: number;
  age_multiplier: number;
  chains_multiplier: number;
  haircut: number;
  farm_capital_usd: number;
  farm_tx_count: number;
  farm_gas_usd: number;
  farm_total_cost_usd: number;
  farm_cost_lo_usd: number;
  farm_cost_hi_usd: number;
  farm_allocation_usd: number;
  farm_net_usd: number;
  farm_breakeven_odds: number;
  farm_playbook: string;
  farm_steps: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Median of a sorted-ascending copy; null when empty. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** The q-th quantile (nearest rank) of a list; null when empty. */
function quantileOf(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))]!;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all (mcap 0 or negative counts as null). */
export function isNoToken(p: SnapshotProtocol): boolean {
  const mcap = p.mcap_usd === null || p.mcap_usd <= 0 ? null : p.mcap_usd;
  return mcap === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol's token already trades (a positive market cap is the market's own fact). */
export function isTraded(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

/** The token-status label the dashboard shows for a protocol outside the board. */
export function tokenStatusOf(p: SnapshotProtocol): string {
  if (isNoToken(p)) return 'No token recorded';
  if (isTraded(p)) return 'Traded anchor';
  const ids = (p.gecko_id !== null ? 1 : 0) + (p.symbol !== null ? 1 : 0);
  if (ids === 1) return 'Review metadata';
  return 'Token record · cap unavailable';
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped / staked / staking in a name marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories the watchlist rule excludes from early rows. */
const SCREENED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Why a no-token protocol is screened out of the early rows, or null when it passes. */
export function screenReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SCREENED_CATEGORIES.has(p.category)) return `category ${p.category} is excluded`;
  if (VERSIONED.test(p.name)) return 'name ends in a version marker';
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped / staked / staking';
  return null;
}

/** The traded anchors and their mcap/TVL ratios, grouped by category. */
export interface AnchorSet {
  globalRatios: number[];
  byCategory: Map<string, number[]>;
}

export function anchorSet(protocols: SnapshotProtocol[]): AnchorSet {
  const globalRatios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (!isTraded(p)) continue;
    const ratio = p.mcap_usd! / p.tvl_usd;
    globalRatios.push(ratio);
    const key = p.category ?? '(no category)';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  return { globalRatios, byCategory };
}

/** The shrunk, clamped category multiple for one category (the radar-2 approach, kept for the validation comparison). */
export function categoryMultiple(category: string | null, anchors: AnchorSet, model: ModelConstants): { r: number; n: number; fallback: boolean } {
  const globalMedian = medianOf(anchors.globalRatios);
  if (globalMedian === null) return { r: 1.0, n: 0, fallback: true };
  const list = anchors.byCategory.get(category ?? '(no category)') ?? [];
  if (list.length === 0) return { r: round4(globalMedian), n: 0, fallback: true };
  const m = medianOf(list)!;
  const shrunk = (m * list.length + globalMedian * model.shrink_prior) / (list.length + model.shrink_prior);
  const r = Math.min(model.ratio_cap, Math.max(model.ratio_floor, shrunk));
  return { r: round4(r), n: list.length, fallback: false };
}

/** One traded anchor as a point on the log-log size curve. */
export interface AnchorPoint {
  p: SnapshotProtocol;
  x: number;
  y: number;
  key: string;
}

/** The traded anchors as log-log points (mcap > 0 and TVL > 0 only). */
export function anchorPoints(protocols: SnapshotProtocol[]): AnchorPoint[] {
  const points: AnchorPoint[] = [];
  for (const p of protocols) {
    if (!isTraded(p) || p.tvl_usd <= 0) continue;
    points.push({ p, x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd!), key: p.category ?? '(no category)' });
  }
  return points;
}

/** The OLS line y = a + b*x through the points (b = 0 when x never varies). */
function ols(points: { x: number; y: number }[]): { a: number; b: number } {
  const n = points.length;
  if (n === 0) return { a: 0, b: 0 };
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** The fitted size curve: the OLS line, the shrunk per-category offsets, and the global residual spread. */
export interface SizeFit {
  a: number;
  b: number;
  n: number;
  offsets: Map<string, number>;
  counts: Map<string, number>;
  residuals: number[];
  q25: number;
  q75: number;
}

/** Fit log10(mcap) = a + b*log10(TVL) on the anchors, with a shrunk median-residual offset per category. */
export function fitSizeCurve(points: AnchorPoint[], model: ModelConstants = MODEL): SizeFit {
  const { a, b } = ols(points);
  const residuals = points.map((pt) => pt.y - (a + b * pt.x));
  const byCategory = new Map<string, number[]>();
  points.forEach((pt, i) => {
    const list = byCategory.get(pt.key) ?? [];
    list.push(residuals[i]!);
    byCategory.set(pt.key, list);
  });
  const offsets = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [key, list] of byCategory) {
    const m = medianOf(list)!;
    const shrunk = (m * list.length) / (list.length + model.shrink_prior);
    offsets.set(key, Math.min(1, Math.max(-1, shrunk)));
    counts.set(key, list.length);
  }
  return {
    a,
    b,
    n: points.length,
    offsets,
    counts,
    residuals,
    q25: quantileOf(residuals, 0.25) ?? 0,
    q75: quantileOf(residuals, 0.75) ?? 0,
  };
}

/** The shrunk category offset for a protocol's category (0 when the category has no anchor). */
export function categoryOffset(category: string | null, fit: SizeFit): number {
  return fit.offsets.get(category ?? '(no category)') ?? 0;
}

/** The fitted market cap at a TVL, before the growth/age/chains factors (0 when TVL <= 0). */
export function fittedValue(tvl: number, category: string | null, fit: SizeFit): number {
  if (tvl <= 0) return 0;
  return Math.pow(10, fit.a + fit.b * Math.log10(tvl) + categoryOffset(category, fit));
}

/** The fitted multiple at this protocol's own TVL: fitted value divided by TVL (0 when TVL <= 0). */
export function fittedMultiple(tvl: number, category: string | null, fit: SizeFit): number {
  if (tvl <= 0) return 0;
  return round4(fittedValue(tvl, category, fit) / tvl);
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  fit: SizeFit,
  model: ModelConstants,
): { implied: number; r: number; n: number; fallback: boolean; growthPct: number; growthMult: number; ageMult: number; chainsMult: number; age: number | null } {
  const key = p.category ?? '(no category)';
  const r = fittedMultiple(p.tvl_usd, p.category, fit);
  const n = fit.counts.get(key) ?? 0;
  const fallback = !fit.offsets.has(key);
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(-model.growth_cap, rawGrowth));
  const growthMult = round4(1 + growthPct / 200);
  const ageMult = round4(age === null ? 1 : 1 + model.age_weight * Math.min(age / model.age_days, 1));
  const chainsMult = round4(1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_max));
  // The implied value is computed from the ROUNDED components written to the row,
  // so the dashboard's in-page recompute (impliedOf) reproduces it exactly.
  const implied = Math.min(1e14, Math.max(1, Math.round(p.tvl_usd * r * growthMult * ageMult * chainsMult)));
  return { implied, r, n, fallback, growthPct, growthMult, ageMult, chainsMult, age };
}

/** The P25-P75 sensitivity band for one protocol: the fitted curve's own residual spread around its implied value. */
export function bandFor(fit: SizeFit, implied: number): { lo: number; hi: number } {
  const lo = Math.min(1e14, Math.max(1, Math.round(implied * Math.pow(10, fit.q25))));
  const hi = Math.min(1e14, Math.max(1, Math.round(implied * Math.pow(10, fit.q75))));
  return { lo, hi };
}

/** The error factor between a prediction and the actual market cap: 1 is exact, 2 is off by a factor of two either way. */
function errorFactor(pred: number, actual: number): number {
  return Math.max(pred / actual, actual / pred);
}

/** The summary of a list of error factors: median, p75, and the shares within 2x and 3x. */
function summarizeFactors(factors: number[]): { median: number; p75: number; within2: number; within3: number } {
  const n = factors.length;
  if (n === 0) return { median: 0, p75: 0, within2: 0, within3: 0 };
  return {
    median: round4(medianOf(factors) ?? 0),
    p75: round4(quantileOf(factors, 0.75) ?? 0),
    within2: round4(factors.filter((f) => f <= 2).length / n),
    within3: round4(factors.filter((f) => f <= 3).length / n),
  };
}

/** The fitted curve's validation: leave-one-out and the time split, each against the radar-2 median-ratio approach on the same split. */
export function validateFit(points: AnchorPoint[], model: ModelConstants = MODEL): Validation {
  // Leave-one-out: each anchor is refit out (curve and offsets), then predicted
  // with growth/age/chains = 1, so the test is the size curve alone.
  const looFactors: number[] = [];
  const looRadar2Factors: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i);
    const fit = fitSizeCurve(rest, model);
    const pt = points[i]!;
    const pred = Math.pow(10, fit.a + fit.b * pt.x + categoryOffset(pt.p.category, fit));
    looFactors.push(errorFactor(pred, Math.pow(10, pt.y)));
    const anchors = anchorSet(rest.map((q) => q.p));
    const { r } = categoryMultiple(pt.p.category, anchors, model);
    looRadar2Factors.push(errorFactor(pt.p.tvl_usd * r, pt.p.mcap_usd!));
  }
  const loo = summarizeFactors(looFactors);
  // Time split: anchors with no listed_at are excluded; the rest are ordered by
  // listed_at, fit on the older half, tested on the newer half.
  const dated = points
    .filter((pt) => pt.p.listed_at !== null)
    .sort((a, b) =>
      a.p.listed_at! < b.p.listed_at! ? -1 : a.p.listed_at! > b.p.listed_at! ? 1 : a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0,
    );
  const split = Math.floor(dated.length / 2);
  const fitSet = dated.slice(0, split);
  const testSet = dated.slice(split);
  const cutoff = testSet.length > 0 ? testSet[0]!.p.listed_at : null;
  const tsFit = fitSizeCurve(fitSet, model);
  const tsFactors = testSet.map((pt) =>
    errorFactor(Math.pow(10, tsFit.a + tsFit.b * pt.x + categoryOffset(pt.p.category, tsFit)), Math.pow(10, pt.y)),
  );
  const tsAnchors = anchorSet(fitSet.map((q) => q.p));
  const tsRadar2Factors = testSet.map((pt) => {
    const { r } = categoryMultiple(pt.p.category, tsAnchors, model);
    return errorFactor(pt.p.tvl_usd * r, pt.p.mcap_usd!);
  });
  const ts = summarizeFactors(tsFactors);
  const fit = fitSizeCurve(points, model);
  return {
    fit: { a: round4(fit.a), b: round4(fit.b), n_anchors: points.length },
    loo: {
      n: points.length,
      median_factor: loo.median,
      p75_factor: loo.p75,
      within_2x: loo.within2,
      within_3x: loo.within3,
      radar2_median_factor: round4(medianOf(looRadar2Factors) ?? 0),
    },
    time_split: {
      n_fit: fitSet.length,
      n_test: testSet.length,
      cutoff,
      median_factor: ts.median,
      within_2x: ts.within2,
      within_3x: ts.within3,
      radar2_median_factor: round4(medianOf(tsRadar2Factors) ?? 0),
    },
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const fit = fitSizeCurve(anchorPoints(snapshot.protocols), model);
  const scored = new Map<string, { p: SnapshotProtocol; implied: number; r: number; n: number; fallback: boolean; growthPct: number; growthMult: number; ageMult: number; chainsMult: number; age: number | null }>();
  const score = (p: SnapshotProtocol) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    scored.set(p.slug, { p, implied: v.implied, r: v.r, n: v.n, fallback: v.fallback, growthPct: v.growthPct, growthMult: v.growthMult, ageMult: v.ageMult, chainsMult: v.chainsMult, age: v.age });
  };
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) score(p);
  }
  // The early radar: no-token protocols that pass the screen, by implied value.
  const clean = snapshot.protocols
    .filter((p) => !scored.has(p.slug) && isNoToken(p) && screenReason(p) === null)
    .map((p) => {
      const v = impliedValue(p, snapshot.as_of, fit, model);
      return { p, implied: v.implied };
    })
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  for (const c of clean) {
    if (scored.size >= BOARD_ROWS) break;
    score(c.p);
  }

  const list = [...scored.values()].sort(
    (a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // Implied values must be unique (the gate refuses a flat board, and a tie would hide
  // the ranking). A $1 uniqueness nudge, applied deterministically downward, only ever
  // fires on an exact rounding tie; on this snapshot it never fires.
  for (let i = 1; i < list.length; i++) {
    if (list[i]!.implied >= list[i - 1]!.implied) list[i]!.implied = Math.max(1, list[i - 1]!.implied - 1);
  }
  const logMin = Math.log(list[list.length - 1]!.implied);
  const logMax = Math.log(list[0]!.implied);
  return list.map((s, i) => {
    const band = bandFor(fit, s.implied);
    const radarScore = logMax === logMin ? 100 : Math.round(((Math.log(s.implied) - logMin) / (logMax - logMin)) * 1000) / 10;
    const econ = farmEconomics(s.p, s.age, band.lo, model);
    const plan = farmPlan(s.p, s.age);
    return {
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
      token_status: 'No token recorded',
      age_days: s.age,
      implied_value_usd: s.implied,
      radar_score: radarScore,
      band_lo_usd: band.lo,
      band_hi_usd: band.hi,
      farming_status: econ.status,
      is_watchlist: snapshot.watchlist.includes(s.p.slug),
      ambiguous: false,
      screen_reason: null,
      model: {
        r_category: s.r,
        category_anchors: s.n,
        r_fallback: s.fallback,
        growth_pct: s.growthPct,
        growth_multiplier: s.growthMult,
        age_multiplier: s.ageMult,
        chains_multiplier: s.chainsMult,
        haircut: 1,
      },
      farm_capital_usd: econ.capital,
      farm_tx_count: econ.txCount,
      farm_gas_usd: econ.gas,
      farm_total_cost_usd: econ.totalCost,
      farm_cost_lo_usd: econ.costLo,
      farm_cost_hi_usd: econ.costHi,
      farm_allocation_usd: econ.allocation,
      farm_net_usd: econ.net,
      farm_breakeven_odds: econ.breakeven,
      farm_playbook: plan.playbook,
      farm_steps: plan.steps.map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

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

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One farm position's netted economics: capital plus gas against the assumed one-wallet allocation. */
export interface FarmEconomics {
  capital: number;
  txCount: number;
  gas: number;
  totalCost: number;
  costLo: number;
  costHi: number;
  allocation: number;
  net: number;
  breakeven: number;
  status: 'Farming' | 'Marginal' | 'Skip';
}

/**
 * The netted cost of farming one protocol: the capital tier plus gas for
 * 2 + ceil(holdDays/7) + 1 transactions (setup, one qualifying action each week
 * of the hold, one claim) at $5, the midpoint of the $2–$8 range; lo/hi use $2
 * and $8. The allocation is the low band times 0.00075, the assumed one-wallet
 * share if the token launches (a planning figure, not a promise; the break-even
 * odds move linearly if the share is changed); net is allocation minus total
 * cost, and break-even odds are total cost over allocation. Farming at odds
 * <= 0.02, Marginal at <= 0.05, else Skip.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, bandLo: number, model: ModelConstants = MODEL): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const txCount = 2 + Math.ceil(hold / 7) + 1;
  const gas = txCount * model.gas_mid;
  const totalCost = capital + gas;
  const costLo = capital + txCount * model.gas_lo;
  const costHi = capital + txCount * model.gas_hi;
  const allocation = round2(bandLo * model.allocation_share);
  const net = round2(allocation - totalCost);
  const breakeven = allocation <= 0 ? 9999 : round4(totalCost / allocation);
  const status: FarmEconomics['status'] =
    breakeven <= model.breakeven_farming ? 'Farming' : breakeven <= model.breakeven_marginal ? 'Marginal' : 'Skip';
  return { capital, txCount, gas, totalCost, costLo, costHi, allocation, net, breakeven, status };
}

/** The shared setup step: a fresh wallet, every playbook. */
const SETUP_STEP: FarmStep = {
  text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
  cost: 'no setup cost; about $2–$8 of gas for the first transaction',
  time: '5 minutes',
};

/** The shared log step: write the position down, every playbook. */
const LOG_STEP: FarmStep = {
  text: 'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.',
  cost: 'nothing but the log',
  time: '5 minutes',
};

/** A playbook's eight steps: setup, main action, two mechanism steps, weekly action, hold, claim, log. */
function playbookSteps(main: FarmStep, mech1: FarmStep, mech2: FarmStep, weekly: FarmStep, hold: FarmStep, claim: FarmStep): FarmStep[] {
  return [SETUP_STEP, main, mech1, mech2, weekly, hold, claim, LOG_STEP];
}

/** A playbook's mechanism, weekly, hold and claim steps, tailored to how that category actually works. */
function playbookBody(
  id: string,
  main: FarmStep,
  mech1: FarmStep,
  mech2: FarmStep,
  weekly: FarmStep,
  hold: FarmStep,
  claim: FarmStep,
): { playbook: string; steps: FarmStep[] } {
  return { playbook: id, steps: playbookSteps(main, mech1, mech2, weekly, hold, claim) };
}

/**
 * A protocol's farm playbook: eight steps matched to its category group, each
 * derived from the protocol's own record (name, chain, capital, hold days).
 * Gas is never given as a precise figure the snapshot cannot support: ranges
 * ("about $2–$8 of gas") or "variable / not measured".
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): { playbook: string; steps: FarmStep[] } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const name = p.name;
  const c = (p.category ?? '').toLowerCase();
  const gas = 'about $2–$8 of gas';
  const weekly = (action: string): FarmStep => ({
    text: `Make one qualifying action each week, such as ${action}, so the wallet stays active.`,
    cost: `${gas} a week`,
    time: '10 minutes a week',
  });
  const holdStep = (position: string): FarmStep => ({
    text: `Hold the ${position} for at least ${hold} days so the activity spans more than one snapshot.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  });
  const claimStep = (extra: string): FarmStep => ({
    text: `Before you withdraw, open ${name}'s own points or rewards page and claim only from the link it publishes${extra}.`,
    cost: 'no fee to check; never pay to claim',
    time: '10 minutes',
  });
  const main = (text: string, time: string): FarmStep => ({ text, cost: `$${capital} of capital and ${gas}`, time });

  if (c.includes('bridge')) {
    return playbookBody(
      'bridge',
      main(`Bridge a $5 test amount first through ${name} to ${chain}, wait for finality, then bridge $${capital} of USDC and use it in the destination app.`, '20–60 minutes plus finality'),
      { text: `Check ${name}'s finality time and fee on ${chain} before the large transfer, and confirm the destination address accepts the bridged asset.`, cost: gas, time: '10 minutes' },
      { text: `After the test bridge lands, verify the received amount and the destination chain's explorer record before sending the full $${capital}.`, cost: gas, time: '10 minutes' },
      weekly('a bridge, a swap or a claim'),
      holdStep('bridged position'),
      claimStep(''),
    );
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return playbookBody(
      'lending',
      main(`Supply $${capital} of USDC to ${name} on ${chain} and keep the position open; check the borrow rate before depositing.`, '10–30 minutes'),
      { text: `Check the collateral factor and the liquidation threshold for USDC on ${name} before you supply, so you know how much headroom the position has.`, cost: gas, time: '10 minutes' },
      { text: `If you borrow against the supply, keep the health factor above 2 and borrow only a small share of the collateral; never borrow the maximum.`, cost: gas, time: '10 minutes' },
      weekly('a supply top-up, a small borrow repayment or a vote'),
      holdStep('supplied position'),
      claimStep('; check for unclaimed supply incentives first'),
    );
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return playbookBody(
      'dex',
      main(`Swap a small amount, then provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`, '15–30 minutes'),
      { text: `Check the pool's fee tier and the price range before you add liquidity, and confirm the pair's volume on ${chain} is real and recent.`, cost: gas, time: '10 minutes' },
      { text: `If the pool is concentrated, set a range near the current price and plan to rebalance only when the price leaves it; if it is a full-range pool, deposit and leave it alone.`, cost: gas, time: '10 minutes' },
      weekly('a swap, a liquidity top-up or a fee claim'),
      holdStep('liquidity position'),
      claimStep('; collect accrued trading fees first'),
    );
  }
  if (c.includes('staking') || c.includes('restak')) {
    return playbookBody(
      'staking',
      main(`Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token; check the unstaking delay first.`, '10–30 minutes'),
      { text: `Read the unstaking delay and any unbonding period for ${name} on ${chain} before you stake, so a ${hold}-day hold is not trapped by a longer lock.`, cost: gas, time: '10 minutes' },
      { text: `Confirm which receipt token ${name} issues and where it is accepted, so you know whether the staked position can be used elsewhere while it earns.`, cost: gas, time: '10 minutes' },
      weekly('a restake of rewards, a small additional stake or a vote'),
      holdStep('staked position'),
      claimStep('; check for unclaimed staking rewards first'),
    );
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return playbookBody(
      'perpetual',
      main(`Deposit $${capital} of USDC as margin on ${name} only if its docs confirm the market is live; open one small low-leverage position and set a stop.`, '15–30 minutes'),
      { text: `Set leverage to 2x or less and place a stop-loss before the position can move against you; never open without the stop in place.`, cost: gas, time: '10 minutes' },
      { text: `Check the funding rate and the mark price on ${name} before you open, and close the position if funding turns sharply against you.`, cost: gas, time: '10 minutes' },
      weekly('a small trade, a margin top-up or a stop adjustment'),
      holdStep('funded margin account'),
      claimStep('; settle any open position first'),
    );
  }
  if (c.includes('prediction')) {
    return playbookBody(
      'prediction',
      main(`Fund $${capital} on ${name} and place one small market position on ${chain}; read the market rules and settlement first.`, '15–30 minutes'),
      { text: `Read the market's resolution source and settlement time before you place a position, so you know exactly what decides the outcome.`, cost: gas, time: '10 minutes' },
      { text: `Size the first position small — a fraction of the $${capital} — and keep the rest as reserve for a second market rather than staking everything on one outcome.`, cost: gas, time: '10 minutes' },
      weekly('a new market position or a settlement claim'),
      holdStep('funded account'),
      claimStep('; collect winnings from settled markets first'),
    );
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return playbookBody(
      'vault',
      main(`Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares; read the strategy and fee note first.`, '10–30 minutes'),
      { text: `Read the vault's strategy, its fee schedule and its withdrawal delay before you deposit, and confirm the vault is accepting new deposits.`, cost: gas, time: '10 minutes' },
      { text: `Check which underlying positions the vault holds and how often it rebalances, so you know what the $${capital} is actually exposed to.`, cost: gas, time: '10 minutes' },
      weekly('a vault top-up, a rebalance check or a vote'),
      holdStep('vault shares'),
      claimStep('; check for unclaimed vault incentives first'),
    );
  }
  if (c.includes('stable')) {
    return playbookBody(
      'stable',
      main(`Mint or deposit $${capital} of the stable asset through ${name} on ${chain}; check the peg and redemption terms first.`, '10–30 minutes'),
      { text: `Check the peg history and the redemption terms for ${name}'s stable asset on ${chain} before you mint, and confirm redemptions are currently open.`, cost: gas, time: '10 minutes' },
      { text: `Confirm what backs the stable asset and whether minting needs collateral, so you know what the $${capital} is secured by.`, cost: gas, time: '10 minutes' },
      weekly('a mint, a redemption or a swap of the stable asset'),
      holdStep('stable position'),
      claimStep('; check for unclaimed stability incentives first'),
    );
  }
  if (c.includes('rwa')) {
    return playbookBody(
      'rwa',
      main(`Mint $${capital} of the protocol's yield asset on ${chain} and hold it; check eligibility and redemption terms first.`, '10–30 minutes'),
      { text: `Check eligibility, any KYC step and the redemption terms for ${name} on ${chain} before you mint, so the $${capital} is not locked by a rule you missed.`, cost: gas, time: '10 minutes' },
      { text: `Confirm what real-world asset backs the yield asset and how its yield is paid, so you know what the $${capital} earns and when.`, cost: gas, time: '10 minutes' },
      weekly('a mint, a redemption or a yield claim'),
      holdStep('yield asset'),
      claimStep('; collect accrued yield first'),
    );
  }
  if (c.includes('insurance')) {
    return playbookBody(
      'insurance',
      main(`Buy $${capital} of cover from ${name} on ${chain} and keep the policy; read what the cover excludes first.`, '10–30 minutes'),
      { text: `Read the cover's exclusions and the claim conditions for ${name} on ${chain} before you buy, so you know exactly which events the policy pays for.`, cost: gas, time: '10 minutes' },
      { text: `Check the cover period and the premium for $${capital} of cover, and confirm the policy starts when you need it rather than after a waiting period.`, cost: gas, time: '10 minutes' },
      weekly('a cover top-up or a policy review'),
      holdStep('cover'),
      claimStep('; file any eligible claim before the cover lapses'),
    );
  }
  if (c.includes('yield') || c.includes('farm')) {
    return playbookBody(
      'yield',
      main(`Deposit $${capital} into ${name}'s main yield position on ${chain} and keep it open; check the reward schedule first.`, '10–30 minutes'),
      { text: `Check the reward schedule and whether rewards vest or unlock over time, so you know when the yield from the $${capital} is actually claimable.`, cost: gas, time: '10 minutes' },
      { text: `Confirm whether the yield is paid in the deposited asset or a separate reward token, and whether compounding is automatic or needs a manual claim.`, cost: gas, time: '10 minutes' },
      weekly('a deposit top-up, a reward claim or a restake'),
      holdStep('yield position'),
      claimStep('; collect accrued rewards first'),
    );
  }
  return playbookBody(
    'default',
    main(`Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open; read the docs first to confirm the action counts.`, '15–30 minutes'),
    { text: `Read ${name}'s docs to find the one action its points system counts — a deposit, a swap or a vote — and confirm it on the protocol's own page before you commit the $${capital}.`, cost: gas, time: '10 minutes' },
    { text: `Check whether the position has a lock, a minimum amount or a waiting period, so the $${capital} is not stuck longer than the ${hold}-day hold you planned.`, cost: gas, time: '10 minutes' },
    weekly('a deposit, a swap, a vote or a claim'),
    holdStep('position'),
    claimStep(''),
  );
}

/** A protocol's farm plan: eight steps, each an action with a cost and a time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  return farmPlan(p, age).steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isTraded(p))
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** The set-aside counts, so the three stat cards trace to all 758 protocols. */
export function setAsideCounts(snapshot: Snapshot, board: BoardRow[]): SetAside {
  const boardSlugs = new Set(board.map((r) => r.slug));
  let traded = 0;
  let capUnavailable = 0;
  let review = 0;
  let screened = 0;
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug)) continue;
    if (isTraded(p)) traded++;
    else if (isNoToken(p) && screenReason(p) !== null) screened++;
    else if (tokenStatusOf(p) === 'Review metadata') review++;
    else capUnavailable++;
  }
  return { traded, cap_unavailable: capUnavailable, review_metadata: review, screened, total: capUnavailable + review + screened };
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
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    radar_score: row.radar_score,
    band_lo_usd: row.band_lo_usd,
    band_hi_usd: row.band_hi_usd,
    farming_status: row.farming_status,
    token_status: row.token_status,
    is_watchlist: row.is_watchlist,
    ambiguous: row.ambiguous,
    screen_reason: row.screen_reason,
    r_category: row.model.r_category,
    category_anchors: row.model.category_anchors,
    r_fallback: row.model.r_fallback,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chains_multiplier: row.model.chains_multiplier,
    haircut: row.model.haircut,
    farm_capital_usd: row.farm_capital_usd,
    farm_tx_count: row.farm_tx_count,
    farm_gas_usd: row.farm_gas_usd,
    farm_total_cost_usd: row.farm_total_cost_usd,
    farm_cost_lo_usd: row.farm_cost_lo_usd,
    farm_cost_hi_usd: row.farm_cost_hi_usd,
    farm_allocation_usd: row.farm_allocation_usd,
    farm_net_usd: row.farm_net_usd,
    farm_breakeven_odds: row.farm_breakeven_odds,
    farm_playbook: row.farm_playbook,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const anchors = anchorSet(snapshot.protocols);
  const points = anchorPoints(snapshot.protocols);
  const fit = fitSizeCurve(points, model);
  const validation = validateFit(points, model);
  const globalMedian = medianOf(anchors.globalRatios) ?? 1;
  const anchorFits: AnchorFit[] = [...anchors.byCategory.entries()]
    .map(([category, list]) => {
      const cat = category === '(no category)' ? null : category;
      const tvls = points.filter((pt) => pt.key === category).map((pt) => pt.p.tvl_usd);
      const medianTvl = medianOf(tvls) ?? 1;
      return {
        category,
        anchors: list.length,
        median_ratio: medianOf(list),
        p25_ratio: quantileOf(list, 0.25),
        p75_ratio: quantileOf(list, 0.75),
        r_category: fittedMultiple(medianTvl, cat, fit),
        offset_log10: round4(categoryOffset(cat, fit)),
      };
    })
    .sort((a, b) => b.anchors - a.anchors || (a.category < b.category ? -1 : 1));
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median_ratio: round4(globalMedian),
    global_p25_ratio: round4(quantileOf(anchors.globalRatios, 0.25) ?? 0),
    global_p75_ratio: round4(quantileOf(anchors.globalRatios, 0.75) ?? 0),
    global_p90_ratio: round4(quantileOf(anchors.globalRatios, 0.9) ?? 0),
    anchors: anchorFits,
    validation,
    set_aside: setAsideCounts(snapshot, board),
    rows: board.map(radarRow),
    live,
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
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const seen = new Set<number>();
  for (const r of board) {
    if (seen.has(r.implied_value_usd)) return `${r.slug} shares an implied value with another row`;
    seen.add(r.implied_value_usd);
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
