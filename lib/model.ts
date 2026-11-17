// Token Launch Radar — model "radar-2" (Azizah's formula, calibrated).
//
// One snapshot in, one ranked board out. No name is ever special-cased: the same
// function scores every row, and every number below comes from the snapshot.
//
//   V = round(TVL x R_category x F_growth x F_age x F_chains), clamped to $1..$1e14
//
//   R_category  median mcap/TVL of same-category traded anchors, shrunk toward the
//               global median with prior 8, clamped to 0.01..3.0. A category with no
//               anchor falls back to the global median; no anchors at all -> 1.0.
//               (The 3.0 cap is a calibration revision: one category, Prediction
//               Market, has a single anchor at 400x TVL, which under a 10 cap would
//               put a $320M-TVL protocol at a $3.7B implied value. The global p90 of
//               anchor ratios is 2.95, so 3.0 keeps implied values inside the range
//               the market itself shows.)
//   F_growth    1 + clamp(change_7d, -50, +50)/200            (0.75..1.25; null -> 1)
//   F_age       1 + 0.15 x min(days tracked / 730, 1)         (listed_at null -> 1)
//               "Days tracked" is how long DefiLlama has listed the protocol, not
//               the project's true age.
//   F_chains    1 + 0.025 x min(max(chains - 1, 0), 4)        (max +10%)
//
// Screening. A board row must record no token (mcap, gecko_id and symbol all null;
// mcap 0 or negative, e.g. autofinance -1, counts as null and never anchors the fit).
// Early rows exclude the watchlist rule's screened products: categories Bridge,
// Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX; names
// ending in a version marker; names carrying a whole word wrapped/staked/staking.
// Only 198 no-token protocols pass that screen, 40 of them the watchlist, so the
// 200-row board fills its last two slots with the two largest screened products as
// flagged audit rows: their value is haircut to 0.01% of the model value
// (AMBIG_HAIRCUT), so they sit at the foot of the board (ranks 199-200), carry
// farming status Skip, and are labelled ambiguous in the dashboard and Method.
// The other 142 screened products are set aside, with the reason counted.
//
// Radar score 0-100 is a relative index from log implied value on this board's run
// ("relative, not probability"): rank 1 scores 100, rank 200 scores 0.
// The P25-P75 band multiplies TVL by the p25/p75 of the same anchor ratios the
// category multiple comes from (global ratios when the category has fewer than 3
// anchors) with the same growth/age/chains factors: a sensitivity range, not a
// confidence interval.

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
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** Board size: the 40 watchlist rows plus 160 early rows. */
export const BOARD_ROWS = 200;

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
}

/** The set-aside counts, so Ranked + Already trade + Set aside traces to 758. */
export interface SetAside {
  traded: number;
  cap_unavailable: number;
  review_metadata: number;
  screened: number;
  total: number;
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

/** The shrunk, clamped category multiple for one category. */
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

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  anchors: AnchorSet,
  model: ModelConstants,
): { implied: number; r: number; n: number; fallback: boolean; growthPct: number; growthMult: number; ageMult: number; chainsMult: number; age: number | null } {
  const { r, n, fallback } = categoryMultiple(p.category, anchors, model);
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(-model.growth_cap, rawGrowth));
  const growthMult = 1 + growthPct / 200;
  const ageMult = age === null ? 1 : 1 + model.age_weight * Math.min(age / model.age_days, 1);
  const chainsMult = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_max);
  const implied = Math.min(1e14, Math.max(1, Math.round(p.tvl_usd * r * growthMult * ageMult * chainsMult)));
  return { implied, r, n, fallback, growthPct, growthMult: round4(growthMult), ageMult: round4(ageMult), chainsMult: round4(chainsMult), age };
}

/** The P25-P75 sensitivity band for one protocol (same factors as the implied value). */
export function bandFor(
  p: SnapshotProtocol,
  asOf: string,
  anchors: AnchorSet,
  model: ModelConstants,
  haircut: number,
): { lo: number; hi: number } {
  const list = anchors.byCategory.get(p.category ?? '(no category)') ?? [];
  const ratios = list.length >= 3 ? list : anchors.globalRatios;
  const p25 = quantileOf(ratios, 0.25);
  const p75 = quantileOf(ratios, 0.75);
  const { growthMult, ageMult, chainsMult } = impliedValue(p, asOf, anchors, model);
  if (p25 === null || p75 === null) return { lo: 1, hi: 1 };
  const lo = Math.min(1e14, Math.max(1, Math.round(p.tvl_usd * p25 * growthMult * ageMult * chainsMult * haircut)));
  const hi = Math.min(1e14, Math.max(1, Math.round(p.tvl_usd * p75 * growthMult * ageMult * chainsMult * haircut)));
  return { lo, hi };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const anchors = anchorSet(snapshot.protocols);
  const scored = new Map<string, { p: SnapshotProtocol; implied: number; r: number; n: number; fallback: boolean; growthPct: number; growthMult: number; ageMult: number; chainsMult: number; age: number | null; haircut: number; ambiguous: boolean; reason: string | null }>();
  const score = (p: SnapshotProtocol, haircut: number, ambiguous: boolean, reason: string | null) => {
    const v = impliedValue(p, snapshot.as_of, anchors, model);
    const implied = haircut === 1 ? v.implied : Math.max(1, Math.round(v.implied * haircut));
    scored.set(p.slug, { p, implied, r: v.r, n: v.n, fallback: v.fallback, growthPct: v.growthPct, growthMult: v.growthMult, ageMult: v.ageMult, chainsMult: v.chainsMult, age: v.age, haircut, ambiguous, reason });
  };
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) score(p, 1, false, null);
  }
  // The early radar: no-token protocols that pass the screen, by implied value.
  const clean = snapshot.protocols
    .filter((p) => !scored.has(p.slug) && isNoToken(p) && screenReason(p) === null)
    .map((p) => {
      const v = impliedValue(p, snapshot.as_of, anchors, model);
      return { p, implied: v.implied };
    })
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  for (const c of clean) {
    if (scored.size >= BOARD_ROWS) break;
    score(c.p, 1, false, null);
  }
  // The last slots, if any, are flagged audit rows: the largest screened no-token
  // products, haircut to 0.01% of model value so they sit at the foot of the board.
  if (scored.size < BOARD_ROWS) {
    const screened = snapshot.protocols
      .filter((p) => !scored.has(p.slug) && isNoToken(p) && screenReason(p) !== null)
      .map((p) => {
        const v = impliedValue(p, snapshot.as_of, anchors, model);
        return { p, implied: v.implied, reason: screenReason(p) };
      })
      .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
    for (const c of screened) {
      if (scored.size >= BOARD_ROWS) break;
      score(c.p, model.ambig_haircut, true, c.reason);
    }
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
    const band = bandFor(s.p, snapshot.as_of, anchors, model, s.haircut);
    const radarScore = logMax === logMin ? 100 : Math.round(((Math.log(s.implied) - logMin) / (logMax - logMin)) * 1000) / 10;
    const farming: BoardRow['farming_status'] = s.ambiguous ? 'Skip' : radarScore >= 60 ? 'Farming' : radarScore >= 30 ? 'Marginal' : 'Skip';
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
      farming_status: farming,
      is_watchlist: snapshot.watchlist.includes(s.p.slug),
      ambiguous: s.ambiguous,
      screen_reason: s.reason,
      model: {
        r_category: s.r,
        category_anchors: s.n,
        r_fallback: s.fallback,
        growth_pct: s.growthPct,
        growth_multiplier: s.growthMult,
        age_multiplier: s.ageMult,
        chains_multiplier: s.chainsMult,
        haircut: s.haircut,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): { text: string; time: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('bridge')) return { text: `Bridge a $5 test amount first through ${name} to ${chain}, wait for finality, then bridge $${capital} of USDC and use it in the destination app.`, time: '20–60 minutes plus finality' };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return { text: `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open; check the borrow rate before depositing.`, time: '10–30 minutes' };
  if (c.includes('dex') || c.includes('leveraged farm')) return { text: `Swap a small amount, then provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`, time: '15–30 minutes' };
  if (c.includes('staking') || c.includes('restak')) return { text: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token; check the unstaking delay first.`, time: '10–30 minutes' };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return { text: `Deposit $${capital} of USDC as margin on ${name} only if its docs confirm the market is live; open one small low-leverage position and set a stop.`, time: '15–30 minutes' };
  if (c.includes('prediction')) return { text: `Fund $${capital} on ${name} and place one small market position on ${chain}; read the market rules and settlement first.`, time: '15–30 minutes' };
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return { text: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares; read the strategy and fee note first.`, time: '10–30 minutes' };
  if (c.includes('stable')) return { text: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}; check the peg and redemption terms first.`, time: '10–30 minutes' };
  if (c.includes('rwa')) return { text: `Mint $${capital} of the protocol's yield asset on ${chain} and hold it; check eligibility and redemption terms first.`, time: '10–30 minutes' };
  if (c.includes('insurance')) return { text: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy; read what the cover excludes first.`, time: '10–30 minutes' };
  if (c.includes('yield') || c.includes('farm')) return { text: `Deposit $${capital} into ${name}'s main yield position on ${chain} and keep it open; check the reward schedule first.`, time: '10–30 minutes' };
  return { text: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open; read the docs first to confirm the action counts.`, time: '15–30 minutes' };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Gas is never given as a precise figure the snapshot
 * cannot support: ranges ("about $2–$8 of gas") or "variable / not measured".
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'no setup cost; about $2–$8 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: action.text, cost: `$${capital} of capital and about $2–$8 of gas`, time: action.time },
    {
      text: 'Make one qualifying action each week, such as a deposit, a swap, a vote or a claim, so the wallet stays active.',
      cost: 'about $2–$8 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check; never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
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
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const anchors = anchorSet(snapshot.protocols);
  const globalMedian = medianOf(anchors.globalRatios) ?? 1;
  const anchorFits: AnchorFit[] = [...anchors.byCategory.entries()]
    .map(([category, list]) => {
      const { r } = categoryMultiple(category === '(no category)' ? null : category, anchors, model);
      return {
        category,
        anchors: list.length,
        median_ratio: medianOf(list),
        p25_ratio: quantileOf(list, 0.25),
        p75_ratio: quantileOf(list, 0.75),
        r_category: r,
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
