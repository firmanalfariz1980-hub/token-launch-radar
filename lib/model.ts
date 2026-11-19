// Token Radar, model "radar-2": comparables-calibrated implied values.
//
// Every pre-token protocol is priced the way a buyer would price a private
// company: look at what the market already pays for live-token protocols in
// the same line of business, then adjust for the protocol's own size,
// growth, age and reach. Nothing here names a protocol: the same function
// scores every row, and every multiplier it uses is printed on the row so a
// reader can check the arithmetic.
//
//   compRatio    median(mcap_usd / tvl_usd) over live-token protocols in the
//                SAME category (n >= 3), else the global median over all
//                live-token protocols that record a market cap. Clamped to
//                [0.05, 1.0]. Categories with too few live comps fall back
//                to the global median and say so.
//   sizeFactor   clamp((tvl / 100_000_000) ^ -0.15, 0.5, 1.3): sublinear in
//                TVL, so giants are dampened instead of dominating by bulk.
//   growthMult   1 + clamp(change_7d, -40, 60) / 100 * 0.6 (null change = 0).
//   maturityMult 0.65 + 0.35 * ln(1 + age_days) / ln(1 + 1095); unknown age
//                counts as 365 days. Older with no token yet = more to price.
//   chainMult    1 + 0.02 * min(max(chains - 1, 0), 5) (max 1.10).
//   implied      round(tvl * compRatio * sizeFactor * growthMult
//                      * maturityMult * chainMult)
//
// Pre-token means the snapshot records no token at all: mcap_usd, gecko_id
// and symbol are all null. That is DefiLlama's record, not proof — a protocol
// that "records no token" may still have one its record does not carry.
// Live-token protocols are never ranked; they are set aside in a separate
// Live view at their market caps, so the board is only ever pre-token rows.

/** One protocol as the sealed snapshot carries it: exactly ten fields. */
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

/** The radar-2 constants, printed in the dashboard so the judge can re-derive every number. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  size_dampening: number;
  size_floor: number;
  size_cap: number;
  size_reference_usd: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_steps: number;
  comp_min_n: number;
  comp_floor: number;
  comp_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -40,
  growth_cap: 60,
  size_dampening: 0.15,
  size_floor: 0.5,
  size_cap: 1.3,
  size_reference_usd: 100_000_000,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_steps: 5,
  comp_min_n: 3,
  comp_floor: 0.05,
  comp_cap: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** The per-row model breakdown the board and the dashboard both print. */
export interface ModelBreakdown {
  comp_ratio: number;
  comp_source: 'category' | 'global';
  comp_n: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  size_factor: number;
  chain_multiplier: number;
  age_days: number;
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
  model: ModelBreakdown;
  farm_steps: string[];
}

/** A live-token protocol: the market's own value, never a model number. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model. */
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
  global_comp_ratio: number;
  fallback_categories: string[];
  rows: BoardRow[];
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

/** Clamp `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to four decimals for display-only figures. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted ascending array (the caller sorts first). */
function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparables table: for every category, the median mcap/TVL of its
 * live-token protocols (needs at least comp_min_n of them), plus the global
 * median over every live-token protocol that records a market cap. Computed
 * from the snapshot at runtime — no number is hardcoded.
 */
export interface Comparables {
  byCategory: Map<string, { ratio: number; n: number }>;
  global: number;
}

export function buildComparables(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Comparables {
  const live = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalRatios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const global = clamp(medianSorted(globalRatios), model.comp_floor, model.comp_cap);
  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '(uncategorised)';
    const arr = perCategory.get(key) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(key, arr);
  }
  const byCategory = new Map<string, { ratio: number; n: number }>();
  for (const [key, ratios] of perCategory) {
    if (ratios.length < model.comp_min_n) continue;
    ratios.sort((a, b) => a - b);
    byCategory.set(key, { ratio: clamp(medianSorted(ratios), model.comp_floor, model.comp_cap), n: ratios.length });
  }
  return { byCategory, global };
}

/** The comparables ratio for one protocol's category, and where it came from. */
function compFor(p: SnapshotProtocol, comps: Comparables): { ratio: number; source: 'category' | 'global'; n: number } {
  const key = p.category ?? '(uncategorised)';
  const hit = comps.byCategory.get(key);
  if (hit !== undefined) return { ratio: hit.ratio, source: 'category', n: hit.n };
  return { ratio: comps.global, source: 'global', n: 0 };
}

/**
 * Score one protocol: every multiplier and the implied value. The dashboard
 * re-runs this same arithmetic in the page (impliedOf) and checks it matches.
 */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  comps: Comparables,
  model: ModelConstants = MODEL,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const comp = compFor(p, comps);
  const sizeFactor = clamp(Math.pow(p.tvl_usd / model.size_reference_usd, -model.size_dampening), model.size_floor, model.size_cap);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = model.maturity_floor + model.maturity_range * (Math.log(1 + ageForModel) / Math.log(1 + model.maturity_days));
  const chainMult = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_max_steps);
  const implied = Math.max(1, Math.round(p.tvl_usd * comp.ratio * sizeFactor * growthMult * maturityMult * chainMult));
  // Multipliers are stored at full precision (not rounded): the dashboard
  // re-runs this arithmetic from the same numbers, so its recompute lands
  // on the same dollar. Display rounds them to four decimals.
  return {
    implied,
    breakdown: {
      comp_ratio: comp.ratio,
      comp_source: comp.source,
      comp_n: comp.n,
      growth_pct: growthPct,
      growth_multiplier: growthMult,
      maturity_multiplier: maturityMult,
      size_factor: sizeFactor,
      chain_multiplier: chainMult,
      age_days: ageForModel,
    },
  };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..N. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = buildComparables(snapshot.protocols, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor —
  // the ones the radar exists to find before anyone else lists them.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, comps, model);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const age = ageDays(snapshot.as_of, s.p.listed_at);
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
      token_status: 'pre-token' as const,
      age_days: age,
      implied_value_usd: s.implied,
      model: s.breakdown,
      farm_steps: farmSteps(s.p, age),
    };
  });
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL band. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. Never per-name: only category, chains, TVL and age. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and leave the supply open so it earns interest and counts as activity`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in a balanced pair and keep the position open`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app instead of bridging straight back`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the same wallet`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetics') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it the same week`;
  if (c.includes('prediction')) return `Fund your ${name} account with $${capital} and place one position on a market that settles within the month`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('indexes')) return `Deposit $${capital} into a ${name} vault or curator allocation on ${chain} and hold the vault shares in the farming wallet`;
  if (c.includes('stable') || c.includes('algo-stable') || c.includes('dual-token')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it so the balance is visible on-chain`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold and keep the policy active`;
  if (c.includes('launchpad')) return `Stake or lock $${capital} on ${name} to qualify for its launches and join one sale or allocation round`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s main farm on ${chain} and keep the deposit staked through the weekly cycle`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open so the wallet shows sustained use`;
}

/**
 * A protocol's farm plan: six steps, each naming a concrete action, what it
 * costs and how long it takes. Derived from category, chains, TVL and age
 * only — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Set up a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper and store it offline, and fund it with $${capital} plus gas. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${actionFor(p, capital, chain)}. Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet shows steady use rather than a single burst. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted across more than one snapshot instead of a single day. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes there; never pay anyone to claim for you. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
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

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = buildComparables(snapshot.protocols, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const usedCats = new Set(board.map((r) => r.category ?? '(uncategorised)'));
  const fallbackCategories = [...usedCats].filter((c) => !comps.byCategory.has(c)).sort();
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
    global_comp_ratio: round4(comps.global),
    fallback_categories: fallbackCategories,
    rows: board,
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
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
