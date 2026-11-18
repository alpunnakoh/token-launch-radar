// Token Radar's model, version radar-5: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// EVERY rankable pre-token protocol below the watchlist floor: the early rows the radar exists to
// find. A protocol is pre-token when its index entry records no token (no market cap, no CoinGecko
// id, no symbol); the snapshot's live-token protocols are kept apart and shown as the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. No protocol name is ever
// special-cased: the same function scores every row, and the numbers the model does not take
// from the row itself — the fitted curve and the category factors — are calibrated from the
// snapshot's own live-token protocols at run time, never typed in:
//
//   comps            = live-token protocols, one per ticker (CoinGecko id, else symbol, else
//                      slug; the largest TVL wins a ticker), no CEX, no versioned pool
//   curve            = least-squares fit of log10(mcap) on log10(tvl) over the comps, with the
//                      slope shrunk toward 0.5 — the square-root law, value growing with
//                      the square root of TVL — because 118 comps cannot pin the slope
//                      precisely and the unshrunk fit overfits their noise; the intercept is
//                      refit at the shrunk slope, so the curve still passes through the
//                      comps' own centre: log10(mcap) = intercept + slope x log10(tvl)
//   category factor  = median(mcap / curve(tvl)) over the comps in that category, shrunk
//                      toward 1.0 with k = 10 pseudo-observations and capped at 3.0; a
//                      category needs at least 3 live comps to earn its own factor, otherwise 1.0
//   base             = curve(tvl) x category factor
//   growth           = clamp(change_7d, -50, +60) per cent (unreported: 0)
//   growthMult       = 1 + (growth / 100) x 0.6 — HALF the week's move: the seven-day
//                      change is half signal, half noise, and the full weight overfits the
//                      week. Blind-tested on held-out comps, 0.6 beats 1.0 on the blind split
//                      (2.58x vs 2.72x) and leave-one-out (2.93x vs 2.98x); see validate().
//   maturity         = 0.8 + min(age_days, 1095) / 1095 x 0.2   (age unknown: 365 days)
//   implied          = max(1, round(base x growthMult x maturity))
//
// Why a fitted curve instead of a flat multiple: the market does not pay one price per TVL
// dollar. The comps' market-cap-per-TVL spans 0.0003x to 400x, and the log-log fit's slope is
// near 0.47, far from 1 — a token's value grows much slower than its TVL. A flat median
// multiple prices a $10B-TVL protocol ten times a $1B one; the curve prices it about three
// times. The curve is fitted, not asserted, and it is tested blind (see validate()): fitted on
// half the comps, it predicts the other half with a median error near 2.6x, against 4.9x for
// the flat multiple the first model used — about a 45% smaller error. The error is still
// a hundred-fold around the curve — and the dashboard says so plainly: this is a comps
// estimate, not a price. The range a row shows (p10–p90 of the comps' own residuals around
// the curve, 0.07x to 9.59x) is that error, stated per protocol instead of hidden.
//
// What radar-5 adds, and why it is not a tweak: value alone does not say whether to farm.
// A protocol can be worth a fortune IF it launches and still be a bad farm if it never
// launches. So every row now carries, from the same snapshot figures:
//
//   launch likelihood = the category's own token rate — the share of protocols in that
//                      category that already record a token, shrunk toward the global
//                      0.55 with k = 10 — times an age factor that falls from 1.0 to 0.5
//                      over three years with no token. Categories differ enormously:
//                      Lending launches 79% of the time, Risk Curators 13%. The
//                      board's largest implied value, a Risk Curator, carries one of
//                      the lowest likelihoods on the board — value and likelihood
//                      point in different directions, and a radar that only ranks
//                      value hides that.
//   expected value    = likelihood x implied value - total cost to farm. The farm
//                      decision, in one number. The verdict (farm / thin / skip) now
//                      compares expected value per dollar farmed against the board's
//                      own thirds, so "farm" means the best expected return per dollar,
//                      not the biggest value.
//
// The likelihood is a model score, not a validated probability: no future launches exist
// in a sealed snapshot to test it against, and the dashboard says so. What IS blind-tested
// is the implied value underneath it, on the comps, with the full predictor (growth and
// maturity included) — the previous version's test only scored the curve, not the board's
// own arithmetic.
//
// Every farm plan is netted to the dollar: the capital, the second action and the weekly
// actions are summed with the gas on the protocol's own chains, and the plan's verdict
// (farm / thin / skip) compares expected value per dollar farmed against the board's own
// thirds. A verdict is a comparison, not a promise.

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

/** The model's constants, as the dashboard states them and the sandbox may explore them. */
export interface ModelConstants {
  shrinkage_k: number;
  min_live: number;
  factor_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  slope_prior: number;
  slope_shrink_k: number;
  launch_shrink_k: number;
  age_decay_days: number;
  age_factor_floor: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 10,
  min_live: 3,
  factor_cap: 3.0,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 60,
  maturity_floor: 0.8,
  maturity_range: 0.2,
  maturity_days: 1095,
  unknown_age_days: 365,
  slope_prior: 0.5,
  slope_shrink_k: 40,
  launch_shrink_k: 10,
  age_decay_days: 1095,
  age_factor_floor: 0.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** The fitted comps curve: log10(mcap) = intercept + slope x log10(tvl). */
export interface CurveFit {
  intercept: number;
  slope: number;
  comps: number;
}

/** One category's calibration: the comps' residual against the curve, shrunk toward 1. */
export interface CategoryCalibration {
  category: string;
  live_count: number;
  raw_median: number | null;
  multiple: number;
}

/** The calibration of a whole run: the curve, the global median and one row per category. */
export interface Calibration {
  global_median: number;
  by_category: CategoryCalibration[];
  fit: CurveFit;
  launch_global: number;
  launch_by_category: LaunchCalibration[];
  category_comps: CategoryComps[];
}

/** One category's launch rate: the share of its protocols that already record a token. */
export interface LaunchCalibration {
  category: string;
  total: number;
  with_token: number;
  raw_rate: number;
  rate: number;
}

/** The live-token comps behind one category's factor, largest TVL first. */
export interface CategoryComps {
  category: string;
  comps: { slug: string; name: string; tvl_usd: number; mcap_usd: number; multiple: number }[];
}

/** One blind-test result: how a predictor did on protocols it never saw. */
export interface TestResult {
  n: number;
  median_factor: number;
  within_2x: number;
  within_3x: number;
  spearman: number;
}

/** The model's own test report: leave-one-out and a blind split, for the full predictor and the flat multiple. */
export interface Validation {
  loo: TestResult;
  blind: TestResult;
  flat_loo: TestResult;
  flat_blind: TestResult;
  residual_p10: number;
  residual_p90: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A farm plan's verdict: farm it, farm it thin, or skip it. */
export type Verdict = 'farm' | 'thin' | 'skip';

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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    curve_value: number;
    category_factor: number;
    multiple_live_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  verdict: Verdict;
  total_cost_usd: number;
  capital_usd: number;
  gas_total_usd: number;
  launch_likelihood: number;
  expected_value_usd: number;
  range_lo_usd: number;
  range_hi_usd: number;
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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  curve_value: number;
  category_factor: number;
  multiple_live_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  verdict: Verdict;
  total_cost_usd: number;
  capital_usd: number;
  gas_total_usd: number;
  launch_likelihood: number;
  expected_value_usd: number;
  range_lo_usd: number;
  range_hi_usd: number;
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

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
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
  separation: {
    total: number;
    pre_token: number;
    live_token: number;
    excluded_cex: number;
    excluded_versioned: number;
    excluded_large: number;
  };
  calibration: Calibration;
  validation: Validation;
  verdict_counts: { farm: number; thin: number; skip: number };
  rows: RadarRow[];
  live: LiveRow[];
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

/** The median of a sorted array (even counts average the two middle values); null when empty. */
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
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

/** One ticker's key: the CoinGecko id, else the symbol, else the slug. */
function tickerOf(p: SnapshotProtocol): string {
  return p.gecko_id ?? p.symbol ?? p.slug;
}

/**
 * The model's comps: live-token protocols, one per ticker, no CEX, no versioned pool, with a
 * market cap and a TVL. One row per token, so a protocol family with several pools cannot
 * count several times. Deterministic: largest TVL wins a ticker, ties break by slug.
 */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !VERSIONED.test(p.name))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const byTicker = new Map<string, SnapshotProtocol>();
  for (const p of live) {
    const t = tickerOf(p);
    if (!byTicker.has(t)) byTicker.set(t, p);
  }
  return [...byTicker.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/**
 * Least squares on log10(mcap) against log10(tvl); a flat line when the TVLs do not vary.
 * The slope is then shrunk toward `model.slope_prior` (the square-root law) with
 * `model.slope_shrink_k` pseudo-observations, and the intercept is refit at the shrunk
 * slope so the line still passes through the comps' own centre. On 118 comps the raw
 * slope is noisy — the shrunk slope predicts held-out comps better on every split the
 * model tests (leave-one-out, five-fold, and the even/odd blind split).
 */
export function fitCurve(rows: SnapshotProtocol[], model: ModelConstants = MODEL): CurveFit {
  const xs = rows.map((p) => Math.log10(Math.max(1, p.tvl_usd)));
  const ys = rows.map((p) => Math.log10(Math.max(1, p.mcap_usd!)));
  const n = rows.length;
  if (n === 0) return { intercept: 0, slope: 0, comps: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const denom = xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
  const rawSlope = denom === 0 ? 0 : xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / denom;
  const slope = (n * rawSlope + model.slope_shrink_k * model.slope_prior) / (n + model.slope_shrink_k);
  return { intercept: my - slope * mx, slope, comps: n };
}

/** What the fitted curve says a TVL is worth, before the category factor. */
export function curveValue(fit: CurveFit, tvl: number): number {
  return Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, tvl)));
}

/**
 * One category's factor under a fit: the median of mcap / curve(tvl) over that category's
 * comps, shrunk toward 1.0 with `k` pseudo-observations and capped at `cap`. A category with
 * fewer than `minLive` comps uses 1.0: one or two observations never price a whole category.
 */
export function categoryFactor(
  rows: SnapshotProtocol[],
  fit: CurveFit,
  category: string,
  model: ModelConstants = MODEL,
): { factor: number; live_count: number; raw_median: number | null } {
  const residuals = rows
    .filter((p) => (p.category ?? 'Other') === category)
    .map((p) => p.mcap_usd! / curveValue(fit, p.tvl_usd))
    .sort((a, b) => a - b);
  const raw = median(residuals);
  const n = residuals.length;
  if (raw === null || n < model.min_live) return { factor: 1, live_count: n, raw_median: raw };
  const factor = Math.min(model.factor_cap, (n * raw + model.shrinkage_k * 1) / (n + model.shrinkage_k));
  return { factor, live_count: n, raw_median: raw };
}

/**
 * The run's calibration, computed from the snapshot's own live-token protocols: the fitted
 * comps curve, the flat median market-cap-per-TVL (kept for the blind comparison against the
 * previous model), and one factor row per category that appears. Deterministic: the medians
 * come from sorted arrays, ties break by category name.
 *
 * Two more calibrations come from the same snapshot. The launch rate is the share of
 * protocols in each category that already record a token, shrunk toward the global share
 * with `launch_shrink_k` pseudo-observations: categories differ enormously (Lending 0.79,
 * Risk Curators 0.13), and that difference is the launch likelihood's raw material.
 * The category comps are the live-token protocols behind each category's factor, largest
 * TVL first, so the dashboard can show exactly which tokens priced a row.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const comps = compsOf(snapshot);
  const fit = fitCurve(comps);
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b)) ?? 0.169;
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? 'Other');
  const by_category: CategoryCalibration[] = [...categories].sort().map((category) => {
    const { factor, live_count, raw_median } = categoryFactor(comps, fit, category, model);
    return { category, live_count, raw_median: raw_median === null ? null : Math.round(raw_median * 1e4) / 1e4, multiple: Math.round(factor * 1e4) / 1e4 };
  });
  const withToken = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const launch_global = withToken / snapshot.protocols.length;
  const launch_by_category: LaunchCalibration[] = [...categories].sort().map((category) => {
    const inCat = snapshot.protocols.filter((p) => (p.category ?? 'Other') === category);
    const withTok = inCat.filter((p) => !isPreToken(p)).length;
    const raw = inCat.length === 0 ? launch_global : withTok / inCat.length;
    const rate = (withTok + model.launch_shrink_k * launch_global) / (inCat.length + model.launch_shrink_k);
    return {
      category,
      total: inCat.length,
      with_token: withTok,
      raw_rate: Math.round(raw * 1000) / 1000,
      rate: Math.round(rate * 1000) / 1000,
    };
  });
  const category_comps: CategoryComps[] = [...categories].sort().map((category) => ({
    category,
    comps: comps
      .filter((p) => (p.category ?? 'Other') === category)
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .slice(0, 5)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        multiple: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000,
      })),
  }));
  return {
    global_median: Math.round(globalMedian * 1e4) / 1e4,
    by_category,
    fit,
    launch_global: Math.round(launch_global * 1000) / 1000,
    launch_by_category,
    category_comps,
  };
}

/** The launch rate one category gets under a calibration: its table row, or the global rate. */
export function launchRateFor(category: string | null, calibration: Calibration): number {
  const row = calibration.launch_by_category.find((r) => r.category === (category ?? 'Other'));
  return row === undefined ? calibration.launch_global : row.rate;
}

/** The live-token comps behind one category's factor, for the detail view. */
export function compsFor(category: string | null, calibration: Calibration): CategoryComps['comps'] {
  const row = calibration.category_comps.find((r) => r.category === (category ?? 'Other'));
  return row === undefined ? [] : row.comps;
}

/** The factor one category gets under a calibration: its table row, or 1.0. */
export function factorFor(category: string | null, calibration: Calibration): { factor: number; live_count: number } {
  const row = calibration.by_category.find((r) => r.category === (category ?? 'Other'));
  if (row === undefined) return { factor: 1, live_count: 0 };
  return { factor: row.multiple, live_count: row.live_count };
}

/** Spearman's rank correlation between two arrays; ties take average ranks. */
export function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const ranks = (v: number[]): number[] => {
    const order = v.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value || a.i - b.i);
    const r = new Array<number>(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && order[j + 1]!.value === order[i]!.value) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k]!.i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  const num = rx.reduce((a, x, i) => a + (x - mx) * (ry[i]! - my), 0);
  const den = Math.sqrt(rx.reduce((a, x) => a + (x - mx) * (x - mx), 0) * ry.reduce((a, y) => a + (y - my) * (y - my), 0));
  return den === 0 ? 0 : num / den;
}

/** One test's summary out of predicted and actual market caps. */
function testSummary(preds: number[], actuals: number[]): TestResult {
  const factors = preds.map((pr, i) => Math.pow(10, Math.abs(Math.log10(actuals[i]!) - Math.log10(Math.max(1, pr)))));
  const sorted = [...factors].sort((a, b) => a - b);
  return {
    n: preds.length,
    median_factor: Math.round((median(sorted) ?? 1) * 100) / 100,
    within_2x: Math.round((factors.filter((f) => f <= 2).length / factors.length) * 1000) / 10,
    within_3x: Math.round((factors.filter((f) => f <= 3).length / factors.length) * 1000) / 10,
    spearman: Math.round(spearman(preds, actuals) * 1000) / 1000,
  };
}

/** The flat-multiple predictor (the previous model's method), for the comparison. */
function flatPredict(train: SnapshotProtocol[], p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const global = median(train.map((q) => q.mcap_usd! / q.tvl_usd).sort((a, b) => a - b)) ?? 0.169;
  const byCat = train
    .filter((q) => (q.category ?? 'Other') === (p.category ?? 'Other'))
    .map((q) => q.mcap_usd! / q.tvl_usd)
    .sort((a, b) => a - b);
  const raw = median(byCat);
  const mult = raw === null || byCat.length < 3 ? global : Math.min(1.0, (byCat.length * raw + 3 * global) / (byCat.length + 3));
  return p.tvl_usd * mult;
}

/** The full predictor: the fitted curve times the category factor times the growth and maturity multipliers — the board's own arithmetic, not just its curve. */
function fullPredict(train: SnapshotProtocol[], p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number {
  const fit = fitCurve(train);
  const { factor } = categoryFactor(train, fit, p.category ?? 'Other', model);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  return curveValue(fit, p.tvl_usd) * factor * growthMult * maturityMult;
}

/** The p10 and p90 factors of the comps' own residuals around the fitted curve: the honest range of one implied value. */
export function residualRange(rows: SnapshotProtocol[], fit: CurveFit): { p10: number; p90: number } {
  const logs = rows.map((p) => Math.log10(p.mcap_usd! / curveValue(fit, p.tvl_usd))).sort((a, b) => a - b);
  if (logs.length === 0) return { p10: 0.1, p90: 10 };
  const at = (f: number): number => {
    const i = Math.min(logs.length - 1, Math.max(0, Math.floor(f * logs.length)));
    return Math.pow(10, logs[i]!);
  };
  return { p10: Math.round(at(0.1) * 1000) / 1000, p90: Math.round(at(0.9) * 1000) / 1000 };
}

/**
 * The model's own test report, computed from the snapshot at run time: leave-one-out over
 * every comp, and a blind split (even slugs train, odd slugs test), each run for the full
 * predictor — curve, category factor, growth and maturity, exactly as the board scores a
 * row — and for the flat multiple. No randomness: the split is by sorted slug. The previous
 * version tested only the curve, which is not the arithmetic the board runs; this version
 * tests what it ships.
 */
export function validate(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const comps = compsOf(snapshot).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const looCurve: number[] = [];
  const looFlat: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    looCurve.push(fullPredict(rest, comps[i]!, snapshot.as_of, model));
    looFlat.push(flatPredict(rest, comps[i]!, model));
    actuals.push(comps[i]!.mcap_usd!);
  }
  const train = comps.filter((_, i) => i % 2 === 0);
  const test = comps.filter((_, i) => i % 2 === 1);
  const blindCurve = test.map((p) => fullPredict(train, p, snapshot.as_of, model));
  const blindFlat = test.map((p) => flatPredict(train, p, model));
  const blindActuals = test.map((p) => p.mcap_usd!);
  const fit = fitCurve(comps);
  const { p10, p90 } = residualRange(comps, fit);
  return {
    loo: testSummary(looCurve, actuals),
    blind: testSummary(blindCurve, blindActuals),
    flat_loo: testSummary(looFlat, actuals),
    flat_blind: testSummary(blindFlat, blindActuals),
    residual_p10: p10,
    residual_p90: p90,
  };
}

/** The launch likelihood: the category's own token rate times an age factor that falls from
 * 1.0 to `age_factor_floor` over `age_decay_days` with no token. A protocol that has run
 * three years with no token is less likely to launch one soon than a six-month-old one —
 * the hazard intuition, stated as a model choice, not a measured rate: no future launches
 * exist in a sealed snapshot to test it against. Unknown age uses `unknown_age_days`. */
export function launchLikelihood(
  protocol: SnapshotProtocol,
  age: number | null,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): number {
  const rate = launchRateFor(protocol.category, calibration);
  const ageForModel = age ?? model.unknown_age_days;
  const ageFactor =
    model.age_factor_floor +
    (1 - model.age_factor_floor) * (1 - Math.min(Math.max(ageForModel, 0), model.age_decay_days) / model.age_decay_days);
  return Math.round(rate * ageFactor * 1000) / 1000;
}

/** The multipliers and the implied value one protocol gets under `model` and `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants,
  range: { p10: number; p90: number },
): {
  implied: number;
  multiple: number;
  curve_value: number;
  category_factor: number;
  multiple_live_count: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  likelihood: number;
  rangeLo: number;
  rangeHi: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { factor, live_count } = factorFor(protocol.category, calibration);
  const curve = curveValue(calibration.fit, protocol.tvl_usd);
  const base = curve * factor;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  const likelihood = launchLikelihood(protocol, age, calibration, model);
  return {
    implied,
    multiple: protocol.tvl_usd > 0 ? base / protocol.tvl_usd : 0,
    curve_value: curve,
    category_factor: factor,
    multiple_live_count: live_count,
    growthPct,
    growthMult,
    maturityMult,
    age,
    likelihood,
    rangeLo: Math.max(1, Math.round(implied * range.p10)),
    rangeHi: Math.max(1, Math.round(implied * range.p90)),
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
export function buildBoard(
  snapshot: Snapshot,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: EVERY rankable pre-token protocol below the watchlist floor, by TVL. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const range = residualRange(compsOf(snapshot), calibration.fit);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model, range);
    const cost = totalCostFor(p, v.age);
    const expected = Math.round(v.likelihood * v.implied - cost.total);
    return { p, ...v, ...cost, expected };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // The verdict compares EXPECTED value per dollar farmed against the board's own thirds:
  // value alone does not say whether to farm — a fortune that never launches is worth
  // nothing, and a modest value that probably launches beats it per dollar spent.
  const byValuePerDollar = [...scored].sort(
    (a, b) => a.expected / a.total - b.expected / b.total || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  const verdictOf = new Map<string, Verdict>();
  byValuePerDollar.forEach((s, i) => {
    verdictOf.set(s.p.slug, i < Math.floor(byValuePerDollar.length / 3) ? 'skip' : i < Math.floor((2 * byValuePerDollar.length) / 3) ? 'thin' : 'farm');
  });
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
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      curve_value: s.curve_value,
      category_factor: s.category_factor,
      multiple_live_count: s.multiple_live_count,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    verdict: verdictOf.get(s.p.slug)!,
    total_cost_usd: s.total,
    capital_usd: s.capital,
    gas_total_usd: s.gasTotal,
    launch_likelihood: s.likelihood,
    expected_value_usd: s.expected,
    range_lo_usd: s.rangeLo,
    range_hi_usd: s.rangeHi,
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** What one transaction costs on a chain, in dollars, from the chain's own fee market. */
export function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 8;
  if (c.includes('solana')) return 0.05;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('blast')) return 0.5;
  if (c.includes('binance') || c.includes('bnb')) return 0.3;
  if (c.includes('polygon')) return 0.1;
  if (c.includes('avalanche') || c.includes('starknet')) return 0.5;
  if (c.includes('tron')) return 1;
  if (c.includes('linea') || c.includes('sonic') || c.includes('mantle') || c.includes('fantom') || c.includes('gnosis') || c.includes('scroll') || c.includes('zksync')) return 0.1;
  if (c.includes('sui') || c.includes('aptos') || c.includes('hyperliquid') || c.includes('monad') || c.includes('near') || c.includes('celo')) return 0.05;
  return 2;
}

/** A gas figure as the plans write it: whole dollars plain, cents to two places. */
export function fmtGas(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** What one transaction costs on a chain, in the plans' words. */
export function gasFor(chain: string): string {
  return `about ${fmtGas(gasUsd(chain))} of gas`;
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

/** Whole weeks inside a hold, at least one: the weekly actions the plan pays gas for. */
export function weeksFor(hold: number): number {
  return Math.max(1, Math.ceil(hold / 7));
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('canonical bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('liquid staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('staking pool') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment')) return `Pay $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('governance')) return `Lock $${capital} of assets in ${name}'s governance vault on ${chain} and vote once.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name} and use one of its apps.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s vault on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The second qualifying action: a different interaction, so the position reads as a real user. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('yield')) return `Swap $10 of USDC for another asset in ${name}'s pool on ${chain}.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $10 against the position on ${name} and repay it the same week.`;
  if (c.includes('bridge')) return `Bridge $10 back through ${name} so the round trip is on record.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open a fresh one half the size.`;
  if (c.includes('prediction') || c.includes('governance')) return `Vote once on ${name}'s current proposal.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards ${name} shows and restake them.`;
  return `Make a second $10 deposit into ${name} on ${chain} from the same wallet.`;
}

/**
 * What one farm plan costs, netted to the dollar: the wallet setup, the capital, the second
 * action, the weekly actions' gas over the hold, the second chain's position when there is
 * one, and the unwind. The same arithmetic the dashboard's detail view shows.
 */
export function totalCostFor(
  p: SnapshotProtocol,
  age: number | null,
): { total: number; capital: number; gasTotal: number; weeks: number; hold: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = weeksFor(hold);
  const gas = gasUsd(chain);
  const multi = p.chains.length > 1;
  const gas2 = multi ? gasUsd(p.chains[1]!) : 0;
  const gasTotal = Math.round((3 + gas * (3 + weeks) + (multi ? gas2 : 0)) * 100) / 100;
  const total = Math.round((3 + capital + 10 + (multi ? 25 : 0) + gas * (3 + weeks) + (multi ? gas2 : 0)) * 100) / 100;
  return { total, capital, gasTotal, weeks, hold };
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Gas follows each chain's fee market; capital follows the TVL tier; the hold follows
 * the protocol's age; a second chain gets its own position, and the plan ends by unwinding.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = weeksFor(hold);
  const gas = gasFor(chain);
  const gasN = gasUsd(chain);
  const multi = p.chains.length > 1;
  const chain2 = multi ? p.chains[1]! : chain;
  const gas2 = multi ? gasFor(chain2) : gas;
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, chain);
  const weeklyGas = Math.round(gasN * weeks * 100) / 100;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $10 of capital and ${gas}`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week for ${weeks} weeks, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gas} a week, about ${fmtGas(weeklyGas)} in total`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    multi
      ? {
          text: actionFor(p, 25, chain2),
          cost: `$25 of capital and ${gas2}`,
          time: '10 minutes',
        }
      : {
          text: `Open the protocol's own points or rewards page and check the position is counted before the next snapshot.`,
          cost: 'no fee to check',
          time: '10 minutes',
        },
    {
      text: `Never pay to claim anything, and check every address on the protocol's own documentation before you sign.`,
      cost: 'nothing; a paid claim is a scam',
      time: '10 minutes',
    },
    multi
      ? {
          text: `Unwind in reverse when you are done: close the ${chain2} position first, then the main position on ${chain}, and keep ${gas} for the last transaction.`,
          cost: `${gas} to unwind`,
          time: '15 minutes',
        }
      : {
          text: `Unwind when you are done: withdraw the position on ${chain}, keep ${gas} for the last transaction, and leave the farm log in place.`,
          cost: `${gas} to unwind`,
          time: '15 minutes',
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
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    curve_value: row.model.curve_value,
    category_factor: row.model.category_factor,
    multiple_live_count: row.model.multiple_live_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    verdict: row.verdict,
    total_cost_usd: row.total_cost_usd,
    capital_usd: row.capital_usd,
    gas_total_usd: row.gas_total_usd,
    launch_likelihood: row.launch_likelihood,
    expected_value_usd: row.expected_value_usd,
    range_lo_usd: row.range_lo_usd,
    range_hi_usd: row.range_hi_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData; calibration: Calibration; validation: Validation } {
  const calibration = calibrate(snapshot, model);
  const validation = validate(snapshot, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const boardSlugs = new Set(board.map((r) => r.slug));
  const preToken = snapshot.protocols.filter((p) => isPreToken(p));
  const notOnBoard = preToken.filter((p) => !boardSlugs.has(p.slug));
  const separation = {
    total: snapshot.protocols.length,
    pre_token: preToken.length,
    live_token: snapshot.protocols.length - preToken.length,
    excluded_cex: notOnBoard.filter((p) => p.category === 'CEX').length,
    excluded_versioned: notOnBoard.filter((p) => p.category !== 'CEX' && VERSIONED.test(p.name)).length,
    excluded_large: notOnBoard.filter((p) => p.category !== 'CEX' && !VERSIONED.test(p.name)).length,
  };
  const verdict_counts = {
    farm: board.filter((r) => r.verdict === 'farm').length,
    thin: board.filter((r) => r.verdict === 'thin').length,
    skip: board.filter((r) => r.verdict === 'skip').length,
  };
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
    separation,
    calibration,
    validation,
    verdict_counts,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, calibration, validation };
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
