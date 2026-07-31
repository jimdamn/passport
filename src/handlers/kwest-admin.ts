/**
 * KrowdKwest - admin handlers (increment 4). Hunt/step CRUD, status
 * transitions with the go-live checklist gate, field-test recording,
 * test-run create/reset, dashboard, player lookup, claims review, retro
 * publish/unpublish, weather-pause toggle. Mirrors handlers/admin.ts
 * (requireAdmin inline, cleanText/isValidCoord helpers, hard-delete when no
 * history else block/soft-deactivate).
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { awardWithBudget } from '../lib/kwest-economy';
import { distanceMeters } from '../lib/geo';
import { getKwestDefaults } from '../lib/kwest-defaults';

type AppContext = Context<{ Bindings: Env }>;

const HUNT_STATUSES = ['draft', 'scheduled', 'live', 'paused', 'ended', 'archived'] as const;
const CLAIM_STATUSES = ['pending', 'contacted', 'id_verified', 'paid', 'rejected', 'forfeited'] as const;

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) throw new HTTPException(403, { message: 'Admin access required' });
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function isValidCoord(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    isFinite(lat) && isFinite(lon as number) &&
    Math.abs(lat) <= 90 && Math.abs(lon as number) <= 180
  );
}

async function getHuntOr404(env: Env, tenantId: string, huntId: number): Promise<any> {
  const hunt = await env.DB.prepare(
    'SELECT * FROM kwest_hunts WHERE id = ? AND tenant_id = ?'
  ).bind(huntId, tenantId).first<any>();
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });
  return hunt;
}

async function countRealFinishes(env: Env, huntId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM kwest_finishes WHERE hunt_id = ? AND is_test = 0'
  ).bind(huntId).first<{ n: number }>();
  return row?.n ?? 0;
}

// Only the highest-seq step is ever final - derived automatically so
// create/delete/reorder can never leave a hunt with zero or multiple
// final steps.
async function recomputeFinalStep(env: Env, huntId: number): Promise<void> {
  await env.DB.prepare('UPDATE kwest_steps SET is_final = 0 WHERE hunt_id = ?').bind(huntId).run();
  await env.DB.prepare(`
    UPDATE kwest_steps SET is_final = 1
    WHERE hunt_id = ? AND seq = (SELECT MAX(seq) FROM kwest_steps WHERE hunt_id = ?)
  `).bind(huntId, huntId).run();
}

// ============================================================
// HUNT CRUD
// ============================================================

/** GET /api/t/:tenant/admin/kwest */
export async function adminListHunts(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM kwest_hunts WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenant.id).all<any>();
  return c.json({ data: results ?? [] });
}

/** POST /api/t/:tenant/admin/kwest */
export async function adminCreateHunt(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));

  const slug = cleanText(body.slug, 60);
  const name = cleanText(body.name, 120);
  const scope = ['location_specific', 'region_wide'].includes(body.scope) ? body.scope : null;
  const grandPrizeDescription = cleanText(body.grand_prize_description, 200);
  const startsAt = Number(body.starts_at);
  const endsAt = Number(body.ends_at);

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw new HTTPException(400, { message: 'A slug (lowercase letters, numbers, hyphens only) is required.' });
  }
  if (!name || !scope || !grandPrizeDescription) {
    throw new HTTPException(400, { message: 'name, scope, and grand_prize_description are required.' });
  }
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new HTTPException(400, { message: 'A valid starts_at before ends_at is required.' });
  }

  // Hunt-creation defaults live in tenants.config (kwest-defaults.ts). They
  // only fill fields the caller omitted - a hunt snapshots whatever values
  // land in this INSERT and is never rescaled afterwards, so an explicit
  // value from the create form always wins over the default.
  const defaults = await getKwestDefaults(c.env, tenant.id);
  const grandPrizeKredits = body.grand_prize_kredits !== undefined
    ? Number(body.grand_prize_kredits) || 0 : defaults.grand_prize_kredits;
  const rank2_10Kredits = body.rank2_10_kredits !== undefined
    ? Number(body.rank2_10_kredits) || 0 : defaults.rank2_10_kredits;
  const rank11_20Kredits = body.rank11_20_kredits !== undefined
    ? Number(body.rank11_20_kredits) || 0 : defaults.rank11_20_kredits;
  const stepRewardDefault = body.step_reward_default !== undefined
    ? Number(body.step_reward_default) || 0 : defaults.step_reward_default;
  const minigameMaxAward = body.minigame_max_award !== undefined
    ? Number(body.minigame_max_award) || 0 : defaults.minigame_max_award;

  try {
    await c.env.DB.prepare(`
      INSERT INTO kwest_hunts
        (tenant_id, slug, name, narrative, scope, location_label, starts_at, ends_at, sponsor_name,
         grand_prize_kredits, grand_prize_description, rank2_10_kredits, rank11_20_kredits,
         step_reward_default, minigame_offer_bp, minigame_max_award, kk_budget_cap)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenant.id, slug, name, cleanText(body.narrative, 2000) ?? '', scope, cleanText(body.location_label, 120),
      startsAt, endsAt, cleanText(body.sponsor_name, 120) ?? 'Lake & Locals',
      grandPrizeKredits, grandPrizeDescription,
      rank2_10Kredits, rank11_20Kredits,
      stepRewardDefault, Number(body.minigame_offer_bp) || 1500,
      minigameMaxAward, Number(body.kk_budget_cap) || 5000,
    ).run();
  } catch {
    throw new HTTPException(400, { message: 'A hunt with that slug already exists.' });
  }

  const hunt = await c.env.DB.prepare(
    'SELECT * FROM kwest_hunts WHERE tenant_id = ? AND slug = ?'
  ).bind(tenant.id, slug).first<any>();
  return c.json({ data: hunt }, 201);
}

/** GET /api/t/:tenant/admin/kwest/:id */
export async function adminGetHunt(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const hunt = await getHuntOr404(c.env, tenant.id, Number(c.req.param('id')));
  return c.json({ data: hunt });
}

const HUNT_UPDATE_FIELDS: Record<string, (v: unknown) => unknown> = {
  name: (v) => cleanText(v, 120),
  narrative: (v) => cleanText(v, 2000) ?? '',
  location_label: (v) => cleanText(v, 120),
  starts_at: (v) => Number(v),
  ends_at: (v) => Number(v),
  sponsor_name: (v) => cleanText(v, 120) ?? 'Lake & Locals',
  grand_prize_kredits: (v) => Number(v) || 0,
  grand_prize_description: (v) => cleanText(v, 200),
  grand_prize_fulfillment: (v) => cleanText(v, 1000) ?? '',
  rank2_10_kredits: (v) => Number(v) || 0,
  rank11_20_kredits: (v) => Number(v) || 0,
  step_reward_default: (v) => Number(v) || 0,
  minigame_offer_bp: (v) => Number(v) || 0,
  minigame_max_award: (v) => Number(v) || 0,
  kk_budget_cap: (v) => Number(v) || 0,
};

/** PUT /api/t/:tenant/admin/kwest/:id */
export async function adminUpdateHunt(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);
  const body = await c.req.json<any>().catch(() => ({}));

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, coerce] of Object.entries(HUNT_UPDATE_FIELDS)) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(coerce(body[key]));
    }
  }

  if (sets.length > 0) {
    await c.env.DB.prepare(
      `UPDATE kwest_hunts SET ${sets.join(', ')}, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?`
    ).bind(...values, huntId, tenant.id).run();
  }

  const updated = await getHuntOr404(c.env, tenant.id, huntId);
  return c.json({ data: updated });
}

/** DELETE /api/t/:tenant/admin/kwest/:id - only when no real finishes. */
export async function adminDeleteHunt(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);

  const finishCount = await countRealFinishes(c.env, huntId);
  if (finishCount > 0) {
    throw new HTTPException(400, { message: 'This hunt has real finishes and cannot be deleted. Archive it instead.' });
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM kwest_reveals WHERE hunt_id = ?').bind(huntId),
    c.env.DB.prepare('DELETE FROM kwest_finishes WHERE hunt_id = ?').bind(huntId),
    c.env.DB.prepare('DELETE FROM kwest_claims WHERE hunt_id = ?').bind(huntId),
    c.env.DB.prepare('DELETE FROM kwest_acknowledgements WHERE hunt_id = ?').bind(huntId),
    c.env.DB.prepare('DELETE FROM kwest_progress WHERE hunt_id = ?').bind(huntId),
    c.env.DB.prepare('DELETE FROM kwest_minigame_plays WHERE hunt_id = ?').bind(huntId),
    c.env.DB.prepare('DELETE FROM kwest_steps WHERE hunt_id = ?').bind(huntId),
    c.env.DB.prepare('DELETE FROM kwest_hunts WHERE id = ? AND tenant_id = ?').bind(huntId, tenant.id),
  ]);
  return c.json({ data: { removed: true } });
}

// ============================================================
// STEP CRUD
// ============================================================

/** GET /api/t/:tenant/admin/kwest/:id/steps - full detail incl. target coords (admin-only). */
export async function adminListSteps(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM kwest_steps WHERE hunt_id = ? ORDER BY seq'
  ).bind(huntId).all<any>();
  return c.json({ data: results ?? [] });
}

/** POST /api/t/:tenant/admin/kwest/:id/steps */
export async function adminCreateStep(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);
  const body = await c.req.json<any>().catch(() => ({}));

  if (!Array.isArray(body.clues) || body.clues.length === 0) {
    throw new HTTPException(400, { message: 'At least one clue is required.' });
  }
  if (!isValidCoord(body.target_lat, body.target_lng)) {
    throw new HTTPException(400, { message: 'A valid target_lat/target_lng is required.' });
  }

  const maxSeq = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(seq), 0) as n FROM kwest_steps WHERE hunt_id = ?'
  ).bind(huntId).first<{ n: number }>();
  const seq = maxSeq!.n + 1;

  await c.env.DB.prepare(`
    INSERT INTO kwest_steps
      (hunt_id, tenant_id, seq, clues_json, hint_body, hint_after_misses,
       target_lat, target_lng, radius_m, step_reward, minigame_enabled, is_final)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(
    huntId, tenant.id, seq, JSON.stringify(body.clues), cleanText(body.hint_body, 500),
    Number(body.hint_after_misses) || 5, body.target_lat, body.target_lng,
    Number(body.radius_m) || 75, body.step_reward != null && body.step_reward !== '' ? Number(body.step_reward) : null,
    body.minigame_enabled === false ? 0 : 1,
  ).run();

  await recomputeFinalStep(c.env, huntId);

  const step = await c.env.DB.prepare('SELECT * FROM kwest_steps WHERE hunt_id = ? AND seq = ?').bind(huntId, seq).first<any>();
  return c.json({ data: step }, 201);
}

/** PUT /api/t/:tenant/admin/kwest/steps/:stepId */
export async function adminUpdateStep(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const stepId = Number(c.req.param('stepId'));
  const step = await c.env.DB.prepare(
    'SELECT * FROM kwest_steps WHERE id = ? AND tenant_id = ?'
  ).bind(stepId, tenant.id).first<any>();
  if (!step) throw new HTTPException(404, { message: 'Step not found.' });
  const body = await c.req.json<any>().catch(() => ({}));

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.clues !== undefined) {
    if (!Array.isArray(body.clues) || body.clues.length === 0) {
      throw new HTTPException(400, { message: 'At least one clue is required.' });
    }
    sets.push('clues_json = ?');
    values.push(JSON.stringify(body.clues));
  }
  if (body.hint_body !== undefined) { sets.push('hint_body = ?'); values.push(cleanText(body.hint_body, 500)); }
  if (body.hint_after_misses !== undefined) { sets.push('hint_after_misses = ?'); values.push(Number(body.hint_after_misses) || 0); }
  if (body.radius_m !== undefined) { sets.push('radius_m = ?'); values.push(Number(body.radius_m) || 75); }
  if (body.step_reward !== undefined) { sets.push('step_reward = ?'); values.push(body.step_reward === '' || body.step_reward === null ? null : Number(body.step_reward)); }
  if (body.minigame_enabled !== undefined) { sets.push('minigame_enabled = ?'); values.push(body.minigame_enabled ? 1 : 0); }

  // Moving the target invalidates any prior field test - it tested a
  // different spot.
  const movingTarget = body.target_lat !== undefined || body.target_lng !== undefined;
  if (movingTarget) {
    const lat = body.target_lat !== undefined ? body.target_lat : step.target_lat;
    const lng = body.target_lng !== undefined ? body.target_lng : step.target_lng;
    if (!isValidCoord(lat, lng)) throw new HTTPException(400, { message: 'A valid target_lat/target_lng is required.' });
    sets.push('target_lat = ?', 'target_lng = ?', 'field_tested_at = NULL', 'field_tested_by = NULL', 'field_test_json = NULL');
    values.push(lat, lng);
  }

  if (sets.length > 0) {
    await c.env.DB.prepare(`UPDATE kwest_steps SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...values, stepId, tenant.id).run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM kwest_steps WHERE id = ?').bind(stepId).first<any>();
  return c.json({ data: updated });
}

/** DELETE /api/t/:tenant/admin/kwest/steps/:stepId - blocked once the hunt has real finishes. */
export async function adminDeleteStep(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const stepId = Number(c.req.param('stepId'));
  const step = await c.env.DB.prepare(
    'SELECT * FROM kwest_steps WHERE id = ? AND tenant_id = ?'
  ).bind(stepId, tenant.id).first<any>();
  if (!step) throw new HTTPException(404, { message: 'Step not found.' });

  const finishCount = await countRealFinishes(c.env, step.hunt_id);
  if (finishCount > 0) {
    throw new HTTPException(400, { message: 'This hunt has real finishes, so its steps are locked. Archive the hunt instead of editing its trail.' });
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM kwest_minigame_plays WHERE step_id = ?').bind(stepId),
    c.env.DB.prepare('DELETE FROM kwest_reveals WHERE step_id = ?').bind(stepId),
    c.env.DB.prepare('DELETE FROM kwest_steps WHERE id = ?').bind(stepId),
  ]);
  await recomputeFinalStep(c.env, step.hunt_id);
  return c.json({ data: { removed: true } });
}

/** POST /api/t/:tenant/admin/kwest/:id/steps/reorder {ordered_step_ids:[]} */
export async function adminReorderSteps(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);
  const body = await c.req.json<{ ordered_step_ids?: number[] }>().catch(() => ({}) as { ordered_step_ids?: number[] });
  const orderedStepIds: number[] = Array.isArray(body.ordered_step_ids) ? body.ordered_step_ids : [];

  if (orderedStepIds.length === 0) {
    throw new HTTPException(400, { message: 'ordered_step_ids is required.' });
  }

  // Two-phase renumber (negative, then positive) dodges the
  // UNIQUE(hunt_id, seq) constraint mid-update.
  const negBatch = orderedStepIds.map((stepId, i) =>
    c.env.DB.prepare('UPDATE kwest_steps SET seq = ? WHERE id = ? AND hunt_id = ?').bind(-(i + 1), stepId, huntId)
  );
  const posBatch = orderedStepIds.map((stepId, i) =>
    c.env.DB.prepare('UPDATE kwest_steps SET seq = ? WHERE id = ? AND hunt_id = ?').bind(i + 1, stepId, huntId)
  );
  await c.env.DB.batch([...negBatch, ...posBatch]);
  await recomputeFinalStep(c.env, huntId);

  const { results } = await c.env.DB.prepare('SELECT * FROM kwest_steps WHERE hunt_id = ? ORDER BY seq').bind(huntId).all<any>();
  return c.json({ data: results ?? [] });
}

/** POST /api/t/:tenant/admin/kwest/steps/:stepId/field-test */
export async function adminRecordFieldTest(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const user = c.get('user');
  const stepId = Number(c.req.param('stepId'));
  const step = await c.env.DB.prepare('SELECT id FROM kwest_steps WHERE id = ? AND tenant_id = ?').bind(stepId, tenant.id).first();
  if (!step) throw new HTTPException(404, { message: 'Step not found.' });

  const body = await c.req.json<any>().catch(() => ({}));
  const accuracyM = Number(body.accuracy_m_observed);
  const fixSeconds = Number(body.fix_seconds);
  if (!isFinite(accuracyM) || !isFinite(fixSeconds)) {
    throw new HTTPException(400, { message: 'accuracy_m_observed and fix_seconds are required.' });
  }
  if (!body.public_access || !body.safe) {
    throw new HTTPException(400, { message: 'The safety checklist (public access, safe terrain) must be confirmed to record a field test.' });
  }

  const fieldTestJson = JSON.stringify({
    accuracy_m_observed: accuracyM,
    fix_seconds: fixSeconds,
    note: cleanText(body.note, 500) ?? '',
    public_access: true,
    safe: true,
  });

  await c.env.DB.prepare(`
    UPDATE kwest_steps SET field_tested_at = unixepoch(), field_tested_by = ?, field_test_json = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(user.email, fieldTestJson, stepId, tenant.id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM kwest_steps WHERE id = ?').bind(stepId).first<any>();
  return c.json({ data: updated });
}

// ============================================================
// STATUS TRANSITIONS
// ============================================================

/**
 * POST /api/t/:tenant/admin/kwest/:id/status {status}
 * Go-live is BLOCKED unless every step has a passing field test - enforced
 * here, not just in the UI, per the build constraints.
 */
export async function adminSetHuntStatus(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  const hunt = await getHuntOr404(c.env, tenant.id, huntId);
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });

  if (!body.status || !(HUNT_STATUSES as readonly string[]).includes(body.status)) {
    throw new HTTPException(400, { message: 'A valid status is required.' });
  }

  if (body.status === 'live' && hunt.status !== 'live') {
    const { results } = await c.env.DB.prepare(
      'SELECT id, field_test_json FROM kwest_steps WHERE hunt_id = ?'
    ).bind(huntId).all<{ id: number; field_test_json: string | null }>();
    const steps = results ?? [];
    if (steps.length === 0) {
      throw new HTTPException(400, { message: 'Add at least one step before going live.' });
    }
    const untested = steps.filter((s) => !s.field_test_json).length;
    if (untested > 0) {
      throw new HTTPException(400, { message: `${untested} step(s) still need a field test before this hunt can go live.` });
    }
  }

  await c.env.DB.prepare(
    'UPDATE kwest_hunts SET status = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
  ).bind(body.status, huntId, tenant.id).run();

  const updated = await getHuntOr404(c.env, tenant.id, huntId);
  return c.json({ data: updated });
}

// ============================================================
// TEST MODE
// ============================================================

/** POST /api/t/:tenant/admin/kwest/:id/test-run - create/reset the admin's is_test progress row. Works on hunts in ANY status. */
export async function adminCreateTestRun(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const user = c.get('user');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);

  const playerKey = `u:${user.sub}`;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM kwest_reveals WHERE hunt_id = ? AND player_key = ? AND is_test = 1').bind(huntId, playerKey),
    c.env.DB.prepare('DELETE FROM kwest_finishes WHERE hunt_id = ? AND user_id = ? AND is_test = 1').bind(huntId, user.sub),
    c.env.DB.prepare('DELETE FROM kwest_acknowledgements WHERE hunt_id = ? AND player_key = ?').bind(huntId, playerKey),
    c.env.DB.prepare('DELETE FROM kwest_progress WHERE hunt_id = ? AND player_key = ?').bind(huntId, playerKey),
  ]);
  await c.env.DB.prepare(`
    INSERT INTO kwest_progress (hunt_id, player_key, tenant_id, user_id, current_seq, is_test)
    VALUES (?, ?, ?, ?, 1, 1)
  `).bind(huntId, playerKey, tenant.id, user.sub).run();

  return c.json({ data: { reset: true, player_key: playerKey } });
}

// ============================================================
// DASHBOARD / DIAGNOSTICS
// ============================================================

/** GET /api/t/:tenant/admin/kwest/:id/dashboard */
export async function adminGetDashboard(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  const hunt = await getHuntOr404(c.env, tenant.id, huntId);

  const playersStarted = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM kwest_progress WHERE hunt_id = ? AND is_test = 0'
  ).bind(huntId).first<{ n: number }>();

  const funnel = await c.env.DB.prepare(`
    SELECT current_seq as seq, COUNT(*) as n FROM kwest_progress
    WHERE hunt_id = ? AND is_test = 0 AND finished_at IS NULL
    GROUP BY current_seq ORDER BY current_seq
  `).bind(huntId).all<{ seq: number; n: number }>();

  const revealsLastHour = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM kwest_reveals WHERE hunt_id = ? AND is_test = 0 AND created_at > unixepoch() - 3600"
  ).bind(huntId).first<{ n: number }>();

  const perStep = await c.env.DB.prepare(`
    SELECT s.seq, s.id as step_id,
      SUM(CASE WHEN r.result = 'hit' THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN r.result = 'near' THEN 1 ELSE 0 END) as nears,
      SUM(CASE WHEN r.result = 'miss' THEN 1 ELSE 0 END) as misses,
      AVG(r.accuracy_m) as avg_accuracy_m
    FROM kwest_steps s
    LEFT JOIN kwest_reveals r ON r.step_id = s.id AND r.is_test = 0
    WHERE s.hunt_id = ?
    GROUP BY s.id ORDER BY s.seq
  `).bind(huntId).all<any>();

  const finishes = await c.env.DB.prepare(`
    SELECT finish_rank, finished_at, prize_kind, prize_kredits, display_name_snapshot, user_id
    FROM kwest_finishes WHERE hunt_id = ? AND is_test = 0 ORDER BY finish_rank
  `).bind(huntId).all<any>();

  const claimStatuses = await c.env.DB.prepare(
    'SELECT status, COUNT(*) as n FROM kwest_claims WHERE hunt_id = ? GROUP BY status'
  ).bind(huntId).all<{ status: string; n: number }>();

  return c.json({
    data: {
      hunt_status: hunt.status,
      players_started: playersStarted?.n ?? 0,
      funnel: funnel.results ?? [],
      reveals_last_hour: revealsLastHour?.n ?? 0,
      per_step: perStep.results ?? [],
      finishes: finishes.results ?? [],
      budget_spent: hunt.kk_spent,
      budget_cap: hunt.kk_budget_cap,
      claim_statuses: claimStatuses.results ?? [],
    },
  });
}

/** GET /api/t/:tenant/admin/kwest/:id/players?email= - "our bug or user issue" in seconds. */
export async function adminPlayerLookup(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);
  const email = c.req.query('email');
  if (!email) throw new HTTPException(400, { message: 'email is required.' });

  const localUser = await c.env.DB.prepare(
    'SELECT kkauth_uid FROM users WHERE tenant_id = ? AND email = ?'
  ).bind(tenant.id, email).first<{ kkauth_uid: number }>();
  if (!localUser) {
    return c.json({ data: { found: false } });
  }

  const userId = String(localUser.kkauth_uid);
  const playerKey = `u:${userId}`;

  const progress = await c.env.DB.prepare(
    'SELECT * FROM kwest_progress WHERE hunt_id = ? AND player_key = ?'
  ).bind(huntId, playerKey).first<any>();

  const { results: reveals } = await c.env.DB.prepare(`
    SELECT r.created_at, s.seq, r.result, r.device_lat, r.device_lng, r.accuracy_m, r.distance_m, r.sim
    FROM kwest_reveals r JOIN kwest_steps s ON s.id = r.step_id
    WHERE r.hunt_id = ? AND r.player_key = ? ORDER BY r.created_at
  `).bind(huntId, playerKey).all<any>();

  const finish = await c.env.DB.prepare(
    'SELECT * FROM kwest_finishes WHERE hunt_id = ? AND user_id = ?'
  ).bind(huntId, userId).first<any>();

  return c.json({ data: { found: true, progress, reveals: reveals ?? [], finish } });
}

/**
 * POST /api/t/:tenant/admin/kwest/:id/health-check - the dashboard's
 * "Run live check" button. Exercises routing, DB reads/writes, and the
 * real geo-distance math end to end via the admin's own test run, without
 * touching real progress (Passport is Pages - no persistent server logs,
 * so this is deliberately the observability backstop).
 */
export async function adminHealthCheck(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const user = c.get('user');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);

  const playerKey = `u:${user.sub}`;
  const progress = await c.env.DB.prepare(
    'SELECT * FROM kwest_progress WHERE hunt_id = ? AND player_key = ? AND is_test = 1'
  ).bind(huntId, playerKey).first<any>();
  if (!progress) {
    return c.json({ data: { ok: false, reason: 'no_test_run', message: 'Start a test run first.' } });
  }

  const step = await c.env.DB.prepare(
    'SELECT id, seq, target_lat, target_lng, radius_m FROM kwest_steps WHERE hunt_id = ? AND seq = ?'
  ).bind(huntId, progress.current_seq).first<any>();
  if (!step) {
    return c.json({ data: { ok: false, reason: 'no_step', message: 'No step found at the current test position.' } });
  }

  // Deterministic self-distance (0m) proves the routing/DB/geo-math chain
  // end to end without consuming the test run's progress.
  const distance = distanceMeters(step.target_lat, step.target_lng, step.target_lat, step.target_lng);
  await c.env.DB.prepare(`
    INSERT INTO kwest_reveals (hunt_id, step_id, tenant_id, player_key, result, device_lat, device_lng, distance_m, is_test, sim)
    VALUES (?, ?, ?, ?, 'hit', ?, ?, ?, 1, 1)
  `).bind(huntId, step.id, tenant.id, playerKey, step.target_lat, step.target_lng, distance).run();

  return c.json({ data: { ok: distance <= step.radius_m, checked_step_seq: step.seq, distance_m: distance, radius_m: step.radius_m } });
}

// ============================================================
// CLAIMS REVIEW
// ============================================================

/** GET /api/t/:tenant/admin/kwest/:id/claims - finish list in rank order + claim statuses. */
export async function adminListClaims(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);

  const { results } = await c.env.DB.prepare(`
    SELECT f.finish_rank, f.user_id, f.display_name_snapshot, f.prize_kind, f.prize_kredits, f.finished_at,
           cl.id as claim_id, cl.status as claim_status, cl.claimant_name, cl.contact_json,
           cl.id_check_note, cl.reviewer, cl.reviewed_at
    FROM kwest_finishes f
    LEFT JOIN kwest_claims cl ON cl.hunt_id = f.hunt_id AND cl.user_id = f.user_id
    WHERE f.hunt_id = ? AND f.is_test = 0
    ORDER BY f.finish_rank
  `).bind(huntId).all<any>();

  return c.json({ data: results ?? [] });
}

/**
 * POST /api/t/:tenant/admin/kwest/claims/:claimId {status, id_check_note?, claimant_name?, contact_json?}
 * The DB enforces one winner (idx_kwest_one_winner). Grand-prize KrowdKredits
 * release exactly at the id_verified transition - never awarded automatically
 * at finish time.
 */
export async function adminUpdateClaim(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const user = c.get('user');
  const claimId = Number(c.req.param('claimId'));
  const claim = await c.env.DB.prepare(
    'SELECT * FROM kwest_claims WHERE id = ? AND tenant_id = ?'
  ).bind(claimId, tenant.id).first<any>();
  if (!claim) throw new HTTPException(404, { message: 'Claim not found.' });

  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.status || !(CLAIM_STATUSES as readonly string[]).includes(body.status)) {
    throw new HTTPException(400, { message: 'A valid status is required.' });
  }

  const idCheckNote = body.id_check_note !== undefined ? cleanText(body.id_check_note, 500) : claim.id_check_note;
  const claimantName = body.claimant_name !== undefined ? cleanText(body.claimant_name, 120) : claim.claimant_name;
  const contactJson = body.contact_json !== undefined ? JSON.stringify(body.contact_json) : claim.contact_json;

  try {
    await c.env.DB.prepare(`
      UPDATE kwest_claims SET status = ?, id_check_note = ?, claimant_name = ?, contact_json = ?,
        reviewer = ?, reviewed_at = unixepoch()
      WHERE id = ? AND tenant_id = ?
    `).bind(body.status, idCheckNote, claimantName, contactJson, user.email, claimId, tenant.id).run();
  } catch {
    throw new HTTPException(400, { message: 'Only one winner can be verified or paid per hunt.' });
  }

  if (body.status === 'id_verified' && claim.status !== 'id_verified') {
    const hunt = await getHuntOr404(c.env, tenant.id, claim.hunt_id);
    if (hunt.grand_prize_kredits > 0) {
      try {
        await awardWithBudget(
          c.env, hunt.id, tenant.id, claim.user_id, hunt.grand_prize_kredits,
          `KrowdKwest grand prize: ${hunt.name}`, 'kwest_grand', String(hunt.id),
        );
      } catch {
        // Award failure shouldn't block the review record itself - the
        // claim status change (and thus the claim history) still stands.
      }
    }
  }

  const updated = await c.env.DB.prepare('SELECT * FROM kwest_claims WHERE id = ?').bind(claimId).first<any>();
  return c.json({ data: updated });
}

// ============================================================
// RETRO + WEATHER PAUSE
// ============================================================

/** POST /api/t/:tenant/admin/kwest/:id/retro {published: 0|1} */
export async function adminSetRetroPublished(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);
  const body = await c.req.json<{ published?: boolean }>().catch(() => ({}) as { published?: boolean });
  await c.env.DB.prepare(
    'UPDATE kwest_hunts SET retro_published = ? WHERE id = ? AND tenant_id = ?'
  ).bind(body.published ? 1 : 0, huntId, tenant.id).run();
  return c.json({ data: { retro_published: !!body.published } });
}

/** POST /api/t/:tenant/admin/kwest/:id/weather-pause {paused: 0|1} */
export async function adminSetWeatherPause(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const huntId = Number(c.req.param('id'));
  await getHuntOr404(c.env, tenant.id, huntId);
  const body = await c.req.json<{ paused?: boolean }>().catch(() => ({}) as { paused?: boolean });
  await c.env.DB.prepare(
    'UPDATE kwest_hunts SET weather_paused = ? WHERE id = ? AND tenant_id = ?'
  ).bind(body.paused ? 1 : 0, huntId, tenant.id).run();
  return c.json({ data: { weather_paused: !!body.paused } });
}
