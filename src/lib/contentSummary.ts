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

      const { results } = await env.DB.prepare(
        `SELECT id, body, admin_hidden, is_active, created_at FROM fresh_posts WHERE stand_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 5`
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
