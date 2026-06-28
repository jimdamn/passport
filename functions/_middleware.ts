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
  const isApiRequest   = url.pathname.startsWith('/api/');
  const isStaticAsset  = url.pathname.startsWith('/assets/');
  const isSiteAsset    = url.pathname.startsWith('/site-assets/');
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
  const { brandName, siteUrl } = await resolveTenantMeta(hostname, context.env);
  const exchangeName  = `${brandName} Passport`;
  const ogTitle       = `${exchangeName} — Explore Local Experiences & Scan Badges`;
  const ogDescription = `Explore local shops, dining, and scenic spots in northeast Indiana. Scan badges, check in at destinations, and support regional businesses.`;

  return new HTMLRewriter()
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
      element(el) { el.setAttribute('content', siteUrl); },
    })
    .on('meta[name="twitter:title"]', {
      element(el) { el.setAttribute('content', exchangeName); },
    })
    .on('meta[name="twitter:description"]', {
      element(el) { el.setAttribute('content', ogDescription); },
    })
    .transform(response);
};
