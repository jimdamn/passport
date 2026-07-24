/**
 * Cloudflare Pages middleware
 *
 * Responsibilities (in order):
 *   1. Geo-gate — intercepts HTML page requests that lack a valid kk_geo_trust
 *      cookie and serves a branded redirect page pointing to the apps hub for
 *      location verification.  API requests (/api/*) always pass through so
 *      the waitlist form and auth refresh keep working.
 *
 *      Location is verified exclusively via browser geolocation in kk-apps-hub
 *      and kk-login.  Cloudflare IP-based checks (cf.country / cf.regionCode)
 *      have been removed.  The kk_geo_trust cookie is a HMAC-SHA256 signed JWT
 *      scoped to .lakeandlocals.com; it is issued by kk-apps-hub or kk-login
 *      after the user passes browser geolocation or traveling-member OTP auth.
 *
 *   2. Meta-tag rewriting — for valid-token visitors, rewrites the static
 *      OG / Twitter meta tags in index.html with the correct tenant brand,
 *      so social crawlers see the right title and description.
 */

import type { Env } from '../src/types';
import { hmacHex, timingSafeEqual } from '../src/lib/hmac';

// ─── Geo trust-token verification ────────────────────────────────────────────
// Inline implementation — Pages Functions can't share source with Workers.
// Must stay in sync with kk-apps-hub/src/lib/geo.ts and kk-login/src/lib/geo.ts.

interface GeoTokenPayload {
  type: 'local_verified' | 'geo_bypass';
  iat:  number;
  exp:  number;
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary  = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function verifyGeoToken(
  token: string,
  secret: string,
): Promise<GeoTokenPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBuf = b64urlDecode(sig).buffer as ArrayBuffer;
    const msgBuf = new TextEncoder().encode(`${header}.${body}`).buffer as ArrayBuffer;
    const valid  = await crypto.subtle.verify('HMAC', key, sigBuf, msgBuf);
    if (!valid) return null;

    const payload = JSON.parse(
      atob(body.replace(/-/g, '+').replace(/_/g, '/'))
    ) as GeoTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signGeoToken(
  type: 'local_verified' | 'geo_bypass',
  secret: string,
  ttlDays: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: GeoTokenPayload = { type, iat: now, exp: now + ttlDays * 86400 };

  const header  = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).buffer as ArrayBuffer);
  const body    = base64url(new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const message = new TextEncoder().encode(`${header}.${body}`);
  const key     = await hmacKey(secret);
  const sig     = await crypto.subtle.sign('HMAC', key, message);

  return `${header}.${body}.${base64url(sig)}`;
}

function geoTokenCookie(token: string, ttlDays: number, domain: string): string {
  return (
    `kk_geo_trust=${token}` +
    `; HttpOnly; Secure; SameSite=Lax; Path=/` +
    `; Max-Age=${ttlDays * 86400}` +
    `; Domain=${domain}`
  );
}

function extractGeoToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)kk_geo_trust=([^;]+)/);
  return match ? match[1] : null;
}

// ─── Event-plaque scan bypass ────────────────────────────────────────────────
// A roving event plaque (e.g. a QR on a t-shirt at a street fair) is meant to be
// scanned by passers-by who are not region-verified. The geo-gate would otherwise
// wall them out before the SPA — and thus before the scan API's own event check —
// could run, defeating the whole point of an event plaque. So if a /scan page load
// carries a validly-signed link for a currently-active EVENT plaque, we let it
// through and mint a short-lived geo_bypass cookie for the rest of the visit. The
// scan API still enforces the full signature + time-window + cooldown checks; this
// only unlocks the front door. Non-event plaques are unaffected and still require
// region trust.
async function isActiveEventScan(
  url: URL,
  env: Env & { QR_SIGNING_SECRET: string },
): Promise<boolean> {
  if (url.pathname !== '/scan') return false;

  const plaqueId = url.searchParams.get('plaque') || url.searchParams.get('id');
  const sig      = url.searchParams.get('sig');
  if (!plaqueId || !sig) return false;

  const expectedSig = await hmacHex(env.QR_SIGNING_SECRET, `/scan:${plaqueId}`);
  if (!timingSafeEqual(sig, expectedSig)) return false;

  const plaque = await env.DB.prepare(
    'SELECT is_event, event_start, event_end FROM passport_plaques WHERE id = ? AND is_active = 1'
  ).bind(plaqueId).first<{ is_event: number; event_start: number | null; event_end: number | null }>();

  if (!plaque || plaque.is_event !== 1) return false;

  const now = Math.floor(Date.now() / 1000);
  if (plaque.event_start && now < plaque.event_start) return false;
  if (plaque.event_end && now > plaque.event_end) return false;

  return true;
}

// ─── Fresh Today stand-page crawler bypass + OG meta ─────────────────────────
// Stand detail pages are the route that gets shared externally (into county
// Facebook groups). Stand ids are nanoid strings.
const FRESH_STAND_PATTERN = /^\/fresh\/stand\/([\w-]+)$/;

// ─── Sale Day detail-page crawler bypass + OG meta ───────────────────────────
// Same growth rail as Fresh Today - a sale link shared into a county Facebook
// group (the US-12 corridor weekend is the point). Sale ids are nanoid strings.
const SALE_PATTERN = /^\/sales\/sale\/([\w-]+)$/;

// ─── Pop-Ups vendor-page crawler bypass + OG meta ────────────────────────────
// Same growth rail, but fans share the VENDOR (their whole schedule), not one
// stop - the vendor page is the shareable object (POP-UPS-BUILD-PLAN.md §6.1).
// Vendor ids are nanoid strings.
const POPUP_VENDOR_PATTERN = /^\/popups\/vendor\/([\w-]+)$/;
// The board itself (not a specific vendor) - exact path only, so it never
// swallows /popups/vendor/:id or /popups/mine.
const POPUP_BOARD_PATTERN = /^\/popups\/?$/;
// Static illustrated banner (uploaded to SITE_ASSETS at og/popups-social-banner.jpg) -
// used for the board's own share preview, and as the fallback image for any
// vendor page that hasn't uploaded its own photo. Mirrors krowdkraft-exchange's
// exchange-offer-fallback.jpg pattern exactly.
const POPUPS_BANNER_PATH = '/site-assets/og/popups-social-banner.jpg';

// Cloudflare computes this from more than just the client-sent User-Agent
// (confirmed empirically 2026-07-20 by pointing Facebook's real Sharing
// Debugger crawler at a live test endpoint and inspecting request.cf) - it is
// NOT the same as request.cf.botManagement.verifiedBot, which stays false on
// this account's Cloudflare plan even for a genuine Facebook crawler hit.
// "Page Preview" is the category Facebook, Slack, Twitter, iMessage, etc.
// share - it is not Facebook-exclusive, which is fine here since the only
// thing this unlocks is a read-only preview of a stand someone already chose
// to make shareable, for any of those platforms' preview fetchers. Mirrors
// field-notes/functions/_middleware.ts isPagePreviewCrawler exactly.
function isPagePreviewCrawler(request: Request): boolean {
  const cf = (request as unknown as { cf?: { verifiedBotCategory?: string } }).cf;
  return cf?.verifiedBotCategory === 'Page Preview';
}

function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}

interface FreshStandMeta {
  name: string;
  latestPostBody: string | null;
  photoUrl: string | null;
}

// Never surface a hidden/removed stand's real content to a crawler - falls
// back to the generic tenant copy exactly like a deleted or never-existed
// stand. Same public-visibility filter as the public API (getFreshStand in
// src/handlers/fresh.ts): deleted_at IS NULL AND is_hidden = 0 AND
// admin_hidden = 0.
async function resolveFreshStandMeta(
  id: string,
  tenantSlug: string,
  env: Env,
): Promise<FreshStandMeta | null> {
  try {
    const stand = await env.DB.prepare(
      'SELECT name, photo_url FROM fresh_stands WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0'
    ).bind(id, tenantSlug).first<{ name: string; photo_url: string | null }>();
    if (!stand) return null;

    const post = await env.DB.prepare(
      'SELECT body FROM fresh_posts WHERE stand_id = ? AND is_active = 1 AND admin_hidden = 0 AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 1'
    ).bind(id).first<{ body: string }>();

    return {
      name: stand.name,
      latestPostBody: post?.body ?? null,
      photoUrl: stand.photo_url || null,
    };
  } catch {
    return null;
  }
}

interface SaleMeta {
  title: string;
  body: string;
  firstDate: string;
  photoUrl: string | null;
}

// Never surface a hidden/removed/ended sale's real content to a crawler -
// falls back to the generic tenant copy exactly like a deleted or
// never-existed sale. Same public-visibility filter as the public API
// (getSale in src/handlers/sales.ts): deleted_at IS NULL AND is_hidden = 0
// AND admin_hidden = 0 AND last_date >= today.
async function resolveSaleMeta(
  id: string,
  tenantSlug: string,
  env: Env,
): Promise<SaleMeta | null> {
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const sale = await env.DB.prepare(
      'SELECT title, body, first_date, photo_url FROM sales WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0 AND last_date >= ?'
    ).bind(id, tenantSlug, today).first<{ title: string; body: string; first_date: string; photo_url: string | null }>();
    if (!sale) return null;

    return {
      title: sale.title,
      body: sale.body,
      firstDate: sale.first_date,
      photoUrl: sale.photo_url || null,
    };
  } catch {
    return null;
  }
}

interface PopupVendorMeta {
  name: string;
  description: string | null;
  photoUrl: string | null;
  nextStop: { date: string; open: string; close: string; locationBit: string | null } | null;
}

// Never surface a hidden/removed vendor's real content to a crawler - falls
// back to the generic tenant copy exactly like a deleted or never-existed
// vendor. Same public-visibility filter as the public API (getVendor in
// src/handlers/popups.ts): deleted_at IS NULL AND is_hidden = 0 AND
// admin_hidden = 0. The "next stop" teaser looks only at the soonest
// non-cancelled upcoming stop - a cancelled stop would misrepresent the plan
// to someone who's never seen the board before.
async function resolvePopupVendorMeta(
  id: string,
  tenantSlug: string,
  env: Env,
): Promise<PopupVendorMeta | null> {
  try {
    const vendor = await env.DB.prepare(
      'SELECT name, description, photo_url FROM popup_vendors WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0'
    ).bind(id, tenantSlug).first<{ name: string; description: string | null; photo_url: string | null }>();
    if (!vendor) return null;

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const stop = await env.DB.prepare(`
      SELECT date, open, close, location_hint, nearest_city FROM popup_stops
      WHERE vendor_id = ? AND deleted_at IS NULL AND admin_hidden = 0 AND cancelled_at IS NULL AND date >= ?
      ORDER BY date ASC, open ASC LIMIT 1
    `).bind(id, today).first<{ date: string; open: string; close: string; location_hint: string | null; nearest_city: string | null }>();

    return {
      name: vendor.name,
      description: vendor.description,
      photoUrl: vendor.photo_url || null,
      nextStop: stop
        ? { date: stop.date, open: stop.open, close: stop.close, locationBit: stop.location_hint || stop.nearest_city }
        : null,
    };
  } catch {
    return null;
  }
}

// 'HH:MM' -> '8' or '1:30' - the compact, no-AM/PM hour used only in the
// Pop-Ups OG description's terse next-stop teaser ("8 to 1"), distinct from
// the app's usual clockLabel-style "8 AM" formatting used everywhere a
// visitor actually reads the time on-page.
function compactHour(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return mStr === '00' ? `${h12}` : `${h12}:${mStr}`;
}

// 'YYYY-MM-DD' -> 'Sat Aug 8' for the share-card description's date line.
// Anchored to UTC throughout (a pure calendar date, no wall-clock component)
// so the weekday never shifts with the reader's or server's timezone.
function friendlyDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const APPS_HUB_URL = 'https://apps.lakeandlocals.com';

// Short-lived front-door pass minted for a valid event-plaque scan (6 hours) so a
// non-region-verified passer-by can use the app for the rest of their visit.
const EVENT_BYPASS_TTL_DAYS = 6 / 24;

const REGIONAL_DOMAINS: Record<string, string> = {
  'exchange.lakeandlocals.com': 'lake-locals',
  'lakeandlocals.com':          'lake-locals',
};

// ─── Tenant meta lookup ───────────────────────────────────────────────────────

interface TenantMeta {
  brandName:   string;
  creditsName: string;
  siteUrl:     string;
}

async function resolveTenantMeta(hostname: string, env: Env): Promise<TenantMeta> {
  const tenantSlug = REGIONAL_DOMAINS[hostname] ?? 'lake-locals';
  const defaults: TenantMeta = {
    brandName:   'Lake & Locals',
    creditsName: 'KrowdKredits',
    siteUrl:     `https://${hostname}`,
  };
  try {
    const row = await env.DB.prepare(
      'SELECT config FROM tenants WHERE id = ?'
    ).bind(tenantSlug).first<{ config: string }>();
    if (!row?.config) return defaults;
    const cfg = JSON.parse(row.config) as Record<string, string>;
    return {
      brandName:   cfg.brand_name   ?? defaults.brandName,
      creditsName: cfg.credits_name ?? defaults.creditsName,
      siteUrl:     defaults.siteUrl,
    };
  } catch {
    return defaults;
  }
}

// ─── Shared HTML helpers ──────────────────────────────────────────────────────

function logoHtml(brandName: string): string {
  // Split on & to colorize the ampersand in amber (matches Topbar treatment)
  const parts  = brandName.split('&');
  const nameHtml = parts.length > 1
    ? parts.map(p => p.trim()).join(' <span style="color:#c8860a">&amp;</span> ')
    : brandName;
  return `
    <div style="text-align:center;margin-bottom:32px">
      <div style="font-family:Georgia,serif;font-size:1.5rem;font-weight:bold;color:#1e3320;line-height:1.2">
        ${nameHtml}
      </div>
      <div style="font-family:Georgia,serif;font-size:0.72rem;color:#507850;letter-spacing:0.08em;text-transform:uppercase;margin-top:3px">
        Passport
      </div>
    </div>`;
}

function pageShell(brandName: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
  <title>${brandName} Passport</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:Georgia,'Times New Roman',serif;
      background:#f4f1ea;color:#1e3320;
      min-height:100vh;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      padding:32px 16px;
    }
    .card{
      background:#fff;border:1px solid #ddd8cc;
      border-radius:12px;padding:36px 32px;
      max-width:480px;width:100%;
      text-align:center;
    }
    h1{font-size:1.15rem;font-weight:bold;margin-bottom:14px;line-height:1.4}
    p{font-family:system-ui,-apple-system,sans-serif;font-size:0.92rem;
      color:#555;line-height:1.65;margin-bottom:12px}
    .form-group{margin-bottom:14px;text-align:left}
    label{display:block;font-family:system-ui,sans-serif;font-size:0.82rem;
      font-weight:600;color:#1e3320;margin-bottom:5px}
    input{width:100%;padding:10px 12px;border:1px solid #ddd8cc;
      border-radius:8px;font-size:0.92rem;font-family:system-ui,sans-serif;
      color:#1e3320;background:#fff;outline:none}
    input:focus{border-color:#c8860a;box-shadow:0 0 0 3px rgba(200,134,10,0.12)}
    .btn{display:block;width:100%;padding:12px;background:#1e3320;color:#f4f1ea;
      border:none;border-radius:8px;font-family:system-ui,sans-serif;
      font-size:0.92rem;font-weight:600;cursor:pointer;margin-top:8px;
      transition:background 0.15s}
    .btn:hover{background:#2d4d32}
    .btn:disabled{opacity:0.6;cursor:not-allowed}
    .msg{display:none;padding:10px 14px;border-radius:8px;
      font-family:system-ui,sans-serif;font-size:0.87rem;margin-top:12px}
    .msg-success{background:rgba(42,106,42,0.1);color:#2a6a2a;border:1px solid rgba(42,106,42,0.25)}
    .msg-error{background:rgba(176,0,0,0.08);color:#b00000;border:1px solid rgba(176,0,0,0.2)}
    .powered{font-family:system-ui,sans-serif;font-size:0.68rem;
      color:#aaa;margin-top:28px;text-align:center}
  </style>
</head>
<body>
  ${bodyContent}
  <p class="powered">Powered by KrowdKraft</p>
</body>
</html>`;
}

// ─── Geo-gate page: no valid trust token ─────────────────────────────────────
// Directs the visitor to the apps hub to complete location verification.
// The hub runs browser geolocation and issues the kk_geo_trust cookie that
// will let them back in here on the next visit.

function geoGatePage(brandName: string): Response {
  const body = `
    <div class="card">
      ${logoHtml(brandName)}
      <h1>Location Verification Required</h1>
      <p>
        The ${brandName} Passport is available to members of the Tri-State
        Lakes Region — northeast Indiana, south-central Michigan, and
        northwest Ohio.
      </p>
      <p>
        Please verify your location through the apps hub to continue.
        Existing members traveling outside the region can sign in there as well.
      </p>
      <a href="${APPS_HUB_URL}" class="btn" style="display:block;text-align:center;text-decoration:none;margin-top:8px">
        Verify My Location
      </a>
    </div>`;
  return new Response(pageShell(brandName, body), {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-cache',
    },
  });
}

// ─── Main middleware ──────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env & { GEO_TOKEN_SECRET: string }> = async (context) => {
  const url      = new URL(context.request.url);
  const hostname = url.hostname;

  // API requests and static assets always pass through.
  // Static assets (/assets/*, /site-assets/*) must bypass the geo-gate so the
  // browser can load CSS and JS regardless of cookie state. Without this, a
  // missing or expired kk_geo_trust cookie causes the middleware to return the
  // geo-gate HTML page as the stylesheet, breaking all styles.
  const isApiRequest    = url.pathname.startsWith('/api/');
  const isStaticAsset   = url.pathname.startsWith('/assets/');
  const isSiteAsset     = url.pathname.startsWith('/site-assets/');
  const freshStandMatch = url.pathname.match(FRESH_STAND_PATTERN);
  const saleMatch       = url.pathname.match(SALE_PATTERN);
  const popupVendorMatch = url.pathname.match(POPUP_VENDOR_PATTERN);
  const popupBoardMatch = url.pathname.match(POPUP_BOARD_PATTERN);
  let verifiedPayload: GeoTokenPayload | null = null;
  let mintEventBypass = false;

  if (!isApiRequest && !isStaticAsset && !isSiteAsset) {
    // Geo-gate: verify the kk_geo_trust cookie before serving the SPA.
    // Token is a HMAC-SHA256 signed JWT issued by kk-apps-hub or kk-login after
    // browser geolocation confirms the user is inside the service region polygon,
    // or after a traveling-member OTP sign-in.
    const cookieHeader = context.request.headers.get('Cookie') ?? '';
    const rawGeoToken  = extractGeoToken(cookieHeader);
    let geoOk = false;

    if (rawGeoToken) {
      const payload = await verifyGeoToken(rawGeoToken, context.env.GEO_TOKEN_SECRET);
      if (payload) {
        geoOk = true;
        verifiedPayload = payload;
      }
    }

    if (!geoOk) {
      // A signed, active event-plaque scan opens the front door for a passer-by
      // who has no region-trust cookie; we mint a short-lived bypass below.
      if (await isActiveEventScan(url, context.env)) {
        mintEventBypass = true;
      } else if ((freshStandMatch || saleMatch || popupVendorMatch || popupBoardMatch) && isPagePreviewCrawler(context.request)) {
        // Narrow, read-only exception: a confirmed link-preview crawler
        // (Facebook, Slack, etc. - see isPagePreviewCrawler) fetching a
        // specific Fresh Today stand, Sale Day sale, or Pop-Ups vendor detail
        // page gets the real page (and its OG tags below) instead of the
        // gate, so a shared link previews correctly. This does not apply to
        // any other route, does not grant write access, and does not change
        // the gate for any real visitor - the geo-fence itself is unchanged.
        // Mirrors field-notes' crawlerPreviewAllowed exception for /story/:id
        // exactly.
      } else {
        return geoGatePage('Lake & Locals');
      }
    }
  }

  // Valid trust token (or API call) — proceed to the actual response
  const response = await context.next();

  // Hashed assets from an old deployment must 404, never fall back to the SPA
  // shell. Serving HTML as a .js response (with nosniff) blocks the module and
  // blanks the app for any browser holding a stale shell; a clean 404 lets the
  // client recover as soon as it revalidates the shell.
  if (isStaticAsset || isSiteAsset) {
    const assetType = response.headers.get('content-type') ?? '';
    if (assetType.includes('text/html')) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return response;
  }

  if (verifiedPayload && verifiedPayload.type === 'local_verified') {
    const secret = context.env.GEO_TOKEN_SECRET;
    const cookieDomain = context.env.COOKIE_DOMAIN || '.lakeandlocals.com';
    const newToken = await signGeoToken('local_verified', secret, 30);
    response.headers.append('Set-Cookie', geoTokenCookie(newToken, 30, cookieDomain));
  }

  // Event-plaque scan: issue a short-lived bypass so the visitor's whole session
  // works. geo_bypass tokens are never auto-renewed above, so they expire cleanly.
  if (mintEventBypass) {
    const secret = context.env.GEO_TOKEN_SECRET;
    const cookieDomain = context.env.COOKIE_DOMAIN || '.lakeandlocals.com';
    const bypassToken = await signGeoToken('geo_bypass', secret, EVENT_BYPASS_TTL_DAYS);
    response.headers.append('Set-Cookie', geoTokenCookie(bypassToken, EVENT_BYPASS_TTL_DAYS, cookieDomain));
  }

  // Only rewrite HTML (the SPA shell)
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return response;

  // The shell references hashed asset names that change on every deploy —
  // browsers must revalidate it each visit or they request dead assets and
  // the app goes blank.
  response.headers.set('Cache-Control', 'no-cache');

  // Rewrite OG / Twitter meta tags with tenant branding
  const { brandName } = await resolveTenantMeta(hostname, context.env);
  const exchangeName = `${brandName} Passport`;
  // og:url must be the actual page being previewed, not a fixed site root -
  // Facebook treats og:url as the canonical identity of the content and
  // collapses every page sharing the same og:url into one preview entry
  // (this exact class of bug was already found and fixed once on this
  // platform in the field-notes/Exchange share-card work - mirrored here).
  const canonicalUrl = `${url.origin}${url.pathname}`;
  let ogTitle       = `${exchangeName} — Explore Local Experiences & Scan Badges`;
  let ogDescription = `Explore local shops, dining, and scenic spots in northeast Indiana. Scan badges, check in at destinations, and support regional businesses.`;
  let ogImage: string | null = null;

  if (freshStandMatch) {
    const tenantSlug = REGIONAL_DOMAINS[hostname] ?? 'lake-locals';
    const stand = await resolveFreshStandMeta(freshStandMatch[1], tenantSlug, context.env);
    if (stand) {
      ogTitle = `${truncate(stand.name, 70)} - Fresh Today`;
      ogDescription = stand.latestPostBody
        ? truncate(stand.latestPostBody, 160)
        : "Local stand on Fresh Today - see what's out right now.";
      ogImage = stand.photoUrl;
    }
  }

  if (saleMatch) {
    const tenantSlug = REGIONAL_DOMAINS[hostname] ?? 'lake-locals';
    const sale = await resolveSaleMeta(saleMatch[1], tenantSlug, context.env);
    if (sale) {
      ogTitle = `${truncate(sale.title, 70)} - Sale Day`;
      ogDescription = truncate(`${friendlyDateLabel(sale.firstDate)} - ${sale.body}`, 160);
      ogImage = sale.photoUrl;
    }
  }

  if (popupBoardMatch) {
    ogTitle = 'Pop-Ups - Lake & Locals';
    ogDescription = "Food trucks, pop-up shops and traveling vendors - where they are today, and where they'll be next.";
    ogImage = `${url.origin}${POPUPS_BANNER_PATH}`;
  }

  if (popupVendorMatch) {
    const tenantSlug = REGIONAL_DOMAINS[hostname] ?? 'lake-locals';
    const vendor = await resolvePopupVendorMeta(popupVendorMatch[1], tenantSlug, context.env);
    if (vendor) {
      ogTitle = `${truncate(vendor.name, 70)} - Pop-Ups`;
      const nextStopLine = vendor.nextStop
        ? `${friendlyDateLabel(vendor.nextStop.date)}: ${vendor.nextStop.locationBit ? vendor.nextStop.locationBit + ', ' : ''}${compactHour(vendor.nextStop.open)} to ${compactHour(vendor.nextStop.close)}`
        : null;
      ogDescription = truncate(
        nextStopLine
          ? (vendor.description ? `${nextStopLine} - ${vendor.description}` : nextStopLine)
          : 'On the road in the Lakes Region - schedule on Pop-Ups.',
        160,
      );
      // No uploaded vendor photo - the illustrated board banner stands in,
      // same fallback contract as krowdkraft-exchange's offer share cards.
      ogImage = vendor.photoUrl ?? `${url.origin}${POPUPS_BANNER_PATH}`;
    }
  }

  const rewriter = new HTMLRewriter()
    .on('title', {
      element(el) { el.setInnerContent(exchangeName); },
    })
    .on('meta[property="og:site_name"]', {
      element(el) { el.setAttribute('content', exchangeName); },
    })
    .on('meta[property="og:title"]', {
      element(el) { el.setAttribute('content', ogTitle); },
    })
    .on('meta[property="og:description"]', {
      element(el) { el.setAttribute('content', ogDescription); },
    })
    .on('meta[property="og:url"]', {
      element(el) { el.setAttribute('content', canonicalUrl); },
    })
    .on('meta[name="twitter:title"]', {
      element(el) { el.setAttribute('content', ogTitle); },
    })
    .on('meta[name="twitter:description"]', {
      element(el) { el.setAttribute('content', ogDescription); },
    });

  if (ogImage) {
    // The banner is a known, fixed 1200x630 asset - declare its dimensions so
    // Facebook doesn't have to infer them on first fetch (the warning our own
    // Sharing Debugger walk surfaced). Real uploaded vendor/stand/sale photos
    // have no guaranteed size, so this only applies to the banner itself.
    const isBanner = ogImage.endsWith(POPUPS_BANNER_PATH);
    rewriter
      .on('meta[property="og:image"]', {
        element(el) {
          el.setAttribute('content', ogImage as string);
          if (isBanner) {
            el.after('<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />', { html: true });
          }
        },
      })
      .on('meta[name="twitter:image"]', {
        element(el) { el.setAttribute('content', ogImage as string); },
      });
  } else {
    // No real photo for this page - drop the empty placeholder tags rather
    // than let Facebook try to fetch an empty image URL (mirrors field-notes).
    rewriter
      .on('meta[property="og:image"]', {
        element(el) { el.remove(); },
      })
      .on('meta[name="twitter:image"]', {
        element(el) { el.remove(); },
      });
  }

  return rewriter.transform(response);
};
