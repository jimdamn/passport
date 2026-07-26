import type { Env } from '../types';

// Both Exchange and Field Notes are Cloudflare Pages projects, not Workers, so
// they can't be reached through a service binding — Passport calls them over
// public HTTPS, forwarding the caller's bearer token. Best-effort: either leg
// failing (timeout, network error, non-200) never breaks the profile page.
const DEFAULT_EXCHANGE_BASE_URL = 'https://exchange.lakeandlocals.com';
const DEFAULT_FIELD_NOTES_BASE_URL = 'https://fieldnotes.lakeandlocals.com';
const FETCH_TIMEOUT_MS = 3000;

export interface ContentSummaryItem {
  id: string | number;
  title: string;
  status: string;
  hidden: boolean;
  attention: boolean;
  created_at: number;
}

export interface ContentSummarySource {
  ok: boolean;
  counts: Record<string, number>;
  recent: ContentSummaryItem[];
  attention_total: number;
}

function emptySource(): ContentSummarySource {
  return { ok: false, counts: {}, recent: [], attention_total: 0 };
}

export async function fetchExchangeSummary(env: Env, tenantId: string, authHeader: string | null): Promise<ContentSummarySource> {
  if (!authHeader) return emptySource();
  const baseUrl = env.EXCHANGE_BASE_URL || DEFAULT_EXCHANGE_BASE_URL;
  try {
    const res = await fetch(
      `${baseUrl}/api/t/${encodeURIComponent(tenantId)}/me/offers`,
      { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return emptySource();
    const json = await res.json<{ data: any[] }>();
    const offers = json.data ?? [];

    // Bucketed for the profile card: active/hidden split on is_published
    // (orthogonal to status), pending trades called out, everything else
    // (completed/cancelled/expired) collapsed into "other".
    const counts: Record<string, number> = { active: 0, hidden: 0, awaiting_trade: 0, other: 0 };
    let nullZipCount = 0;
    let pendingInterestTotal = 0;
    for (const o of offers) {
      if (o.status === 'active' && o.is_published === 1) counts.active += 1;
      else if (o.status === 'active' && o.is_published === 0) counts.hidden += 1;
      else if (o.status === 'pending') counts.awaiting_trade += 1;
      else counts.other += 1;
      if (!o.zip_code) nullZipCount += 1;
      pendingInterestTotal += o.pending_interest_count ?? 0;
    }

    const recent: ContentSummaryItem[] = [...offers]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 3)
      .map(o => ({
        id: o.id,
        title: o.title,
        status: o.status,
        hidden: o.is_published === 0,
        attention: !o.zip_code || (o.pending_interest_count ?? 0) > 0,
        created_at: o.created_at,
      }));

    return { ok: true, counts, recent, attention_total: nullZipCount + pendingInterestTotal };
  } catch {
    return emptySource();
  }
}

/**
 * Fresh Today's content-summary source — unlike Exchange and Field Notes,
 * this is a LOCAL D1 query (Fresh Today lives in this same app), so there's
 * no HTTP round-trip or timeout dance. Counts stands + live posts for the
 * caller; recent = last 5 stands/posts by created_at; attention = admin-hidden.
 */
export async function fetchFreshSummary(env: Env, tenantId: string, kkauthUid: number | null): Promise<ContentSummarySource> {
  if (!kkauthUid) return emptySource();
  try {
    const { results: standResults } = await env.DB.prepare(
      'SELECT id, name, is_hidden, admin_hidden, deleted_at, created_at FROM fresh_stands WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
    ).bind(tenantId, kkauthUid).all<any>();
    const standRows = standResults || [];
    const liveStandIds = standRows.filter((s: any) => !s.deleted_at).map((s: any) => s.id);

    let livePosts = 0;
    let postRows: any[] = [];
    if (liveStandIds.length) {
      const placeholders = liveStandIds.map(() => '?').join(',');
      const live = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM fresh_posts WHERE stand_id IN (${placeholders}) AND is_active = 1 AND admin_hidden = 0 AND expires_at > unixepoch()`
      ).bind(...liveStandIds).first<{ n: number }>();
      livePosts = live?.n ?? 0;

      // Unsliced: attention_total below must count every admin-hidden post,
      // not just the ones that make the top-5 "recent" cut (mirrors the full-set
      // accumulation pattern in fetchExchangeSummary above). The final .slice(0, 5)
      // on `recent` still limits what's displayed.
      const { results } = await env.DB.prepare(
        `SELECT id, body, admin_hidden, is_active, created_at FROM fresh_posts WHERE stand_id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...liveStandIds).all<any>();
      postRows = results || [];
    }

    const recentStandItems: ContentSummaryItem[] = standRows.map((s: any) => ({
      id: s.id,
      title: s.name,
      status: s.deleted_at ? 'removed' : (s.admin_hidden ? 'hidden_by_admin' : (s.is_hidden ? 'paused' : 'visible')),
      hidden: !!s.is_hidden || !!s.admin_hidden,
      attention: !!s.admin_hidden,
      created_at: s.created_at,
    }));
    const recentPostItems: ContentSummaryItem[] = postRows.map((p: any) => ({
      id: p.id,
      title: (p.body || '').slice(0, 60),
      status: !p.is_active ? 'removed' : (p.admin_hidden ? 'hidden_by_admin' : 'live'),
      hidden: !p.is_active || !!p.admin_hidden,
      attention: !!p.admin_hidden,
      created_at: p.created_at,
    }));

    const recent = [...recentStandItems, ...recentPostItems]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 5);

    const attentionTotal =
      standRows.filter((s: any) => s.admin_hidden).length +
      postRows.filter((p: any) => p.admin_hidden).length;

    return {
      ok: true,
      counts: { stands: liveStandIds.length, live_posts: livePosts },
      recent,
      attention_total: attentionTotal,
    };
  } catch {
    return emptySource();
  }
}

/**
 * Sale Day's content-summary source - a LOCAL D1 query, same reasoning as
 * fetchFreshSummary above (this board lives in this same app). Counts total
 * sales + how many are on_now right now for the caller; recent = last 5 by
 * created_at; attention = admin-hidden. Status is computed with the same
 * board-TZ schedule logic as src/handlers/sales.ts's saleStatus() - copied
 * rather than imported since that file's pure helpers aren't exported for
 * cross-module reuse (mirrors this file's own per-source independence).
 */
export async function fetchSalesSummary(env: Env, tenantId: string, kkauthUid: number | null): Promise<ContentSummarySource> {
  if (!kkauthUid) return emptySource();
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, title, days, wrapped_date, is_hidden, admin_hidden, admin_hidden_reason, deleted_at, created_at FROM sales WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
    ).bind(tenantId, kkauthUid).all<any>();
    const rows = results || [];

    const BOARD_TZ = 'America/New_York';
    const now = Math.floor(Date.now() / 1000);

    function boardWallTimeToUnix(dateStr: string, timeStr: string): number {
      const naiveUtcMs = Date.parse(`${dateStr}T${timeStr}:00Z`);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: BOARD_TZ, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(naiveUtcMs));
      const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
      let hour = get('hour');
      if (hour === 24) hour = 0;
      const asBoardMs = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
      const offsetMs = naiveUtcMs - asBoardMs;
      return Math.floor((naiveUtcMs + offsetMs) / 1000);
    }
    function addDaysToDateStr(dateStr: string, days: number): string {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + days);
      return dt.toISOString().slice(0, 10);
    }
    function endOfBoardDay(dateStr: string): number {
      return boardWallTimeToUnix(addDaysToDateStr(dateStr, 1), '00:00');
    }
    function boardDateStr(): string {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: BOARD_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(now * 1000));
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
      return `${get('year')}-${get('month')}-${get('day')}`;
    }
    function isOnNow(days: { date: string; open: string; close: string }[], wrappedDate: string | null): boolean {
      const last = days[days.length - 1];
      if (now >= endOfBoardDay(last.date) || wrappedDate === last.date) return false;
      const today = boardDateStr();
      const day = days.find(d => d.date === today);
      if (!day) return false;
      if (wrappedDate === today) return false;
      const openAt = boardWallTimeToUnix(day.date, day.open);
      const closeAt = boardWallTimeToUnix(day.date, day.close);
      return now >= openAt && now <= closeAt;
    }
    function isEnded(days: { date: string; open: string; close: string }[], wrappedDate: string | null): boolean {
      const last = days[days.length - 1];
      return now >= endOfBoardDay(last.date) || wrappedDate === last.date;
    }

    let onNow = 0;
    const recent: ContentSummaryItem[] = rows.slice(0, 5).map((s: any) => {
      const days = JSON.parse(s.days || '[]');
      if (!s.deleted_at && !s.admin_hidden && !s.is_hidden && isOnNow(days, s.wrapped_date)) onNow += 1;
      const status = s.deleted_at ? 'removed' : (s.admin_hidden ? 'hidden' : (s.is_hidden ? 'paused' : (isEnded(days, s.wrapped_date) ? 'ended' : 'live')));
      return {
        id: s.id,
        title: s.title,
        status,
        hidden: !!s.is_hidden || !!s.admin_hidden,
        attention: !!s.admin_hidden,
        created_at: s.created_at,
      };
    });
    // on_now must be counted over every row, not just the top-5 "recent" cut.
    for (const s of rows.slice(5)) {
      if (s.deleted_at || s.admin_hidden || s.is_hidden) continue;
      const days = JSON.parse(s.days || '[]');
      if (isOnNow(days, s.wrapped_date)) onNow += 1;
    }

    const attentionTotal = rows.filter((s: any) => s.admin_hidden).length;

    return {
      ok: true,
      counts: { sales: rows.filter((s: any) => !s.deleted_at).length, on_now: onNow },
      recent,
      attention_total: attentionTotal,
    };
  } catch {
    return emptySource();
  }
}

/**
 * Pop-Ups' content-summary source - a LOCAL D1 query (this board lives in
 * this same app), same reasoning as fetchFreshSummary/fetchSalesSummary
 * above. Counts vendors + upcoming stops (not deleted, not cancelled, date
 * on or after today in board TZ) for the caller; recent = last 5
 * vendors/stops by created_at; attention = admin-hidden (vendor or stop).
 */
export async function fetchPopupsSummary(env: Env, tenantId: string, kkauthUid: number | null): Promise<ContentSummarySource> {
  if (!kkauthUid) return emptySource();
  try {
    const { results: vendorResults } = await env.DB.prepare(
      'SELECT id, name, is_hidden, admin_hidden, admin_hidden_reason, deleted_at, created_at FROM popup_vendors WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
    ).bind(tenantId, kkauthUid).all<any>();
    const vendorRows = vendorResults || [];
    const liveVendorIds = vendorRows.filter((v: any) => !v.deleted_at).map((v: any) => v.id);

    const BOARD_TZ = 'America/New_York';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TZ }).format(new Date());

    let upcomingStops = 0;
    let stopRows: any[] = [];
    if (liveVendorIds.length) {
      const placeholders = liveVendorIds.map(() => '?').join(',');
      const upcoming = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM popup_stops WHERE vendor_id IN (${placeholders}) AND deleted_at IS NULL AND cancelled_at IS NULL AND admin_hidden = 0 AND date >= ?`
      ).bind(...liveVendorIds, today).first<{ n: number }>();
      upcomingStops = upcoming?.n ?? 0;

      // Unsliced: attention_total below must count every admin-hidden stop,
      // not just the ones that make the top-5 "recent" cut.
      const { results } = await env.DB.prepare(
        `SELECT id, vendor_id, date, admin_hidden, admin_hidden_reason, deleted_at, created_at FROM popup_stops WHERE vendor_id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...liveVendorIds).all<any>();
      stopRows = results || [];
    }

    const vendorNameById = new Map(vendorRows.map((v: any) => [v.id, v.name]));

    const recentVendorItems: ContentSummaryItem[] = vendorRows.map((v: any) => ({
      id: v.id,
      title: v.name,
      status: v.deleted_at ? 'removed' : (v.admin_hidden ? 'hidden_by_admin' : (v.is_hidden ? 'off_road' : 'visible')),
      hidden: !!v.is_hidden || !!v.admin_hidden,
      attention: !!v.admin_hidden,
      created_at: v.created_at,
    }));
    const recentStopItems: ContentSummaryItem[] = stopRows.map((s: any) => ({
      id: s.id,
      title: `${vendorNameById.get(s.vendor_id) ?? 'A stop'} - ${s.date}`,
      status: s.deleted_at ? 'removed' : (s.admin_hidden ? 'hidden_by_admin' : 'scheduled'),
      hidden: !s.deleted_at ? !!s.admin_hidden : true,
      attention: !!s.admin_hidden,
      created_at: s.created_at,
    }));

    const recent = [...recentVendorItems, ...recentStopItems]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 5);

    const attentionTotal =
      vendorRows.filter((v: any) => v.admin_hidden).length +
      stopRows.filter((s: any) => s.admin_hidden).length;

    return {
      ok: true,
      counts: { vendors: liveVendorIds.length, upcoming_stops: upcomingStops },
      recent,
      attention_total: attentionTotal,
    };
  } catch {
    return emptySource();
  }
}

/**
 * Community Table's content-summary source - a LOCAL D1 query (this board
 * lives in this same app), same reasoning as fetchFreshSummary/
 * fetchSalesSummary/fetchPopupsSummary above. Counts kitchens + upcoming
 * meals (not deleted, not cancelled, date on or after today in board TZ) for
 * the caller; recent = last 5 kitchens/meals by created_at; attention =
 * admin-hidden (kitchen or meal).
 */
export async function fetchMealsSummary(env: Env, tenantId: string, kkauthUid: number | null): Promise<ContentSummarySource> {
  if (!kkauthUid) return emptySource();
  try {
    const { results: kitchenResults } = await env.DB.prepare(
      'SELECT id, name, is_hidden, admin_hidden, admin_hidden_reason, deleted_at, created_at FROM meal_kitchens WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
    ).bind(tenantId, kkauthUid).all<any>();
    const kitchenRows = kitchenResults || [];
    const liveKitchenIds = kitchenRows.filter((k: any) => !k.deleted_at).map((k: any) => k.id);

    const BOARD_TZ = 'America/New_York';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TZ }).format(new Date());

    let upcomingMeals = 0;
    let mealRows: any[] = [];
    if (liveKitchenIds.length) {
      const placeholders = liveKitchenIds.map(() => '?').join(',');
      const upcoming = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM meals WHERE kitchen_id IN (${placeholders}) AND deleted_at IS NULL AND cancelled_at IS NULL AND admin_hidden = 0 AND date >= ?`
      ).bind(...liveKitchenIds, today).first<{ n: number }>();
      upcomingMeals = upcoming?.n ?? 0;

      // Unsliced: attention_total below must count every admin-hidden meal,
      // not just the ones that make the top-5 "recent" cut.
      const { results } = await env.DB.prepare(
        `SELECT id, kitchen_id, title, date, admin_hidden, admin_hidden_reason, deleted_at, created_at FROM meals WHERE kitchen_id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...liveKitchenIds).all<any>();
      mealRows = results || [];
    }

    const kitchenNameById = new Map(kitchenRows.map((k: any) => [k.id, k.name]));

    const recentKitchenItems: ContentSummaryItem[] = kitchenRows.map((k: any) => ({
      id: k.id,
      title: k.name,
      status: k.deleted_at ? 'removed' : (k.admin_hidden ? 'hidden_by_admin' : (k.is_hidden ? 'quiet' : 'visible')),
      hidden: !!k.is_hidden || !!k.admin_hidden,
      attention: !!k.admin_hidden,
      created_at: k.created_at,
    }));
    const recentMealItems: ContentSummaryItem[] = mealRows.map((m: any) => ({
      id: m.id,
      title: `${kitchenNameById.get(m.kitchen_id) ?? 'A meal'} - ${m.title}`,
      status: m.deleted_at ? 'removed' : (m.admin_hidden ? 'hidden_by_admin' : 'scheduled'),
      hidden: !m.deleted_at ? !!m.admin_hidden : true,
      attention: !!m.admin_hidden,
      created_at: m.created_at,
    }));

    const recent = [...recentKitchenItems, ...recentMealItems]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 5);

    const attentionTotal =
      kitchenRows.filter((k: any) => k.admin_hidden).length +
      mealRows.filter((m: any) => m.admin_hidden).length;

    return {
      ok: true,
      counts: { kitchens: liveKitchenIds.length, upcoming_meals: upcomingMeals },
      recent,
      attention_total: attentionTotal,
    };
  } catch {
    return emptySource();
  }
}

/**
 * Home Safe's content-summary source - a LOCAL D1 query (this board lives in
 * this same app), same reasoning as fetchFreshSummary/fetchSalesSummary/
 * fetchPopupsSummary/fetchMealsSummary above. Excludes deleted posts (Home
 * Safe's own convention - removed posts drop out entirely, see pets.ts's
 * listMyPetPosts). Counts { looking, home_safe } for the caller; recent =
 * last 5 by created_at; attention = admin-hidden count. Status is computed
 * with the same petStatus() logic as src/handlers/pets.ts - copied rather
 * than imported since that file's pure helper isn't exported for cross-module
 * reuse (mirrors this file's own per-source independence).
 */
export async function fetchPetsSummary(env: Env, tenantId: string, kkauthUid: number | null): Promise<ContentSummarySource> {
  if (!kkauthUid) return emptySource();
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, type, species, pet_name, active_until, resolved_at, admin_hidden, admin_hidden_reason, created_at FROM pet_posts WHERE tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL ORDER BY created_at DESC'
    ).bind(tenantId, kkauthUid).all<any>();
    const rows = results || [];
    const now = Math.floor(Date.now() / 1000);

    function status(r: any): 'looking' | 'archived' | 'home_safe' {
      if (r.resolved_at) return 'home_safe';
      if (now >= r.active_until) return 'archived';
      return 'looking';
    }

    let looking = 0;
    let homeSafe = 0;
    for (const r of rows) {
      const s = status(r);
      if (s === 'looking') looking += 1;
      else if (s === 'home_safe') homeSafe += 1;
    }

    const recent: ContentSummaryItem[] = rows.slice(0, 5).map((r: any) => ({
      id: r.id,
      title: r.pet_name || r.species,
      status: r.admin_hidden ? 'hidden_by_admin' : status(r),
      hidden: !!r.admin_hidden,
      attention: !!r.admin_hidden,
      created_at: r.created_at,
    }));

    const attentionTotal = rows.filter((r: any) => r.admin_hidden).length;

    return {
      ok: true,
      counts: { looking, home_safe: homeSafe },
      recent,
      attention_total: attentionTotal,
    };
  } catch {
    return emptySource();
  }
}

export async function fetchFieldNotesSummary(env: Env, tenantId: string, authHeader: string | null): Promise<ContentSummarySource> {
  if (!authHeader) return emptySource();
  const baseUrl = env.FIELD_NOTES_BASE_URL || DEFAULT_FIELD_NOTES_BASE_URL;
  try {
    const res = await fetch(
      `${baseUrl}/api/t/${encodeURIComponent(tenantId)}/stories/my`,
      { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return emptySource();
    const json = await res.json<{ data: { stories: any[] } }>();
    const stories = json.data?.stories ?? [];

    const counts: Record<string, number> = {};
    let needsRevisionCount = 0;
    for (const s of stories) {
      counts[s.status] = (counts[s.status] ?? 0) + 1;
      if (s.status === 'needs_revision') needsRevisionCount += 1;
    }

    const recent: ContentSummaryItem[] = [...stories]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 3)
      .map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        hidden: s.hidden === 1,
        attention: s.status === 'needs_revision',
        created_at: s.created_at,
      }));

    return { ok: true, counts, recent, attention_total: needsRevisionCount };
  } catch {
    return emptySource();
  }
}

/**
 * Social Splash's content-summary source - a LOCAL D1 query (this board
 * lives in this same app, Increment 2). Counts total submissions plus how
 * many are currently held or licensed; recent = last 5 by created_at;
 * attention = admin-removed (admin_removed_reason set - a self-withdraw also
 * lands in status 'removed' but leaves that column NULL, so it never counts
 * as an attention item the way an actual admin action does).
 */
export async function fetchSplashSummary(env: Env, tenantId: string, kkauthUid: number | null): Promise<ContentSummarySource> {
  if (!kkauthUid) return emptySource();
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, business_name, status, admin_removed_reason, created_at FROM splash_submissions WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
    ).bind(tenantId, kkauthUid).all<any>();
    const rows = results || [];

    const counts: Record<string, number> = {
      submissions: rows.length,
      held: rows.filter((r: any) => r.status === 'held').length,
      licensed: rows.filter((r: any) => r.status === 'licensed').length,
    };

    const recent: ContentSummaryItem[] = rows.slice(0, 5).map((r: any) => ({
      id: r.id,
      title: r.business_name,
      status: r.status,
      hidden: false, // Social Splash content has no publish-visibility toggle - it's never public to begin with
      attention: !!r.admin_removed_reason,
      created_at: r.created_at,
    }));

    // Unsliced, same reasoning as every other local fetcher in this file.
    const attentionTotal = rows.filter((r: any) => r.admin_removed_reason).length;

    return { ok: true, counts, recent, attention_total: attentionTotal };
  } catch {
    return emptySource();
  }
}
