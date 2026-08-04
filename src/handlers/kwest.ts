/**
 * KrowdKwest - player-facing handlers. Increment 1: list/detail/rules,
 * start/ack/state, reveal (the heart), and authenticated attach. Increment 2
 * adds display-choice, mine, and retro to support the play UI. Increment 3
 * adds the mini-game play endpoint. Admin CRUD and lifecycle cron endpoints
 * land in later increments per KROWDKWEST-DEVELOPMENT-PLAN.md Section 11.
 *
 * Progression secrecy: every player-facing SELECT on kwest_steps uses an
 * explicit column list. target_lat/target_lng/radius_m are read ONLY inside
 * this file's internal getStepInternal() (used for the reveal distance
 * check) and must never be spread into a c.json() response.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { nanoid } from 'nanoid';
import type { Env } from '../types';
import { distanceMeters } from '../lib/geo';
import { resolvePlayerKey, mintGuestKey, resolveGuestId, fetchPersonaInfo } from '../lib/kwest-guest';
import { awardWithBudget, stepRewardAmount, drawMinigameOutcome } from '../lib/kwest-economy';
import { notifyKwestFinish } from '../lib/kwest-notify';
import { KWEST_SHORT_DISCLAIMER, KWEST_OFFICIAL_RULES } from '../lib/kwest-rules';
import { KWEST_TEASE_LINES, teaseLine } from '../lib/kwest-copy';
import { kwestLifecycleSweep } from './kwest-internal';
import { logger } from '../lib/logger';

type AppContext = Context<{ Bindings: Env }>;

/**
 * KrowdKwest dormancy gate (2026-08-04). Runs after resolveTenant on every
 * player-facing kwest route. Default is dormant: unless the tenant config
 * carries kwest_enabled: 'on', the surface answers 404 — matching what a
 * member sees in the UI (no tile, no routes). Admin routes and the
 * X-Internal-Secret cron endpoints are deliberately NOT gated: the claims
 * queue must stay reachable and the lifecycle/retention sweeps must keep
 * running while dormant. Flip via POST /admin/kwest/feature (no deploy).
 */
export async function requireKwestEnabled(c: AppContext, next: () => Promise<void>): Promise<Response | void> {
  const tenant = c.get('tenant') as { config?: { kwest_enabled?: string } } | undefined;
  if (tenant?.config?.kwest_enabled !== 'on') {
    throw new HTTPException(404, { message: 'Not found' });
  }
  await next();
}

interface KwestHuntRow {
  id: number;
  tenant_id: string;
  slug: string;
  name: string;
  narrative: string;
  scope: string;
  location_label: string | null;
  status: string;
  starts_at: number;
  ends_at: number;
  official_end_at: number | null;
  sponsor_name: string;
  grand_prize_kredits: number;
  grand_prize_description: string;
  rank2_10_kredits: number;
  rank11_20_kredits: number;
  step_reward_default: number;
  minigame_offer_bp: number;
  minigame_max_award: number;
  kk_budget_cap: number;
  kk_spent: number;
  rules_version: number;
  retro_published: number;
  weather_paused: number;
}

interface KwestProgressRow {
  hunt_id: number;
  player_key: string;
  tenant_id: string;
  user_id: string | null;
  current_seq: number;
  started_at: number;
  finished_at: number | null;
  is_test: number;
  confidence: number;
  updated_at: number;
}

interface KwestStepInternal {
  id: number;
  seq: number;
  clues_json: string;
  hint_body: string | null;
  hint_after_misses: number;
  target_lat: number;
  target_lng: number;
  radius_m: number;
  step_reward: number | null;
  minigame_enabled: number;
  is_final: number;
}

const MINIGAMES = ['chest_pick', 'compass_stop', 'scratch_off'] as const;

// Self-healing soft-throttle on reveals (kwest_progress.confidence). See the
// throttle-cap computation in revealKwest for how these combine.
const THROTTLE_BASE_CAP = 12;      // reveals/hour on one step at full confidence
const THROTTLE_MIN_CAP = 3;        // never fully lock out an honest player
const CONFIDENCE_REGEN_PER_HOUR = 0.25; // passive recovery while away
const CONFIDENCE_MISS_PENALTY = 0.15;   // decay per miss/near
const CONFIDENCE_MIN = 0.25;            // floor - pairs with THROTTLE_MIN_CAP

async function getHuntRow(env: Env, tenantId: string, slug: string | undefined): Promise<KwestHuntRow | null> {
  if (!slug) return null;
  return env.DB.prepare(
    'SELECT * FROM kwest_hunts WHERE tenant_id = ? AND slug = ?'
  ).bind(tenantId, slug).first<KwestHuntRow>();
}

async function getHuntRowById(env: Env, huntId: number): Promise<KwestHuntRow | null> {
  return env.DB.prepare('SELECT * FROM kwest_hunts WHERE id = ?').bind(huntId).first<KwestHuntRow>();
}

// INTERNAL ONLY - includes target_lat/target_lng/radius_m for the reveal
// distance check. Never return this object (or fields from it) to a client.
async function getStepInternal(env: Env, huntId: number, seq: number): Promise<KwestStepInternal | null> {
  return env.DB.prepare(
    `SELECT id, seq, clues_json, hint_body, hint_after_misses, target_lat, target_lng, radius_m,
            step_reward, minigame_enabled, is_final
     FROM kwest_steps WHERE hunt_id = ? AND seq = ?`
  ).bind(huntId, seq).first<KwestStepInternal>();
}

// Player-facing step view - explicit column list, no target_/radius_m.
async function getStepPublic(env: Env, huntId: number, seq: number) {
  return env.DB.prepare(
    'SELECT id, seq, clues_json, hint_body, hint_after_misses, is_final FROM kwest_steps WHERE hunt_id = ? AND seq = ?'
  ).bind(huntId, seq).first<{
    id: number; seq: number; clues_json: string; hint_body: string | null;
    hint_after_misses: number; is_final: number;
  }>();
}

async function hasAck(env: Env, huntId: number, playerKey: string, rulesVersion: number): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM kwest_acknowledgements WHERE hunt_id = ? AND player_key = ? AND rules_version = ?'
  ).bind(huntId, playerKey, rulesVersion).first();
  return !!row;
}

async function countRealFinishes(env: Env, huntId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM kwest_finishes WHERE hunt_id = ? AND is_test = 0'
  ).bind(huntId).first<{ n: number }>();
  return row?.n ?? 0;
}

function getGuestTokenParam(c: AppContext, bodyToken?: string | null): string | null {
  return bodyToken ?? c.req.query('guest_token') ?? null;
}

// ============================================================
// PUBLIC / GUEST-FRIENDLY
// ============================================================

/** GET /api/t/:tenant/kwest - live hunts + published retrospectives, public fields only. */
export async function listKwestHunts(c: AppContext) {
  const tenant = c.get('tenant');
  // Lazy lifecycle check (belt-and-suspenders alongside the cron sweep),
  // mirroring deals.ts's lazy-expiry-on-read pattern.
  await kwestLifecycleSweep(c.env);
  const { results } = await c.env.DB.prepare(`
    SELECT slug, name, narrative, scope, location_label, status, starts_at, ends_at,
           sponsor_name, grand_prize_description, retro_published
    FROM kwest_hunts
    WHERE tenant_id = ? AND (status = 'live' OR retro_published = 1)
    ORDER BY starts_at DESC
  `).bind(tenant.id).all<any>();
  return c.json({ data: results ?? [] });
}

/** GET /api/t/:tenant/kwest/:slug - intro fields, first clue when live. */
export async function getKwestHunt(c: AppContext) {
  const tenant = c.get('tenant');
  const slug = c.req.param('slug');
  await kwestLifecycleSweep(c.env);
  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });

  const finishCount = await countRealFinishes(c.env, hunt.id);

  let firstClue: unknown = null;
  if (hunt.status === 'live') {
    const firstStep = await getStepPublic(c.env, hunt.id, 1);
    if (firstStep) firstClue = JSON.parse(firstStep.clues_json);
  }

  return c.json({
    data: {
      id: hunt.id,
      slug: hunt.slug,
      name: hunt.name,
      narrative: hunt.narrative,
      scope: hunt.scope,
      location_label: hunt.location_label,
      status: hunt.status,
      starts_at: hunt.starts_at,
      ends_at: hunt.ends_at,
      sponsor_name: hunt.sponsor_name,
      grand_prize_description: hunt.grand_prize_description,
      rules_version: hunt.rules_version,
      weather_paused: !!hunt.weather_paused,
      all_prizes_claimed: finishCount >= 20,
      first_clue: firstClue,
    },
  });
}

/** GET /api/t/:tenant/kwest/:slug/rules - versioned Official Rules text. */
export async function getKwestRules(c: AppContext) {
  const tenant = c.get('tenant');
  const slug = c.req.param('slug');
  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });

  return c.json({
    data: {
      rules_version: hunt.rules_version,
      short_disclaimer: KWEST_SHORT_DISCLAIMER,
      official_rules: KWEST_OFFICIAL_RULES,
    },
  });
}

/**
 * GET /api/t/:tenant/kwest/:slug/retro - winners list, only when
 * retro_published=1 (flipped by the increment-5 lifecycle sweep, or by an
 * admin in increment 4). No coordinates, no clue answers - a hunt's
 * locations stay unpublished so clues can be reused.
 */
export async function getKwestRetro(c: AppContext) {
  const tenant = c.get('tenant');
  const slug = c.req.param('slug');
  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });

  if (!hunt.retro_published) {
    return c.json({ data: { published: false } });
  }

  // Only the 20 prize tiers get named in the retro - beyond that, finishers
  // are counted into the thank-you, not individually listed by rank.
  const { results } = await c.env.DB.prepare(`
    SELECT finish_rank, prize_kind, display_choice, display_name_snapshot
    FROM kwest_finishes
    WHERE hunt_id = ? AND is_test = 0 AND finish_rank <= 20
    ORDER BY finish_rank
  `).bind(hunt.id).all<{
    finish_rank: number; prize_kind: string; display_choice: string; display_name_snapshot: string;
  }>();

  const totalFinishers = await countRealFinishes(c.env, hunt.id);

  return c.json({
    data: {
      published: true,
      hunt_name: hunt.name,
      narrative: hunt.narrative,
      grand_prize_description: hunt.grand_prize_description,
      total_finishers: totalFinishers,
      winners: (results ?? []).map(r => ({
        rank: r.finish_rank,
        prize_kind: r.prize_kind,
        display_name: r.display_name_snapshot,
      })),
    },
  });
}

/** POST /api/t/:tenant/kwest/:slug/start - create progress; mints a guest key when unauthenticated. */
export async function startKwest(c: AppContext) {
  const tenant = c.get('tenant');
  const slug = c.req.param('slug');
  const body = await c.req.json<{ guest_token?: string }>().catch(() => ({} as { guest_token?: string }));

  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });
  if (hunt.status !== 'live') {
    return c.json({ data: { blocked: hunt.status, message: 'This hunt is not open yet.' } });
  }

  let playerKey: string;
  let userId: string | null;
  let freshGuestToken: string | null = null;

  const resolved = await resolvePlayerKey(c, body.guest_token);
  if (resolved) {
    playerKey = resolved.playerKey;
    userId = resolved.userId;
  } else {
    const minted = await mintGuestKey(c.env, tenant.id);
    playerKey = `g:${minted.guestId}`;
    userId = null;
    freshGuestToken = minted.guestToken;
  }

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO kwest_progress (hunt_id, player_key, tenant_id, user_id, current_seq)
    VALUES (?, ?, ?, ?, 1)
  `).bind(hunt.id, playerKey, tenant.id, userId).run();

  const progress = await c.env.DB.prepare(
    'SELECT * FROM kwest_progress WHERE hunt_id = ? AND player_key = ?'
  ).bind(hunt.id, playerKey).first<KwestProgressRow>();

  const acked = await hasAck(c.env, hunt.id, playerKey, hunt.rules_version);

  return c.json({
    data: {
      player_key: playerKey,
      guest_token: freshGuestToken,
      current_seq: progress?.current_seq ?? 1,
      finished: !!progress?.finished_at,
      needs_ack: !acked,
      rules_version: hunt.rules_version,
    },
  });
}

/** POST /api/t/:tenant/kwest/:slug/ack - record rules acknowledgement. */
export async function ackKwest(c: AppContext) {
  const tenant = c.get('tenant');
  const slug = c.req.param('slug');
  const body = await c.req.json<{ guest_token?: string; rules_version?: number }>().catch(() => ({} as any));

  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });

  const resolved = await resolvePlayerKey(c, body.guest_token);
  if (!resolved) throw new HTTPException(400, { message: 'Start the hunt first.' });

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO kwest_acknowledgements (hunt_id, tenant_id, player_key, rules_version)
    VALUES (?, ?, ?, ?)
  `).bind(hunt.id, tenant.id, resolved.playerKey, hunt.rules_version).run();

  return c.json({ data: { acknowledged: true, rules_version: hunt.rules_version } });
}

/** GET /api/t/:tenant/kwest/:slug/state - current clue(s), never target coords. */
export async function getKwestState(c: AppContext) {
  const tenant = c.get('tenant');
  const slug = c.req.param('slug');
  const guestToken = getGuestTokenParam(c);

  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });

  const resolved = await resolvePlayerKey(c, guestToken);
  if (!resolved) throw new HTTPException(400, { message: 'Start the hunt first.' });

  const progress = await c.env.DB.prepare(
    'SELECT * FROM kwest_progress WHERE hunt_id = ? AND player_key = ?'
  ).bind(hunt.id, resolved.playerKey).first<KwestProgressRow>();
  if (!progress) throw new HTTPException(400, { message: 'Start the hunt first.' });

  if (progress.finished_at) {
    return c.json({ data: { finished: true } });
  }

  const acked = await hasAck(c.env, hunt.id, resolved.playerKey, hunt.rules_version);
  if (!acked) {
    return c.json({ data: { needs_ack: true, rules_version: hunt.rules_version } });
  }

  const step = await getStepPublic(c.env, hunt.id, progress.current_seq);
  if (!step) throw new HTTPException(404, { message: 'Step not found.' });

  const missCount = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM kwest_reveals WHERE hunt_id = ? AND step_id = ? AND player_key = ? AND result = 'miss'`
  ).bind(hunt.id, step.id, resolved.playerKey).first<{ n: number }>();
  const hintUnlocked = step.hint_after_misses > 0 && (missCount?.n ?? 0) >= step.hint_after_misses;

  const finishCount = await countRealFinishes(c.env, hunt.id);

  return c.json({
    data: {
      seq: step.seq,
      clues: JSON.parse(step.clues_json),
      hint: hintUnlocked ? step.hint_body : null,
      is_final: !!step.is_final,
      weather_paused: !!hunt.weather_paused,
      all_prizes_claimed: finishCount >= 20,
      is_test: !!progress.is_test,
    },
  });
}

/** POST /api/t/:tenant/kwest/:slug/reveal - THE HEART. Per dev plan Section 4. */
export async function revealKwest(c: AppContext) {
  const tenant = c.get('tenant');
  const slug = c.req.param('slug');
  const body = await c.req.json<{
    lat?: number; lng?: number; accuracy?: number;
    guest_token?: string; sim_lat?: number; sim_lng?: number;
  }>().catch(() => ({} as any));

  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });

  const resolved = await resolvePlayerKey(c, body.guest_token);
  if (!resolved) throw new HTTPException(400, { message: 'Start the hunt first.' });
  const { playerKey, userId, isAdmin } = resolved;

  const progress = await c.env.DB.prepare(
    'SELECT * FROM kwest_progress WHERE hunt_id = ? AND player_key = ?'
  ).bind(hunt.id, playerKey).first<KwestProgressRow>();
  if (!progress) throw new HTTPException(400, { message: 'Start the hunt first.' });

  if (progress.finished_at) {
    return c.json({ data: { result: 'already_finished' } });
  }

  // Test mode (admin interface test-run, per plan Section 7a) plays on
  // hunts in any status and accepts sim coords - only when BOTH the caller
  // is an admin AND their own progress row is flagged is_test.
  const isTestPlayer = isAdmin && progress.is_test === 1;

  if (!isTestPlayer) {
    if (hunt.weather_paused) {
      return c.json({ data: { blocked: 'weather_paused', message: 'This hunt is paused for weather right now. Check back soon.' } });
    }
    if (hunt.status === 'paused') {
      return c.json({ data: { blocked: 'paused', message: 'This hunt is paused right now. Check back soon.' } });
    }
    if (hunt.status === 'ended' || hunt.status === 'archived') {
      return c.json({ data: { blocked: 'ended', message: 'This hunt has ended. Thanks for playing.' } });
    }
    if (hunt.status !== 'live') {
      return c.json({ data: { blocked: 'not_live', message: 'This hunt is not open yet.' } });
    }
  }

  const acked = await hasAck(c.env, hunt.id, playerKey, hunt.rules_version);
  if (!acked) {
    return c.json({ data: { blocked: 'ack_required', rules_version: hunt.rules_version } });
  }

  const step = await getStepInternal(c.env, hunt.id, progress.current_seq);
  if (!step) throw new HTTPException(404, { message: 'Step not found.' });

  // Sim coords accepted ONLY for a test player - real players can never
  // inject coordinates, and a non-test caller's sim_lat/sim_lng is ignored.
  const useSim = isTestPlayer && typeof body.sim_lat === 'number' && typeof body.sim_lng === 'number';
  let lat: number, lng: number, accuracy: number | null;
  if (useSim) {
    lat = body.sim_lat as number;
    lng = body.sim_lng as number;
    accuracy = null;
  } else {
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number' || !isFinite(body.lat) || !isFinite(body.lng)) {
      throw new HTTPException(400, { message: 'Location is required to reveal.' });
    }
    lat = body.lat;
    lng = body.lng;
    accuracy = typeof body.accuracy === 'number' ? body.accuracy : null;
  }

  // Throttle: self-healing soft cap (kwest_progress.confidence) on reveals
  // for this step in the last hour. Confidence regenerates passively over
  // real time and heals fully on a genuine hit; it decays a little on each
  // miss/near, so a rapid string of wrong guesses (the coordinate-oracle
  // risk this endpoint carries) tightens the cap, while an honest player
  // having a rough time is never locked out - the cap has a floor.
  const effectiveConfidence = Math.min(
    1.0,
    progress.confidence + CONFIDENCE_REGEN_PER_HOUR * ((Date.now() / 1000 - progress.updated_at) / 3600),
  );
  const throttleCap = Math.max(THROTTLE_MIN_CAP, Math.round(THROTTLE_BASE_CAP * effectiveConfidence));
  const throttle = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM kwest_reveals
     WHERE hunt_id = ? AND step_id = ? AND player_key = ? AND created_at > unixepoch() - 3600`
  ).bind(hunt.id, step.id, playerKey).first<{ n: number }>();
  if ((throttle?.n ?? 0) > throttleCap) {
    return c.json({ data: { blocked: 'cooldown', message: 'Take a breath and check the clue again.' } });
  }

  const distance = distanceMeters(lat, lng, step.target_lat, step.target_lng);
  const result: 'hit' | 'near' | 'miss' =
    distance <= step.radius_m ? 'hit' : distance <= step.radius_m * 1.5 ? 'near' : 'miss';

  const cfLat = parseFloat(String((c.req.raw as any).cf?.latitude ?? ''));
  const cfLng = parseFloat(String((c.req.raw as any).cf?.longitude ?? ''));

  await c.env.DB.prepare(`
    INSERT INTO kwest_reveals
      (hunt_id, step_id, tenant_id, player_key, result, device_lat, device_lng, accuracy_m, distance_m, edge_lat, edge_lng, is_test, sim)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    hunt.id, step.id, tenant.id, playerKey, result, lat, lng, accuracy, distance,
    isNaN(cfLat) ? null : cfLat, isNaN(cfLng) ? null : cfLng, isTestPlayer ? 1 : 0, useSim ? 1 : 0,
  ).run();

  // A hit heals confidence fully (strong evidence of a genuine, capable
  // player); a miss/near decays it a little, from the regenerated baseline
  // computed above so a passive-regen tick isn't immediately erased.
  const newConfidence = result === 'hit' ? 1.0 : Math.max(CONFIDENCE_MIN, effectiveConfidence - CONFIDENCE_MISS_PENALTY);
  await c.env.DB.prepare(
    'UPDATE kwest_progress SET confidence = ?, updated_at = unixepoch() WHERE hunt_id = ? AND player_key = ?'
  ).bind(newConfidence, hunt.id, playerKey).run();

  if (result !== 'hit') {
    return c.json({
      data: {
        result,
        message: result === 'near' ? 'Very close - check your GPS.' : 'Not quite.',
      },
    });
  }

  // ---- HIT ----

  if (!step.is_final) {
    const nextSeq = step.seq + 1;
    await c.env.DB.prepare(
      `UPDATE kwest_progress SET current_seq = ?, updated_at = unixepoch()
       WHERE hunt_id = ? AND player_key = ? AND current_seq = ?`
    ).bind(nextSeq, hunt.id, playerKey, step.seq).run();

    let stepReward = 0;
    if (!isTestPlayer) {
      const rewardAmount = stepRewardAmount(hunt, step);
      if (userId) {
        try {
          const awarded = await awardWithBudget(
            c.env, hunt.id, tenant.id, userId, rewardAmount,
            `KrowdKwest step solved: ${hunt.name} #${step.seq}`,
            'kwest_step', `${hunt.id}:${step.id}`,
          );
          stepReward = awarded.awarded;
        } catch (err) {
          logger.error(`kwest step award failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // Guest players have no KKCredits account yet - the reward is
        // owed once they attach (increment 2 UI shows this as pending).
        stepReward = rewardAmount;
      }
    }

    let minigameOffer: { offer_id: string; game: string; tease: string } | null = null;
    if (!isTestPlayer && step.minigame_enabled && userId) {
      if (Math.floor(Math.random() * 10000) < hunt.minigame_offer_bp) {
        const game = MINIGAMES[Math.floor(Math.random() * MINIGAMES.length)];
        const teaseVariant = Math.floor(Math.random() * KWEST_TEASE_LINES.length);
        const offerId = nanoid(16);
        await c.env.DB.prepare(`
          INSERT INTO kwest_minigame_plays
            (offer_id, hunt_id, step_id, tenant_id, player_key, user_id, game, tease_variant, expires_at, is_test)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch() + 1800, 0)
        `).bind(offerId, hunt.id, step.id, tenant.id, playerKey, userId, game, teaseVariant).run();
        minigameOffer = { offer_id: offerId, game, tease: teaseLine(teaseVariant) };
      }
    }

    const nextStep = await getStepPublic(c.env, hunt.id, nextSeq);

    return c.json({
      data: {
        result: 'hit',
        step_reward: stepReward,
        next_clues: nextStep ? JSON.parse(nextStep.clues_json) : null,
        next_is_final: nextStep ? !!nextStep.is_final : null,
        minigame_offer: minigameOffer,
      },
    });
  }

  // ---- HIT, FINAL STEP ----

  if (!userId) {
    // Geo-verified, but a finish requires a signed-in account. The client
    // walls with sign-in -> attach, then re-submits this same reveal.
    return c.json({ data: { result: 'hit', finish_pending_auth: true } });
  }

  const isTestFinish = isTestPlayer ? 1 : 0;
  let finishRank: number | null = null;
  // Real persona if one is set (dev plan Section 6); anonymous default
  // otherwise. Editable via /display-choice until official end.
  const defaultDisplayChoice: 'anonymous' | 'real' = resolved.hasRealPersona ? 'real' : 'anonymous';
  const nameSnapshot = defaultDisplayChoice === 'real'
    ? (resolved.personaNames?.real ?? `Member ${userId}`)
    : (resolved.personaNames?.anonymous ?? 'A L&L Member');

  for (let attempt = 0; attempt < 2 && finishRank === null; attempt++) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO kwest_finishes
          (hunt_id, user_id, tenant_id, finish_rank, finished_at, prize_kind, prize_kredits,
           display_choice, display_name_snapshot, is_test)
        SELECT ?, ?, ?, COALESCE(MAX(finish_rank), 0) + 1, unixepoch(), 'none', 0, ?, ?, ?
        FROM kwest_finishes WHERE hunt_id = ? AND is_test = ?
      `).bind(
        hunt.id, userId, tenant.id, defaultDisplayChoice, nameSnapshot, isTestFinish,
        hunt.id, isTestFinish,
      ).run();

      const row = await c.env.DB.prepare(
        'SELECT finish_rank FROM kwest_finishes WHERE hunt_id = ? AND user_id = ?'
      ).bind(hunt.id, userId).first<{ finish_rank: number }>();
      finishRank = row?.finish_rank ?? null;
    } catch (err) {
      if (attempt === 1) throw err; // rank race on the UNIQUE index - retried once, then surfaces
    }
  }

  const rank = finishRank as number;
  let prizeKind: 'grand' | 'kk_rank' | 'kk_consolation' | 'none';
  let prizeKredits = 0;
  if (rank === 1) {
    prizeKind = 'grand';
    prizeKredits = hunt.grand_prize_kredits;
  } else if (rank <= 10) {
    prizeKind = 'kk_rank';
    prizeKredits = hunt.rank2_10_kredits;
  } else if (rank <= 20) {
    prizeKind = 'kk_consolation';
    prizeKredits = hunt.rank11_20_kredits;
  } else {
    prizeKind = 'none';
  }

  await c.env.DB.prepare(
    'UPDATE kwest_finishes SET prize_kind = ?, prize_kredits = ? WHERE hunt_id = ? AND user_id = ?'
  ).bind(prizeKind, prizeKredits, hunt.id, userId).run();

  if (!isTestPlayer) {
    if (prizeKind === 'grand') {
      // Grand-prize KK is held for ID verification (increment 4 claims
      // review) - never awarded automatically at finish time.
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO kwest_claims (hunt_id, user_id, tenant_id, finish_rank, status)
        VALUES (?, ?, ?, ?, 'pending')
      `).bind(hunt.id, userId, tenant.id, rank).run();
    } else if (prizeKredits > 0) {
      try {
        await awardWithBudget(
          c.env, hunt.id, tenant.id, userId, prizeKredits,
          `KrowdKwest finish reward: ${hunt.name} (rank ${rank})`,
          'kwest_finish', `${hunt.id}`,
        );
      } catch (err) {
        logger.error(`kwest finish award failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (rank === 20) {
      await c.env.DB.prepare(`
        UPDATE kwest_hunts SET official_end_at = MIN(unixepoch() + 86400, ends_at), updated_at = unixepoch()
        WHERE id = ?
      `).bind(hunt.id).run();
    }

    await notifyKwestFinish(
      c.env, userId, 'You found it!',
      prizeKind === 'grand'
        ? `You're in first place! We will be in touch about claiming your grand prize.`
        : `You finished KrowdKwest in rank ${rank}.`,
    );
  }

  return c.json({
    data: {
      result: 'hit',
      finished: true,
      rank,
      prize_kind: prizeKind,
      prize_kredits: prizeKredits,
      grand_prize_description: prizeKind === 'grand' ? hunt.grand_prize_description : null,
      display_prompt: {
        default_choice: defaultDisplayChoice,
        real_name: resolved.personaNames?.real ?? null,
        anonymous_name: resolved.personaNames?.anonymous ?? 'A L&L Member',
      },
    },
  });
}

interface KwestMinigamePlayRow {
  offer_id: string;
  hunt_id: number;
  step_id: number;
  tenant_id: string;
  player_key: string;
  user_id: string | null;
  game: 'chest_pick' | 'compass_stop' | 'scratch_off';
  tease_variant: number;
  status: string;
  expires_at: number;
  is_test: number;
}

function validMinigameInput(game: string, input: unknown): boolean {
  const i = input as Record<string, unknown> | null | undefined;
  if (game === 'chest_pick') return typeof i?.chest === 'number' && [0, 1, 2].includes(i.chest);
  if (game === 'compass_stop') return typeof i?.t_ms === 'number' && isFinite(i.t_ms as number);
  if (game === 'scratch_off') return i?.scratched === true;
  return false;
}

/**
 * POST /api/t/:tenant/kwest/minigame/:offerId {input} - the interaction is
 * presentation only; the server decides the result (dev plan Section 5).
 * Exactly-once via the atomic status flip below, plus KKCredits' own
 * (user_id, ref_type, ref_id) idempotency on the award.
 */
export async function playKwestMinigame(c: AppContext) {
  const tenant = c.get('tenant');
  const offerId = c.req.param('offerId');
  const body = await c.req.json<{ input?: unknown; guest_token?: string }>().catch(() => ({} as any));

  const resolved = await resolvePlayerKey(c, body.guest_token);
  if (!resolved) throw new HTTPException(403, { message: 'This offer is not yours.' });

  const offer = await c.env.DB.prepare(
    'SELECT * FROM kwest_minigame_plays WHERE offer_id = ?'
  ).bind(offerId).first<KwestMinigamePlayRow>();
  if (!offer || offer.tenant_id !== tenant.id) throw new HTTPException(404, { message: 'This offer could not be found.' });
  if (offer.player_key !== resolved.playerKey) throw new HTTPException(403, { message: 'This offer is not yours.' });

  if (offer.status === 'played') {
    return c.json({ data: { outcome: 'already_played' } });
  }
  if (offer.status === 'expired' || offer.expires_at < Math.floor(Date.now() / 1000)) {
    await c.env.DB.prepare(
      "UPDATE kwest_minigame_plays SET status = 'expired' WHERE offer_id = ? AND status = 'offered'"
    ).bind(offerId).run();
    return c.json({ data: { outcome: 'expired' } });
  }

  if (!validMinigameInput(offer.game, body.input)) {
    throw new HTTPException(400, { message: 'Invalid input for this game.' });
  }

  // Exactly-once: only the request that wins this race actually plays.
  const flip = await c.env.DB.prepare(
    "UPDATE kwest_minigame_plays SET status = 'played', played_at = unixepoch(), input_json = ? WHERE offer_id = ? AND status = 'offered'"
  ).bind(JSON.stringify(body.input ?? null), offerId).run();
  if ((flip.meta?.changes ?? 0) !== 1) {
    return c.json({ data: { outcome: 'already_played' } });
  }

  const hunt = await getHuntRowById(c.env, offer.hunt_id);
  let outcomeKredits = 0;

  if (!offer.is_test && hunt && offer.user_id) {
    outcomeKredits = drawMinigameOutcome(hunt.minigame_max_award);
    if (outcomeKredits > 0) {
      try {
        const awarded = await awardWithBudget(
          c.env, hunt.id, tenant.id, offer.user_id, outcomeKredits,
          `KrowdKwest mini-game: ${offer.game}`, 'kwest_bonus', offer.offer_id,
        );
        outcomeKredits = awarded.awarded;
      } catch (err) {
        logger.error(`kwest minigame award failed: ${err instanceof Error ? err.message : String(err)}`);
        outcomeKredits = 0;
      }
    }
  }

  await c.env.DB.prepare(
    'UPDATE kwest_minigame_plays SET outcome_kredits = ? WHERE offer_id = ?'
  ).bind(outcomeKredits, offerId).run();

  return c.json({ data: { outcome: 'played', game: offer.game, outcome_kredits: outcomeKredits } });
}

// ============================================================
// AUTHENTICATED
// ============================================================

/** POST /api/t/:tenant/kwest/attach - migrate a guest's progress/acks/reveals/plays to the signed-in account. */
export async function attachKwestGuest(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = user.sub;
  const body = await c.req.json<{ guest_token?: string }>().catch(() => ({} as { guest_token?: string }));

  if (!body.guest_token) throw new HTTPException(400, { message: 'A guest token is required.' });

  const gid = await resolveGuestId(c.env, tenant.id, body.guest_token);
  if (!gid) {
    return c.json({ data: { attached: false, reason: 'invalid_or_already_attached' } });
  }

  const guestKey = `g:${gid}`;
  const userKey = `u:${userId}`;

  // kwest_progress PK is (hunt_id, player_key) - a hunt the user already has
  // their own progress on wins; the guest row is dropped, never overwritten.
  const guestProgress = await c.env.DB.prepare(
    'SELECT hunt_id FROM kwest_progress WHERE player_key = ?'
  ).bind(guestKey).all<{ hunt_id: number }>();

  for (const row of guestProgress.results ?? []) {
    const existing = await c.env.DB.prepare(
      'SELECT 1 FROM kwest_progress WHERE hunt_id = ? AND player_key = ?'
    ).bind(row.hunt_id, userKey).first();

    if (!existing) {
      await c.env.DB.prepare(
        'UPDATE kwest_progress SET player_key = ?, user_id = ? WHERE hunt_id = ? AND player_key = ?'
      ).bind(userKey, userId, row.hunt_id, guestKey).run();
    } else {
      await c.env.DB.prepare(
        'DELETE FROM kwest_progress WHERE hunt_id = ? AND player_key = ?'
      ).bind(row.hunt_id, guestKey).run();
    }
  }

  // kwest_acknowledgements UNIQUE(hunt_id, player_key, rules_version) - merge
  // via INSERT OR IGNORE under the user's key, then drop the guest's rows.
  const guestAcks = await c.env.DB.prepare(
    'SELECT hunt_id, rules_version FROM kwest_acknowledgements WHERE player_key = ?'
  ).bind(guestKey).all<{ hunt_id: number; rules_version: number }>();

  for (const ack of guestAcks.results ?? []) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO kwest_acknowledgements (hunt_id, tenant_id, player_key, rules_version) VALUES (?, ?, ?, ?)'
    ).bind(ack.hunt_id, tenant.id, userKey, ack.rules_version).run();
  }
  await c.env.DB.prepare('DELETE FROM kwest_acknowledgements WHERE player_key = ?').bind(guestKey).run();

  // kwest_reveals (append-only log) and kwest_minigame_plays (unique on
  // offer_id, not player_key) have no per-key uniqueness - safe blind moves.
  await c.env.DB.prepare('UPDATE kwest_reveals SET player_key = ? WHERE player_key = ?').bind(userKey, guestKey).run();
  await c.env.DB.prepare(
    'UPDATE kwest_minigame_plays SET player_key = ?, user_id = ? WHERE player_key = ?'
  ).bind(userKey, userId, guestKey).run();

  await c.env.DB.prepare(
    'UPDATE kwest_guest_keys SET attached_user_id = ?, attached_at = unixepoch() WHERE id = ?'
  ).bind(userId, gid).run();

  return c.json({ data: { attached: true } });
}

/**
 * POST /api/t/:tenant/kwest/:slug/display-choice {choice:'anonymous'|'real'}
 * Allowed only while display_locked=0; re-snapshots display_name_snapshot.
 */
export async function setKwestDisplayChoice(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = user.sub;
  const slug = c.req.param('slug');
  const body = await c.req.json<{ choice?: string }>().catch(() => ({} as { choice?: string }));

  if (body.choice !== 'anonymous' && body.choice !== 'real') {
    throw new HTTPException(400, { message: "choice must be 'anonymous' or 'real'." });
  }

  const hunt = await getHuntRow(c.env, tenant.id, slug);
  if (!hunt) throw new HTTPException(404, { message: 'Hunt not found.' });

  const finish = await c.env.DB.prepare(
    'SELECT display_locked FROM kwest_finishes WHERE hunt_id = ? AND user_id = ?'
  ).bind(hunt.id, userId).first<{ display_locked: number }>();
  if (!finish) throw new HTTPException(404, { message: "You haven't finished this hunt." });
  if (finish.display_locked) {
    return c.json({ data: { updated: false, reason: 'locked' } });
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  const persona = token ? await fetchPersonaInfo(c.env, token) : null;
  const nameSnapshot = body.choice === 'real'
    ? (persona?.personaNames.real ?? user.name ?? `Member ${userId}`)
    : (persona?.personaNames.anonymous ?? 'A L&L Member');

  await c.env.DB.prepare(
    'UPDATE kwest_finishes SET display_choice = ?, display_name_snapshot = ? WHERE hunt_id = ? AND user_id = ?'
  ).bind(body.choice, nameSnapshot, hunt.id, userId).run();

  return c.json({ data: { updated: true, choice: body.choice, display_name: nameSnapshot } });
}

/** GET /api/t/:tenant/kwest/mine - the signed-in player's progress across hunts, for /kwest home. */
export async function getMyKwestProgress(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = user.sub;

  const { results } = await c.env.DB.prepare(`
    SELECT h.slug, h.name, h.status, p.current_seq, p.finished_at,
           f.finish_rank, f.prize_kind
    FROM kwest_progress p
    JOIN kwest_hunts h ON h.id = p.hunt_id
    LEFT JOIN kwest_finishes f ON f.hunt_id = p.hunt_id AND f.user_id = p.user_id AND f.is_test = 0
    WHERE p.tenant_id = ? AND p.player_key = ? AND p.is_test = 0
    ORDER BY p.updated_at DESC
  `).bind(tenant.id, `u:${userId}`).all<any>();

  return c.json({ data: results ?? [] });
}
