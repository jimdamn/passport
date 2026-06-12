import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { hmacHex } from '../lib/hmac';
import { QR } from 'qr-svg';

type AppContext = Context<{ Bindings: Env }>;

const TEST_PLAQUE_ID = 'test-plaque';
const TEST_PRIZE_ID = 'test-prize-base';

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }
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
