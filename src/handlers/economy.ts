/**
 * Economy admin route (increment 1) - GET .../admin/economy,
 * POST .../admin/economy/preview, POST .../admin/economy/apply.
 *
 * The registry never becomes the value: readRegistry/computePlan/
 * readLiveValues/applyPlan (src/lib/economy-registry.ts, economy-scale.ts)
 * do all the real work and are unit tested against fake clients. This file
 * only wires the real clients (economy-clients.ts) to those functions, does
 * request validation, and writes the modifier + history rows on apply.
 *
 * See docs/superpowers/specs/2026-07-31-economy-admin-design.md.
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { computePlan, targetForSourceKind, type PlanEntry, type RegistryRow } from '../lib/economy-scale';
import { readRegistry, readLiveValues, applyPlan } from '../lib/economy-registry';
import { describeGuards, type GuardRow } from '../lib/economy-guards';
import { buildEconomyClients } from '../lib/economy-clients';

type AppContext = Context<{ Bindings: Env }>;

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }
}

/**
 * 0 <= modifier <= 5, at most 2 decimal places. 0.00 is the explicit kill
 * switch, and credits cannot be clawed back, so this rejects hard rather than
 * coercing anything it isn't certain about.
 *
 * Only a genuine JS `number` is accepted - `Number(raw)` is never called.
 * `Number(null)` is `0`, `Number('')` is `0`, `Number([])` is `0`, and
 * `Number(false)` is `0`: every one of those would otherwise sail through the
 * range check and silently fire the platform-wide kill switch on a null or
 * empty field. The client sends JSON and can send a real number, so a numeric
 * string is rejected too, not coerced.
 *
 * The 2-decimal check uses an epsilon rather than exact equality because
 * `1.15 * 100` is `114.99999999999999` in IEEE-754 floating point - an exact
 * `Math.round(n * 100) !== n * 100` comparison would reject valid inputs like
 * 0.07, 1.15 and 2.01.
 */
export function parseModifier(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new HTTPException(400, { message: 'Modifier must be a number.' });
  }
  if (raw < 0 || raw > 5) {
    throw new HTTPException(400, { message: 'Modifier must be between 0 and 5.' });
  }
  if (Math.abs(raw * 100 - Math.round(raw * 100)) > 1e-9) {
    throw new HTTPException(400, { message: 'Modifier can have at most 2 decimal places.' });
  }
  return raw;
}

export type EconomyValueView = PlanEntry & {
  live: number | null;
  drift: boolean;
  status: 'ok' | 'unavailable' | 'orphaned';
};

/**
 * Pure classification for one row: is its target reachable, and if so does
 * it still have a value there. Pulled out of buildEconomyView so it can be
 * unit tested directly rather than only indirectly through a handler that
 * needs live D1/Service Binding fan-out.
 *
 * live === null never renders as 0: an unreachable service must not look
 * like an award that pays nothing. `status` distinguishes that case
 * ('unavailable' - the service itself didn't answer) from a row whose
 * service answered but no longer has that ref ('orphaned' - the row is
 * stale, not the service).
 */
export function classifyEconomyValue(
  entry: PlanEntry, liveValue: number | null, isReachable: boolean,
): EconomyValueView {
  if (!isReachable) {
    return { ...entry, live: null, drift: false, status: 'unavailable' };
  }
  if (liveValue === null) {
    return { ...entry, live: null, drift: false, status: 'orphaned' };
  }
  return { ...entry, live: liveValue, drift: liveValue !== entry.computed, status: 'ok' };
}

/**
 * Reads the registry, computes every value at `modifier`, and fans out to
 * live values - shared by all three handlers so preview and apply can never
 * compute this differently from what the read path shows.
 */
async function buildEconomyView(
  env: Env, rows: RegistryRow[], modifier: number,
): Promise<{ plan: PlanEntry[]; values: EconomyValueView[]; guards: GuardRow[] }> {
  const plan = computePlan(rows, modifier);
  const clients = buildEconomyClients(env);
  const { live, reachable } = await readLiveValues(rows, clients);

  const values: EconomyValueView[] = plan.map((entry) => {
    const isReachable = reachable[targetForSourceKind(entry.source_kind)];
    const liveValue = live.get(entry.id) ?? null;
    return classifyEconomyValue(entry, liveValue, isReachable);
  });

  // Guards are judged against the whole registry's current shape: the
  // largest single award anyone can currently earn, and the total daily
  // mint volume the ceilings were sized against - both at this candidate
  // modifier and at baseline, so drift shows as a ratio change rather than
  // requiring the reader to do the arithmetic themselves.
  const computedValues = plan.map((p) => p.computed);
  const baselineValues = plan.map((p) => p.baseline);
  const guards = describeGuards(
    computedValues.length ? Math.max(...computedValues) : 0,
    baselineValues.length ? Math.max(...baselineValues) : 0,
    baselineValues.reduce((sum, v) => sum + v, 0),
    computedValues.reduce((sum, v) => sum + v, 0),
  );

  return { plan, values, guards };
}

async function currentModifier(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT modifier FROM economy_modifier WHERE id = 1').first<{ modifier: number }>();
  return row?.modifier ?? 1.0;
}

/** GET /admin/economy - every registry row at the saved modifier, plus the guards panel. */
export async function getEconomy(c: AppContext) {
  requireAdmin(c);
  const modifier = await currentModifier(c.env);
  const rows = await readRegistry(c.env.DB);
  const { values, guards } = await buildEconomyView(c.env, rows, modifier);
  return c.json({ data: { modifier, values, guards } });
}

/** POST /admin/economy/preview - body { modifier }. Same shape as GET, recomputed at the candidate modifier. Writes nothing. */
export async function previewEconomy(c: AppContext) {
  requireAdmin(c);
  const body = await c.req.json<{ modifier?: unknown }>().catch(() => ({} as { modifier?: unknown }));
  const modifier = parseModifier(body.modifier);

  const rows = await readRegistry(c.env.DB);
  const { values, guards } = await buildEconomyView(c.env, rows, modifier);
  return c.json({ data: { modifier, values, guards } });
}

/**
 * POST /admin/economy/apply - body { modifier }. Recomputes from baseline
 * (never from a live value), excludes orphaned rows, fans out, then records
 * the modifier and one forensic economy_history row.
 */
export async function applyEconomy(c: AppContext) {
  requireAdmin(c);
  const body = await c.req.json<{ modifier?: unknown }>().catch(() => ({} as { modifier?: unknown }));
  const modifier = parseModifier(body.modifier);

  const rows = await readRegistry(c.env.DB);
  const plan = computePlan(rows, modifier);
  const clients = buildEconomyClients(c.env);

  // A row whose service is reachable but whose ref is no longer there is
  // orphaned - the target has nowhere to put it, so it is excluded from the
  // write rather than attempted (spec S11). A row whose service is simply
  // down stays IN the plan; its target's own apply() call will fail
  // naturally and that failure is reported per-target below, which is the
  // ordinary partial-failure path, not an orphan.
  const { live, reachable } = await readLiveValues(rows, clients);
  const orphanedIds = new Set(
    rows
      .filter((row) => reachable[targetForSourceKind(row.source_kind)] && live.get(row.id) === null)
      .map((row) => row.id)
  );
  const applicablePlan = plan.filter((p) => !orphanedIds.has(p.id));

  const fromValue = await currentModifier(c.env);
  const result = await applyPlan(applicablePlan, clients);

  const user = c.get('user');
  const appliedBy = user?.sub ? Number(user.sub) : null;

  // The forensic record covers every active registry row's computed value at
  // this modifier, not just the ones actually written - this is what answers
  // "what was a plaque scan worth on this date" later, regardless of whether
  // a particular row's target happened to be reachable that moment.
  const resultJson = JSON.stringify(Object.fromEntries(plan.map((p) => [p.id, p.computed])));

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE economy_modifier SET modifier = ?, updated_at = unixepoch(), updated_by = ? WHERE id = 1')
      .bind(modifier, appliedBy),
    c.env.DB.prepare(
      'INSERT INTO economy_history (from_value, to_value, applied_by, outcome, result_json) VALUES (?, ?, ?, ?, ?)'
    ).bind(fromValue, modifier, appliedBy, result.outcome, resultJson),
  ]);

  // Re-read live values post-write so the response reflects what actually
  // landed, not what was merely attempted - a partial failure must show
  // drift on the target that failed, not a falsely cleared one.
  const view = await buildEconomyView(c.env, rows, modifier);
  return c.json({
    data: {
      modifier, outcome: result.outcome, per_target: result.perTarget,
      values: view.values, guards: view.guards,
    },
  });
}
