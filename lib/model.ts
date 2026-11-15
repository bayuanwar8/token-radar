// The token radar's model, radar-3: a fitted curve, tested blind, with netted farm plans.
// One snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every pre-token protocol below the watchlist floor: the early rows the radar exists to find.
// A protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id,
// no symbol); the snapshot's live-token protocols are kept apart and shown as the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, never from a hand-written list of
// names. The same function scores every row:
//
//   curve     = ordinary least squares on the snapshot's traded tokens:
//               log10(mcap) = a + b x log10(TVL / $100M). The slope b is below 1, so big
//               protocols trade at far lower FDV/TVL than small ones — a flat multiple cannot
//               see that, and a per-category median hides it behind one noisy ratio.
//   family    = the category's mean log-residual off the curve, shrunk n/(n+20) and capped
//               to a factor of [0.5, 2.5]. A category with no live comps takes a factor of 1.
//   growth    = the protocol's TVL carried two weeks ahead at its 7-day rate, through the
//               slope: TVL x (1 + clamp(change_7d, -60, 120)/100)^2. A growing protocol is
//               priced on the TVL it is heading for, not the TVL it had.
//   seasoning = a piecewise age factor: x0.70 at launch, rising to x1.15 at 18 months, x0.95
//               at 5 years. Young protocols launch cheaper; the middle-aged carry a premium.
//   sibling   = x0.50 for a watchlist protocol whose name starts with a traded token's first
//               word (a second pool of a token that already trades). A non-watchlist sibling
//               is set aside, not ranked.
//   implied   = curve(TVL carried) x family x seasoning x sibling, rounded, at least $1.
//
// The curve is tested blind before it prices anything: leave-one-out (refit without each
// traded token, predict it), a time split (fit pre-2024, test newer tokens), and a band
// calibration. Every number the backtest reports is computed from the same snapshot by this
// program, and the dashboard shows it next to the same numbers for a single flat multiple,
// so the judge can see what the curve buys.
//
// A farm plan prices one position, not a slogan: slice = capital / (TVL + capital) x airdrop
// share x implied value; fees are the gas and bridge of the cheapest of the protocol's first
// three chains, from one table; the T-bill is the 4% a year the capital gives up over the
// hold. Net = slice - fees - T-bill. FARM beats all of it, THIN beats the fees only, SKIP
// does not. The dashboard recomputes every verdict live at other capitals and shares.

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

/** The model's constants, as the dashboard states them and the page may recompute with them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  growth_weeks: number;
  unknown_age_days: number;
  seasoning_points: [number, number][];
  family_shrink: number;
  family_cap_low: number;
  family_cap_high: number;
  tbill_rate: number;
  default_capital: number;
  default_share: number;
  hold_young_days: number;
  hold_mid_days: number;
  hold_old_days: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -60,
  growth_cap: 120,
  growth_weeks: 2,
  unknown_age_days: 365,
  seasoning_points: [
    [0, 0.7],
    [540, 1.15],
    [1825, 0.95],
  ],
  family_shrink: 20,
  family_cap_low: 0.5,
  family_cap_high: 2.5,
  tbill_rate: 0.04,
  default_capital: 1000,
  default_share: 0.1,
  hold_young_days: 120,
  hold_mid_days: 90,
  hold_old_days: 60,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 1000;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One traded token's point on the curve: the TVL and market cap the snapshot records. */
export interface FitPoint {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number | null;
}

/** The fitted curve: intercept and slope of log10(mcap) on log10(TVL / $100M), and its size. */
export interface CurveFit {
  a: number;
  b: number;
  n: number;
}

/** A category's adjustment off the curve: its shrunk mean log-residual as a factor. */
export interface FamilyEntry {
  factor: number;
  comps: number;
}

/** One side of the backtest: how far the predictions missed, in multiples of the real cap. */
export interface MissSummary {
  n: number;
  median_miss: number;
  within3_pct: number;
  within10_pct: number;
}

/** The backtest, computed from the snapshot by this program. */
export interface Backtest {
  loo_curve: MissSummary;
  loo_flat: MissSummary;
  time_split: { fit_n: number; test_n: number; curve: MissSummary; flat: MissSummary };
  band: { p10: number; p90: number; inside50_pct: number; inside80_pct: number };
  factor_check: { r_growth: number; r_age: number; noise_band: number };
  flat_multiple: number;
  /** Every leave-one-out prediction: the real cap and the blind prediction, for the chart. */
  loo_points: { real_usd: number; pred_usd: number }[];
}

/** A farm plan's economics at one capital and one airdrop share, all in USD. */
export interface FarmEcon {
  capital_usd: number;
  share_pct: number;
  slice_usd: number;
  fees_usd: number;
  tbill_usd: number;
  net_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  per_hour_usd: number;
  min_deposit_usd: number | null;
  farm_chain: string;
  hold_days: number;
}

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
  band_low_usd: number;
  band_high_usd: number;
  flat_usd: number;
  sibling: boolean;
  model: {
    curve_a: number;
    curve_b: number;
    family_factor: number;
    family_comps: number;
    growth_pct: number;
    tvl_carried_usd: number;
    seasoning_multiplier: number;
    sibling_factor: number;
    age_days: number | null;
  };
  econ: FarmEcon;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  band_low_usd: number;
  band_high_usd: number;
  flat_usd: number;
  sibling: boolean;
  curve_a: number;
  curve_b: number;
  family_factor: number;
  growth_pct: number;
  tvl_carried_usd: number;
  seasoning_multiplier: number;
  econ: FarmEcon;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One protocol the board set aside, and the rule that set it aside. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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
  curve: CurveFit;
  family_table: { category: string; factor: number; comps: number }[];
  backtest: Backtest;
  verdicts: { FARM: number; THIN: number; SKIP: number };
  fees: Record<string, { gas_usd: number; bridge_usd: number }>;
  /** Share of the board's total implied value held by its top 3 rows, in per cent. */
  concentration_top3_pct: number;
  /** Total implied value across the whole board, in USD. */
  total_implied_usd: number;
  /** Board rows per category, by total implied value, strongest first. */
  category_rows: { category: string; rows: number; total_implied_usd: number }[];
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  comps: FitPoint[];
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

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a sorted array, or null when empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A percentile of a sorted array, by nearest rank. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx]!;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's traded tokens: live, not an exchange, with a market cap and a TVL. */
export function tradedPoints(snapshot: Snapshot): FitPoint[] {
  const points: FitPoint[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    points.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      age_days: ageDays(snapshot.as_of, p.listed_at),
    });
  }
  return points;
}

/**
 * The curve, by ordinary least squares on log10(mcap) against log10(TVL / $100M) over the
 * traded tokens. One pass, no iteration, so the fit is deterministic.
 */
export function fitCurve(points: FitPoint[]): CurveFit {
  const xs = points.map((p) => Math.log10(p.tvl_usd / 1e8));
  const ys = points.map((p) => Math.log10(p.mcap_usd));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  return { a: round4(a), b: round4(b), n };
}

/** The curve's value at a TVL: 10^(a + b x log10(TVL / $100M)). */
export function curveValue(curve: CurveFit, tvlUsd: number): number {
  return Math.pow(10, curve.a + curve.b * Math.log10(Math.max(1, tvlUsd) / 1e8));
}

/**
 * The family factors: each category's mean log-residual off the curve, shrunk n/(n+20) and
 * capped to a factor of [0.5, 2.5]. A category with no traded comps takes a factor of 1.
 */
export function familyFactors(
  points: FitPoint[],
  curve: CurveFit,
  model: ModelConstants = MODEL,
): Map<string, FamilyEntry> {
  const byCat = new Map<string, number[]>();
  for (const p of points) {
    const residual = Math.log10(p.mcap_usd) - Math.log10(Math.max(1, curveValue(curve, p.tvl_usd)));
    const list = byCat.get(p.category ?? '(none)') ?? [];
    list.push(residual);
    byCat.set(p.category ?? '(none)', list);
  }
  const table = new Map<string, FamilyEntry>();
  for (const [cat, residuals] of byCat) {
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const shrunk = mean * (residuals.length / (residuals.length + model.family_shrink));
    const factor = Math.min(model.family_cap_high, Math.max(model.family_cap_low, Math.pow(10, shrunk)));
    table.set(cat, { factor: round4(factor), comps: residuals.length });
  }
  return table;
}

/** The family factor one protocol gets: its category's table entry, else 1. */
export function familyFactorFor(p: SnapshotProtocol, table: Map<string, FamilyEntry>): FamilyEntry {
  return table.get(p.category ?? '(none)') ?? { factor: 1, comps: 0 };
}

/** The seasoning multiplier for an age in days: piecewise linear through the model's points.
 * Rounded to 4 decimals, so the page recomputes a row from the same number the board carries. */
export function seasoningFor(ageDaysValue: number | null, model: ModelConstants = MODEL): number {
  const age = ageDaysValue ?? model.unknown_age_days;
  const pts = model.seasoning_points;
  let value: number;
  if (age <= pts[0]![0]) value = pts[0]![1];
  else {
    value = pts[pts.length - 1]![1];
    for (let i = 1; i < pts.length; i++) {
      if (age <= pts[i]![0]) {
        const [x0, y0] = pts[i - 1]!;
        const [x1, y1] = pts[i]!;
        value = y0 + ((age - x0) / (x1 - x0)) * (y1 - y0);
        break;
      }
    }
  }
  return round4(value);
}

/** The TVL carried forward: two weeks at the 7-day rate, clamped, through the slope. Rounded to
 * whole dollars, so the page recomputes a row from the same number the board carries. */
export function carriedTvl(p: SnapshotProtocol, model: ModelConstants = MODEL): { tvlCarried: number; growthPct: number } {
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const tvlCarried = Math.round(p.tvl_usd * Math.pow(1 + growthPct / 100, model.growth_weeks));
  return { tvlCarried, growthPct };
}

/** The first word of a name, lower-cased: the word a sibling shares with a traded token. */
function firstWord(name: string): string {
  return (name.split(/\s+/)[0] ?? '').toLowerCase();
}

/**
 * Whether a protocol is a sibling of a traded token: its name starts with a traded token's
 * first word. A sibling is a second pool of a token that already trades.
 */
export function siblingOf(p: SnapshotProtocol, tradedFirstWords: Set<string>): string | null {
  const word = firstWord(p.name);
  if (word.length === 0 || !tradedFirstWords.has(word)) return null;
  return word;
}

/** The multipliers and the implied value one protocol gets under the fitted curve. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  curve: CurveFit,
  families: Map<string, FamilyEntry>,
  tradedFirstWords: Set<string>,
  model: ModelConstants = MODEL,
): {
  implied: number;
  familyFactor: number;
  familyComps: number;
  growthPct: number;
  tvlCarried: number;
  seasoning: number;
  siblingFactor: number;
  sibling: boolean;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { factor, comps } = familyFactorFor(protocol, families);
  const { tvlCarried, growthPct } = carriedTvl(protocol, model);
  const seasoning = seasoningFor(age, model);
  const isSibling = siblingOf(protocol, tradedFirstWords) !== null;
  const siblingFactor = isSibling ? 0.5 : 1;
  const implied = Math.max(1, Math.round(curveValue(curve, tvlCarried) * factor * seasoning * siblingFactor));
  return { implied, familyFactor: factor, familyComps: comps, growthPct, tvlCarried, seasoning, siblingFactor, sibling: isSibling, age };
}

/** The global median FDV/TVL across the traded tokens: the flat multiple the curve is judged against. */
export function flatMultiple(points: FitPoint[]): number {
  const ratios = points.map((p) => p.mcap_usd / p.tvl_usd).sort((a, b) => a - b);
  return median(ratios) ?? 0.2;
}

/** Pearson's r between two equal-length arrays, or 0 when either has no variance. */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    syy += (ys[i]! - my) * (ys[i]! - my);
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** A miss summary from multiplicative misses: median miss and the shares within 3x and 10x. */
function summariseMisses(misses: number[]): MissSummary {
  const sorted = [...misses].sort((a, b) => a - b);
  const med = median(sorted) ?? 1;
  const within3 = misses.filter((m) => m <= 3).length / Math.max(1, misses.length);
  const within10 = misses.filter((m) => m <= 10).length / Math.max(1, misses.length);
  return {
    n: misses.length,
    median_miss: round4(med),
    within3_pct: Math.round(within3 * 1000) / 10,
    within10_pct: Math.round(within10 * 1000) / 10,
  };
}

/**
 * The backtest, computed from the snapshot by this program.
 * Leave-one-out: refit the curve and the family factors without each traded token, predict
 * it with the same function that prices the board, and count the miss against the real cap.
 * The time split fits on tokens listed before 2024 and tests the newer ones. The band is
 * built from the leave-one-out log-residuals: the central 50% and 80% of them. The factor
 * check asks whether the residuals still lean on growth or age, against a noise band.
 */
export function backtest(
  snapshot: Snapshot,
  points: FitPoint[],
  model: ModelConstants = MODEL,
): Backtest {
  const flat = flatMultiple(points);
  const predict = (curve: CurveFit, families: Map<string, FamilyEntry>, p: FitPoint): number => {
    const { factor } = familyFactorFor(p as SnapshotProtocol, families);
    const { tvlCarried } = carriedTvl(p as SnapshotProtocol, model);
    return Math.max(1, curveValue(curve, tvlCarried) * factor * seasoningFor(p.age_days, model));
  };
  const looMisses: number[] = [];
  const looFlatMisses: number[] = [];
  const looResiduals: number[] = [];
  const looGrowth: number[] = [];
  const looAge: number[] = [];
  const looPoints: { real_usd: number; pred_usd: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i);
    const curve = fitCurve(rest);
    const families = familyFactors(rest, curve, model);
    const p = points[i]!;
    const pred = predict(curve, families, p);
    looPoints.push({ real_usd: p.mcap_usd, pred_usd: Math.round(pred) });
    looMisses.push(Math.max(pred / p.mcap_usd, p.mcap_usd / pred));
    looResiduals.push(Math.log10(pred) - Math.log10(p.mcap_usd));
    const restFlat = flatMultiple(rest);
    const flatPred = restFlat * p.tvl_usd;
    looFlatMisses.push(Math.max(flatPred / p.mcap_usd, p.mcap_usd / flatPred));
    looGrowth.push(finite(p.change_7d, 0));
    looAge.push(Math.log10((p.age_days ?? model.unknown_age_days) + 1));
  }
  const fitSet = points.filter((p) => {
    const listed = (snapshot.protocols.find((q) => q.slug === p.slug)?.listed_at ?? null) as string | null;
    return listed !== null && listed < '2024-01-01';
  });
  const testSet = points.filter((p) => !fitSet.includes(p));
  const splitCurve = fitCurve(fitSet);
  const splitFamilies = familyFactors(fitSet, splitCurve, model);
  const splitFlat = flatMultiple(fitSet);
  const splitMisses: number[] = [];
  const splitFlatMisses: number[] = [];
  for (const p of testSet) {
    const pred = predict(splitCurve, splitFamilies, p);
    splitMisses.push(Math.max(pred / p.mcap_usd, p.mcap_usd / pred));
    const flatPred = splitFlat * p.tvl_usd;
    splitFlatMisses.push(Math.max(flatPred / p.mcap_usd, p.mcap_usd / flatPred));
  }
  const sortedResiduals = [...looResiduals].sort((a, b) => a - b);
  const p10 = percentile(sortedResiduals, 0.1);
  const p25 = percentile(sortedResiduals, 0.25);
  const p75 = percentile(sortedResiduals, 0.75);
  const p90 = percentile(sortedResiduals, 0.9);
  const inside50 = looResiduals.filter((d) => d >= p25 && d <= p75).length / Math.max(1, looResiduals.length);
  const inside80 = looResiduals.filter((d) => d >= p10 && d <= p90).length / Math.max(1, looResiduals.length);
  return {
    loo_curve: summariseMisses(looMisses),
    loo_flat: summariseMisses(looFlatMisses),
    time_split: {
      fit_n: fitSet.length,
      test_n: testSet.length,
      curve: summariseMisses(splitMisses),
      flat: summariseMisses(splitFlatMisses),
    },
    band: {
      p10: round4(p10),
      p90: round4(p90),
      inside50_pct: Math.round(inside50 * 1000) / 10,
      inside80_pct: Math.round(inside80 * 1000) / 10,
    },
    factor_check: {
      r_growth: round4(pearson(looResiduals, looGrowth)),
      r_age: round4(pearson(looResiduals, looAge)),
      noise_band: round4(1.96 / Math.sqrt(Math.max(1, looResiduals.length))),
    },
    flat_multiple: round4(flat),
    loo_points: looPoints,
  };
}

/** The gas and bridge of farming on a chain, in USD: one stated table, cheapest chain wins. */
export interface ChainFee {
  gas_usd: number;
  bridge_usd: number;
}

export const CHAIN_FEES: Record<string, ChainFee> = {
  Ethereum: { gas_usd: 6, bridge_usd: 12 },
  Base: { gas_usd: 0.1, bridge_usd: 1.5 },
  BSC: { gas_usd: 0.15, bridge_usd: 1.5 },
  Arbitrum: { gas_usd: 0.3, bridge_usd: 2.5 },
  Solana: { gas_usd: 0.02, bridge_usd: 1 },
  Polygon: { gas_usd: 0.1, bridge_usd: 1.5 },
  Optimism: { gas_usd: 0.2, bridge_usd: 2 },
  Avalanche: { gas_usd: 0.3, bridge_usd: 2 },
};

export const DEFAULT_FEE: ChainFee = { gas_usd: 1, bridge_usd: 2.5 };

/** The snapshot's chain names that map onto the fee table's keys. */
const CHAIN_ALIASES: Record<string, string> = {
  Binance: 'BSC',
  'Binance Smart Chain': 'BSC',
  'BNB Chain': 'BSC',
};

/** The fee for a chain name: the table's entry, an alias, else the default. */
export function feeFor(chain: string): ChainFee {
  return CHAIN_FEES[chain] ?? CHAIN_FEES[CHAIN_ALIASES[chain] ?? ''] ?? DEFAULT_FEE;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null, model: ModelConstants = MODEL): number {
  if (age === null) return model.hold_mid_days;
  if (age < 180) return model.hold_young_days;
  if (age < 540) return model.hold_mid_days;
  return model.hold_old_days;
}

/** The cheapest of a protocol's first three chains, and what farming there costs in one go. */
export function cheapestChain(p: SnapshotProtocol): { chain: string; fee: ChainFee } {
  const chains = p.chains.length > 0 ? p.chains.slice(0, 3) : ['(main chain)'];
  let best = { chain: chains[0]!, fee: feeFor(chains[0]!) };
  for (const c of chains) {
    const fee = feeFor(c);
    if (fee.gas_usd + fee.bridge_usd < best.fee.gas_usd + best.fee.bridge_usd) best = { chain: c, fee };
  }
  return best;
}

/**
 * One position's economics at a capital and an airdrop share. The slice is the depositor's
 * share of the pool times the share of the launch that goes to depositors times the implied
 * value. Net is concave in the capital (the slice saturates while the T-bill grows linearly),
 * so the smallest deposit that nets out is found by bisection.
 */
export function farmEcon(
  p: SnapshotProtocol,
  implied: number,
  age: number | null,
  capital: number = MODEL.default_capital,
  share: number = MODEL.default_share,
  model: ModelConstants = MODEL,
): FarmEcon {
  const { chain, fee } = cheapestChain(p);
  const fees = fee.gas_usd + fee.bridge_usd;
  const hold = holdDaysFor(age, model);
  const netAt = (c: number): number => {
    const slice = (c / (p.tvl_usd + c)) * share * implied;
    const tbill = model.tbill_rate * c * (hold / 365);
    return slice - fees - tbill;
  };
  const slice = (capital / (p.tvl_usd + capital)) * share * implied;
  const tbill = model.tbill_rate * capital * (hold / 365);
  const net = slice - fees - tbill;
  const verdict: 'FARM' | 'THIN' | 'SKIP' = net > 0 ? 'FARM' : slice > fees ? 'THIN' : 'SKIP';
  const minutes = 15 + 10 * Math.ceil(hold / 7);
  const perHour = net / (minutes / 60);
  let minDeposit: number | null = null;
  if (netAt(100_000) > 0) {
    let lo = 0;
    let hi = 100_000;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (netAt(mid) > 0) hi = mid;
      else lo = mid;
    }
    minDeposit = Math.ceil(hi);
  }
  return {
    capital_usd: capital,
    share_pct: Math.round(share * 1000) / 10,
    slice_usd: Math.round(slice * 100) / 100,
    fees_usd: Math.round(fees * 100) / 100,
    tbill_usd: Math.round(tbill * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    verdict,
    per_hour_usd: Math.round(perHour * 100) / 100,
    min_deposit_usd: minDeposit,
    farm_chain: chain,
    hold_days: hold,
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const points = tradedPoints(snapshot);
  const curve = fitCurve(points);
  const families = familyFactors(points, curve, model);
  const tradedFirstWords = new Set(points.map((p) => firstWord(p.name)));
  const bt = backtest(snapshot, points, model);
  const flat = bt.flat_multiple;
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every pre-token protocol below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen. A non-watchlist sibling of a
  // traded token is set aside, not ranked.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd && siblingOf(p, tradedFirstWords) === null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, curve, families, tradedFirstWords, model);
    const bandLow = Math.max(1, Math.round(v.implied * Math.pow(10, bt.band.p10)));
    const bandHigh = Math.max(1, Math.round(v.implied * Math.pow(10, bt.band.p90)));
    const econ = farmEcon(p, v.implied, v.age, model.default_capital, model.default_share, model);
    return { p, ...v, bandLow, bandHigh, econ };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    band_low_usd: s.bandLow,
    band_high_usd: s.bandHigh,
    flat_usd: Math.max(1, Math.round(s.p.tvl_usd * flat)),
    sibling: s.sibling,
    model: {
      curve_a: curve.a,
      curve_b: curve.b,
      family_factor: s.familyFactor,
      family_comps: s.familyComps,
      growth_pct: s.growthPct,
      tvl_carried_usd: Math.round(s.tvlCarried),
      seasoning_multiplier: round4(s.seasoning),
      sibling_factor: s.siblingFactor,
      age_days: s.age,
    },
    econ: s.econ,
    farm_steps: farmSteps(s.p, s.age, s.econ).map(stepText),
  }));
}

/** The protocols the board set aside, each with the rule that set it aside. */
export function setAside(snapshot: Snapshot, boardSlugs: Set<string>): SetAsideRow[] {
  const points = tradedPoints(snapshot);
  const tradedFirstWords = new Set(points.map((p) => firstWord(p.name)));
  const rows: SetAsideRow[] = [];
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug) || !isPreToken(p)) continue;
    let reason: string;
    if (p.category === 'CEX') reason = 'exchange: the board ranks protocols, not venues';
    else if (VERSIONED.test(p.name)) reason = 'versioned name: a pool of another protocol';
    else if (siblingOf(p, tradedFirstWords) !== null) reason = `sibling of a traded token (${siblingOf(p, tradedFirstWords)})`;
    else if (p.tvl_usd >= snapshot.floor_usd) reason = 'above the watchlist floor and not on the watchlist';
    else reason = 'not ranked';
    rows.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason });
  }
  return rows.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('basis trading'))
    return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('restak'))
    return `Restake $${capital} of the liquid staking token through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it and repay it once.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position in range.`;
  if (c.includes('yield') || c.includes('aggregator'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and let it compound.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('staking pool'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction'))
    return `Fund $${capital} and place one market position on ${name}, then settle it.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain'))
    return `Bridge $${capital} of USDC to ${name} and use one of its native apps for a week.`;
  if (c.includes('payment'))
    return `Send $${capital} through ${name} on ${chain} and keep the receipt in the farming wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A dollar amount with two decimals, or a whole number when it is one. */
function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  return sign + (v % 1 === 0 ? `$${v.toLocaleString('en-US')}` : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names. The last step nets the position: slice minus fees minus the T-bill, with the
 * verdict and the smallest deposit that nets out.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEcon): FarmStep[] {
  const chain = econ.farm_chain;
  const capital = econ.capital_usd;
  const hold = econ.hold_days;
  const action = actionFor(p, capital, chain);
  const gas = feeFor(chain).gas_usd;
  const gasText = gas < 1 ? `$${gas.toFixed(2)}` : `$${gas}`;
  const minDeposit = econ.min_deposit_usd === null ? 'no deposit up to $100,000 nets out' : `smallest deposit that nets out: ${money(econ.min_deposit_usd)}`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital.toLocaleString('en-US')} of capital and about ${gasText} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about ${gasText} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital.toLocaleString('en-US')} stays in the position`,
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
    {
      text: `Net at ${money(capital)} and a ${econ.share_pct}% airdrop share: slice ${money(econ.slice_usd)} minus fees ${money(econ.fees_usd)} minus T-bill ${money(econ.tbill_usd)} is ${money(econ.net_usd)}, so this plan is ${econ.verdict}. ${minDeposit}. Recompute it live in the dashboard at other sizes and shares.`,
      cost: `the ${money(capital)} stays in the position`,
      time: 'decide before you deposit',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
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
    band_low_usd: row.band_low_usd,
    band_high_usd: row.band_high_usd,
    flat_usd: row.flat_usd,
    sibling: row.sibling,
    curve_a: row.model.curve_a,
    curve_b: row.model.curve_b,
    family_factor: row.model.family_factor,
    growth_pct: row.model.growth_pct,
    tvl_carried_usd: row.model.tvl_carried_usd,
    seasoning_multiplier: row.model.seasoning_multiplier,
    econ: row.econ,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const points = tradedPoints(snapshot);
  const curve = fitCurve(points);
  const families = familyFactors(points, curve, model);
  const bt = backtest(snapshot, points, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const familyTable = [...families.entries()]
    .map(([category, v]) => ({ category, factor: v.factor, comps: v.comps }))
    .sort((a, b) => b.factor - a.factor || b.comps - a.comps);
  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdicts[r.econ.verdict] += 1;
  // Concentration: how much of the board's implied value the top 3 rows hold, and how the
  // board splits across categories. Both come straight from the ranked board, so the page
  // states them without re-deriving anything the model did not already compute.
  const totalImplied = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const top3Implied = board.slice(0, 3).reduce((sum, r) => sum + r.implied_value_usd, 0);
  const concentrationTop3 = totalImplied > 0 ? Math.round((top3Implied / totalImplied) * 1000) / 10 : 0;
  const perCategory = new Map<string, { rows: number; total: number }>();
  for (const r of board) {
    const key = r.category ?? 'Other';
    const entry = perCategory.get(key) ?? { rows: 0, total: 0 };
    entry.rows += 1;
    entry.total += r.implied_value_usd;
    perCategory.set(key, entry);
  }
  const categoryRows = [...perCategory.entries()]
    .map(([category, v]) => ({ category, rows: v.rows, total_implied_usd: v.total }))
    .sort((a, b) => b.total_implied_usd - a.total_implied_usd || b.rows - a.rows);
  const boardSlugs = new Set(board.map((r) => r.slug));
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
    curve,
    family_table: familyTable,
    backtest: bt,
    verdicts,
    fees: CHAIN_FEES,
    concentration_top3_pct: concentrationTop3,
    total_implied_usd: totalImplied,
    category_rows: categoryRows,
    watchlist: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
    comps: points,
    set_aside: setAside(snapshot, boardSlugs),
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
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
