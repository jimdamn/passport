import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { hmacHex } from '../lib/hmac';
import { QR } from 'qr-svg';
import { nanoid } from 'nanoid';

type AppContext = Context<{ Bindings: Env }>;

const TEST_PLAQUE_ID = 'test-plaque';
const TEST_PRIZE_ID = 'test-prize-base';

const PLAQUE_CATEGORIES = ['dining', 'shopping', 'farmfood', 'recreation', 'attractions', 'lodging'];
const PRIZE_TYPES = ['kredits_base', 'kredits_jackpot', 'merchant_coupon', 'merchant_gift', 'cash'];

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }
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
    isFinite(lat) && isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon as number) <= 180
  );
}

async function signedScanUrl(c: AppContext, plaqueId: string): Promise<{ scan_url: string; qr_svg: string }> {
  const tenant = c.get('tenant');
  const sig = await hmacHex(c.env.QR_SIGNING_SECRET, `/scan:${plaqueId}`);
  const scanUrl = `https://${tenant.hostname}/scan?plaque=${plaqueId}&sig=${sig}`;
  return { scan_url: scanUrl, qr_svg: QR(scanUrl) };
}

// Uniform-random hidden release times across the remaining event window.
// First eligible scan at/after each drop_at wins that unit.
function generateDropTimes(quantity: number, windowStart: number, windowEnd: number): number[] {
  const start = Math.max(windowStart, Math.floor(Date.now() / 1000));
  const times: number[] = [];
  for (let i = 0; i < quantity; i++) {
    times.push(start + Math.floor(Math.random() * Math.max(1, windowEnd - start)));
  }
  return times.sort((a, b) => a - b);
}

// ============================================================
// PLAQUES
// ============================================================

/**
 * GET /api/t/:tenant/admin/plaques
 * All plaques for the tenant with scan counts and printable signed QR codes.
 */
export async function listPlaques(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM passport_scans s WHERE s.plaque_id = p.id) AS scan_count
    FROM passport_plaques p
    WHERE p.tenant_id = ?
    ORDER BY p.created_at DESC
  `).bind(tenant.id).all<any>();

  const plaques = await Promise.all(
    (results || []).map(async (p) => ({ ...p, ...(await signedScanUrl(c, p.id)) }))
  );

  return c.json({ data: plaques });
}

/**
 * POST /api/t/:tenant/admin/plaques
 * Create a plaque. Event plaques (is_event) skip the geofence at scan time and
 * may carry a start/end window; coordinates are optional for them.
 */
export async function createPlaque(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));

  const name = cleanText(body.name, 120);
  const locationName = cleanText(body.location_name, 120);
  const category = PLAQUE_CATEGORIES.includes(body.category) ? body.category : null;
  const isEvent = body.is_event ? 1 : 0;

  if (!name || !locationName || !category) {
    throw new HTTPException(400, { message: 'name, location_name, and a valid category are required.' });
  }

  let lat = 0;
  let lon = 0;
  if (isValidCoord(body.lat, body.lon)) {
    lat = body.lat;
    lon = body.lon;
  } else if (!isEvent) {
    throw new HTTPException(400, { message: 'Valid lat/lon coordinates are required for a standard plaque (visitors must be within 500m of them).' });
  }

  const eventStart = Number.isFinite(body.event_start) ? Math.floor(body.event_start) : null;
  const eventEnd = Number.isFinite(body.event_end) ? Math.floor(body.event_end) : null;
  if (eventStart && eventEnd && eventEnd <= eventStart) {
    throw new HTTPException(400, { message: 'The event end time must be after the start time.' });
  }

  const id = nanoid(10);
  await c.env.DB.prepare(`
    INSERT INTO passport_plaques (id, tenant_id, name, location_name, lat, lon, category, is_active, is_event, event_start, event_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).bind(id, tenant.id, name, locationName, lat, lon, category, isEvent, isEvent ? eventStart : null, isEvent ? eventEnd : null).run();

  const plaque = await c.env.DB.prepare('SELECT * FROM passport_plaques WHERE id = ?').bind(id).first<any>();
  return c.json({ data: { ...plaque, scan_count: 0, ...(await signedScanUrl(c, id)) } });
}

/**
 * PUT /api/t/:tenant/admin/plaques/:id
 * Update a plaque. If an event window changes, unwon paced drops for its prizes
 * are regenerated inside the new window so pacing stays correct.
 */
export async function updatePlaque(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM passport_plaques WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Plaque not found.' });

  const name = cleanText(body.name, 120) ?? existing.name;
  const locationName = cleanText(body.location_name, 120) ?? existing.location_name;
  const category = PLAQUE_CATEGORIES.includes(body.category) ? body.category : existing.category;
  const isEvent = body.is_event === undefined ? existing.is_event : (body.is_event ? 1 : 0);
  const isActive = body.is_active === undefined ? existing.is_active : (body.is_active ? 1 : 0);

  let lat = existing.lat;
  let lon = existing.lon;
  if (isValidCoord(body.lat, body.lon)) {
    lat = body.lat;
    lon = body.lon;
  }
  if (!isEvent && !isValidCoord(lat, lon)) {
    throw new HTTPException(400, { message: 'Valid coordinates are required for a standard plaque.' });
  }

  const eventStart = body.event_start === null ? null
    : Number.isFinite(body.event_start) ? Math.floor(body.event_start) : existing.event_start;
  const eventEnd = body.event_end === null ? null
    : Number.isFinite(body.event_end) ? Math.floor(body.event_end) : existing.event_end;
  if (eventStart && eventEnd && eventEnd <= eventStart) {
    throw new HTTPException(400, { message: 'The event end time must be after the start time.' });
  }

  await c.env.DB.prepare(`
    UPDATE passport_plaques
    SET name = ?, location_name = ?, category = ?, lat = ?, lon = ?,
        is_active = ?, is_event = ?, event_start = ?, event_end = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(name, locationName, category, lat, lon, isActive, isEvent,
    isEvent ? eventStart : null, isEvent ? eventEnd : null, id, tenant.id).run();

  const windowChanged = isEvent && (eventStart !== existing.event_start || eventEnd !== existing.event_end);
  if (windowChanged && eventStart && eventEnd) {
    const { results: pacedPrizes } = await c.env.DB.prepare(
      'SELECT id FROM passport_prizes WHERE plaque_id = ? AND is_paced = 1 AND is_active = 1'
    ).bind(id).all<{ id: string }>();

    for (const prize of pacedPrizes || []) {
      const pending = await c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM passport_prize_drops WHERE prize_id = ? AND won_scan_id IS NULL'
      ).bind(prize.id).first<{ n: number }>();
      const count = pending?.n ?? 0;
      if (count === 0) continue;

      await c.env.DB.prepare(
        'DELETE FROM passport_prize_drops WHERE prize_id = ? AND won_scan_id IS NULL'
      ).bind(prize.id).run();

      const drops = generateDropTimes(count, eventStart, eventEnd);
      await c.env.DB.batch(drops.map(dropAt =>
        c.env.DB.prepare('INSERT INTO passport_prize_drops (id, prize_id, drop_at) VALUES (?, ?, ?)')
          .bind(nanoid(), prize.id, dropAt)
      ));
    }
  }

  const plaque = await c.env.DB.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM passport_scans s WHERE s.plaque_id = p.id) AS scan_count
    FROM passport_plaques p WHERE p.id = ?
  `).bind(id).first<any>();
  return c.json({ data: { ...plaque, ...(await signedScanUrl(c, id)) } });
}

/**
 * DELETE /api/t/:tenant/admin/plaques/:id
 * Hard-deletes a plaque with no scan/claim history; otherwise deactivates it so
 * history stays intact.
 */
export async function deletePlaque(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM passport_plaques WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Plaque not found.' });

  const history = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM passport_scans WHERE plaque_id = ?) +
      (SELECT COUNT(*) FROM passport_claims WHERE plaque_id = ?) AS n
  `).bind(id, id).first<{ n: number }>();

  if ((history?.n ?? 0) > 0) {
    await c.env.DB.prepare(
      'UPDATE passport_plaques SET is_active = 0 WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
    return c.json({ data: { removed: false, deactivated: true } });
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM passport_prize_drops WHERE prize_id IN (SELECT id FROM passport_prizes WHERE plaque_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM passport_prizes WHERE plaque_id = ? AND tenant_id = ?').bind(id, tenant.id),
    c.env.DB.prepare('DELETE FROM passport_plaques WHERE id = ? AND tenant_id = ?').bind(id, tenant.id),
  ]);
  return c.json({ data: { removed: true, deactivated: false } });
}

// ============================================================
// PRIZES
// ============================================================

/**
 * GET /api/t/:tenant/admin/prizes
 * All prizes with plaque names and paced-drop progress.
 */
export async function listPrizes(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT pr.*,
           pl.name AS plaque_name,
           (SELECT COUNT(*) FROM passport_prize_drops d WHERE d.prize_id = pr.id) AS drops_total,
           (SELECT COUNT(*) FROM passport_prize_drops d WHERE d.prize_id = pr.id AND d.won_scan_id IS NOT NULL) AS drops_won
    FROM passport_prizes pr
    LEFT JOIN passport_plaques pl ON pl.id = pr.plaque_id
    WHERE pr.tenant_id = ?
    ORDER BY pr.is_active DESC, pr.rowid DESC
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /api/t/:tenant/admin/prizes
 * Create a prize. Paced prizes require an event plaque with a full time window;
 * their stock is released via hidden random drop times across that window.
 */
export async function createPrize(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));

  const name = cleanText(body.name, 120);
  const prizeType = PRIZE_TYPES.includes(body.prize_type) ? body.prize_type : null;
  if (!name || !prizeType) {
    throw new HTTPException(400, { message: 'name and a valid prize_type are required.' });
  }

  const value = Number.isFinite(body.value) ? Math.max(0, Math.floor(body.value)) : 0;
  const details = cleanText(body.details, 500);
  const isPaced = body.is_paced ? 1 : 0;

  let plaqueId: string | null = null;
  let plaque: any = null;
  if (body.plaque_id) {
    plaque = await c.env.DB.prepare(
      'SELECT * FROM passport_plaques WHERE id = ? AND tenant_id = ?'
    ).bind(String(body.plaque_id), tenant.id).first<any>();
    if (!plaque) throw new HTTPException(400, { message: 'The selected plaque does not exist.' });
    plaqueId = plaque.id;
  }

  let quantity = -1;
  if (Number.isFinite(body.quantity)) {
    quantity = Math.floor(body.quantity);
    if (quantity < -1 || quantity === 0) {
      throw new HTTPException(400, { message: 'quantity must be a positive number, or -1 for unlimited.' });
    }
  }

  let probability = 0;
  if (isPaced) {
    if (!plaque || !plaque.is_event || !plaque.event_start || !plaque.event_end) {
      throw new HTTPException(400, { message: 'Paced prizes must be attached to an event plaque that has both a start and end time.' });
    }
    if (quantity < 1) {
      throw new HTTPException(400, { message: 'Paced prizes need a specific quantity (how many units will drop during the event).' });
    }
  } else if (prizeType === 'kredits_base') {
    probability = 1.0;
  } else {
    probability = Number(body.probability);
    if (!isFinite(probability) || probability <= 0 || probability > 1) {
      throw new HTTPException(400, { message: 'probability must be between 0 and 1 (e.g. 0.05 = 5% of scans).' });
    }
  }

  const id = nanoid(10);
  await c.env.DB.prepare(`
    INSERT INTO passport_prizes (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, plaque_id, merchant_id, is_paced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?)
  `).bind(id, tenant.id, name, prizeType, value, details, probability, quantity, plaqueId, isPaced).run();

  if (isPaced) {
    const drops = generateDropTimes(quantity, plaque.event_start, plaque.event_end);
    await c.env.DB.batch(drops.map(dropAt =>
      c.env.DB.prepare('INSERT INTO passport_prize_drops (id, prize_id, drop_at) VALUES (?, ?, ?)')
        .bind(nanoid(), id, dropAt)
    ));
  }

  const prize = await c.env.DB.prepare('SELECT * FROM passport_prizes WHERE id = ?').bind(id).first<any>();
  return c.json({ data: { ...prize, drops_total: isPaced ? quantity : 0, drops_won: 0 } });
}

/**
 * PUT /api/t/:tenant/admin/prizes/:id
 * Update a prize. Paced prize stock is controlled by its drop schedule, so only
 * name/details/value/is_active can change on those.
 */
export async function updatePrize(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM passport_prizes WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Prize not found.' });

  const name = cleanText(body.name, 120) ?? existing.name;
  const details = body.details === null ? null : (cleanText(body.details, 500) ?? existing.details);
  const value = Number.isFinite(body.value) ? Math.max(0, Math.floor(body.value)) : existing.value;
  const isActive = body.is_active === undefined ? existing.is_active : (body.is_active ? 1 : 0);

  let probability = existing.probability;
  let quantity = existing.quantity_left;
  if (!existing.is_paced) {
    if (body.probability !== undefined && existing.prize_type !== 'kredits_base') {
      probability = Number(body.probability);
      if (!isFinite(probability) || probability <= 0 || probability > 1) {
        throw new HTTPException(400, { message: 'probability must be between 0 and 1.' });
      }
    }
    if (Number.isFinite(body.quantity)) {
      quantity = Math.floor(body.quantity);
      if (quantity < -1 || quantity === 0) {
        throw new HTTPException(400, { message: 'quantity must be a positive number, or -1 for unlimited.' });
      }
    }
  }

  await c.env.DB.prepare(`
    UPDATE passport_prizes
    SET name = ?, details = ?, value = ?, probability = ?, quantity_left = ?, is_active = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(name, details, value, probability, quantity, isActive, id, tenant.id).run();

  const prize = await c.env.DB.prepare(`
    SELECT pr.*,
           (SELECT COUNT(*) FROM passport_prize_drops d WHERE d.prize_id = pr.id) AS drops_total,
           (SELECT COUNT(*) FROM passport_prize_drops d WHERE d.prize_id = pr.id AND d.won_scan_id IS NOT NULL) AS drops_won
    FROM passport_prizes pr WHERE pr.id = ?
  `).bind(id).first<any>();
  return c.json({ data: prize });
}

/**
 * DELETE /api/t/:tenant/admin/prizes/:id
 * Hard-deletes a prize nobody has claimed/won yet; otherwise deactivates it so
 * claim history stays intact.
 */
export async function deletePrize(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM passport_prizes WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Prize not found.' });

  const history = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM passport_claims WHERE prize_id = ?) +
      (SELECT COUNT(*) FROM passport_prize_drops WHERE prize_id = ? AND won_scan_id IS NOT NULL) AS n
  `).bind(id, id).first<{ n: number }>();

  if ((history?.n ?? 0) > 0) {
    await c.env.DB.prepare(
      'UPDATE passport_prizes SET is_active = 0 WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
    return c.json({ data: { removed: false, deactivated: true } });
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM passport_prize_drops WHERE prize_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM passport_prizes WHERE id = ? AND tenant_id = ?').bind(id, tenant.id),
  ]);
  return c.json({ data: { removed: true, deactivated: false } });
}

/**
 * POST /api/t/:tenant/admin/test-plaque
 * Creates (or moves) a single test plaque at the admin's current location and
 * returns the signed scan URL + QR code. Also clears prior test scans so the
 * plaque can be re-scanned immediately, bypassing the 24h cooldown.
 */
export async function createTestPlaque(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const body = await c.req.json<{ lat?: number; lon?: number }>().catch(() => ({} as { lat?: number; lon?: number }));
  const { lat, lon } = body;
  if (
    typeof lat !== 'number' || typeof lon !== 'number' ||
    !isFinite(lat) || !isFinite(lon) ||
    Math.abs(lat) > 90 || Math.abs(lon) > 180
  ) {
    throw new HTTPException(400, {
      message: 'Your current location is required so the test plaque is placed where you are standing. Please enable location access.',
    });
  }

  await c.env.DB.prepare(`
    INSERT INTO passport_plaques (id, tenant_id, name, location_name, lat, lon, category, is_active)
    VALUES (?, ?, 'Test Plaque', 'Testing Station', ?, ?, 'attractions', 1)
    ON CONFLICT(id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, is_active = 1
  `).bind(TEST_PLAQUE_ID, tenant.id, lat, lon).run();

  // Baseline prize so the scan's prize draw always resolves. quantity_left -1
  // means unlimited stock.
  const creditsName = tenant.config.credits_name || 'KrowdKredits';
  await c.env.DB.prepare(`
    INSERT INTO passport_prizes (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active)
    VALUES (?, ?, ?, 'kredits_base', 5, NULL, 1.0, -1, 1)
    ON CONFLICT(id) DO UPDATE SET is_active = 1
  `).bind(TEST_PRIZE_ID, tenant.id, `5 ${creditsName}`).run();

  // Reset cooldown so repeat verification scans work right away
  await c.env.DB.prepare(
    'DELETE FROM passport_scans WHERE plaque_id = ?'
  ).bind(TEST_PLAQUE_ID).run();

  const sig = await hmacHex(c.env.QR_SIGNING_SECRET, `/scan:${TEST_PLAQUE_ID}`);
  const scanUrl = `https://${tenant.hostname}/scan?plaque=${TEST_PLAQUE_ID}&sig=${sig}`;

  return c.json({
    data: {
      scan_url: scanUrl,
      qr_svg: QR(scanUrl),
      lat,
      lon,
    },
  });
}

/**
 * DELETE /api/t/:tenant/admin/test-plaque
 * Removes the test plaque, its prize, and all test scan/claim records.
 */
export async function removeTestPlaque(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM passport_claims WHERE plaque_id = ? AND tenant_id = ?').bind(TEST_PLAQUE_ID, tenant.id),
    c.env.DB.prepare('DELETE FROM passport_scans WHERE plaque_id = ?').bind(TEST_PLAQUE_ID),
    c.env.DB.prepare('DELETE FROM passport_prizes WHERE id = ? AND tenant_id = ?').bind(TEST_PRIZE_ID, tenant.id),
    c.env.DB.prepare('DELETE FROM passport_plaques WHERE id = ? AND tenant_id = ?').bind(TEST_PLAQUE_ID, tenant.id),
  ]);

  return c.json({ data: { removed: true } });
}
