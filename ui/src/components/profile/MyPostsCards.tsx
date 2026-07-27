import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Newspaper, ArrowLeftRight, Sprout, Signpost, Truck, UtensilsCrossed, PawPrint, Camera, AlertCircle, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getContentSummary } from '../../api/content';
import type { ContentSummary, ContentSummaryItem, ContentSummarySource } from '../../api/content';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';

const FIELD_NOTES_SUBMIT_URL = 'https://fieldnotes.lakeandlocals.com/submit';
const FIELD_NOTES_MY_STORIES_URL = 'https://fieldnotes.lakeandlocals.com/my-stories';
const EXCHANGE_NEW_OFFER_URL = 'https://exchange.lakeandlocals.com/offers/new';
const EXCHANGE_MY_POSTS_URL = 'https://exchange.lakeandlocals.com/me/posts';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function sourceTotal(source: ContentSummarySource): number {
  return Object.values(source.counts).reduce((a, b) => a + b, 0);
}

const EXCHANGE_STATUS_LABEL: Record<string, string> = {
  active: 'Active', pending: 'Awaiting trade', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired',
};

const STORY_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending review', needs_revision: 'Needs revision', published: 'Published', rejected: 'Rejected',
};

// Fresh Today's `recent` list mixes stand rows and post rows (see
// fetchFreshSummary in src/lib/contentSummary.ts), so `status` here is the
// union of both state machines: stand states (visible/paused/hidden_by_admin/
// removed) and post states (live/sold_out/expired/removed/hidden_by_admin) -
// not the smaller {live, paused, hidden} set a first guess might reach for.
const FRESH_STATUS_LABEL: Record<string, string> = {
  visible: 'Visible',
  paused: 'Paused',
  hidden_by_admin: 'Hidden by admin',
  removed: 'Removed',
  live: 'Live',
  sold_out: 'Sold out',
  expired: 'Ended',
};

const SALES_STATUS_LABEL: Record<string, string> = {
  live: 'Live',
  paused: 'Postponed',
  hidden: 'Hidden',
  ended: 'Ended',
  removed: 'Removed',
};

// fetchPopupsSummary's `recent` list mixes vendor rows and stop rows (see
// src/lib/contentSummary.ts), same reasoning as FRESH_STATUS_LABEL above.
const POPUPS_STATUS_LABEL: Record<string, string> = {
  visible: 'Live',
  off_road: 'Off the road',
  hidden_by_admin: 'Hidden by admin',
  removed: 'Removed',
  scheduled: 'Scheduled',
};

// fetchMealsSummary's `recent` list mixes kitchen rows and meal rows (see
// src/lib/contentSummary.ts), same reasoning as FRESH_STATUS_LABEL above.
const MEALS_STATUS_LABEL: Record<string, string> = {
  visible: 'Live',
  quiet: 'Quiet',
  hidden_by_admin: 'Hidden by admin',
  removed: 'Removed',
  scheduled: 'Scheduled',
};

// fetchPetsSummary's `recent` list carries Home Safe's own status vocabulary
// directly (looking/archived/home_safe/hidden_by_admin) rather than a
// generic live/paused/hidden set - see src/lib/contentSummary.ts.
const PETS_STATUS_LABEL: Record<string, string> = {
  looking: 'Looking',
  archived: 'Archived',
  home_safe: 'Home safe',
  hidden_by_admin: 'Hidden by admin',
};

const SPLASH_STATUS_LABEL: Record<string, string> = {
  submitted: 'Waiting',
  held: 'Deciding',
  licensed: 'Licensed',
  declined: 'Declined',
  removed: 'Removed',
};

// Positive/live outcomes across every source's status vocabulary - rendered
// sage so a good outcome (licensed, published, sold out) doesn't collapse
// visually into the same gray as a terminal one (cancelled, removed).
const POSITIVE_STATUSES = new Set([
  'active', 'published', 'completed', 'visible', 'live', 'sold_out', 'licensed', 'home_safe',
]);

function chipVariant(item: ContentSummaryItem): 'sage' | 'amber' | 'gray' {
  if (item.attention) return 'amber';
  return POSITIVE_STATUSES.has(item.status) ? 'sage' : 'gray';
}

function RecentRow({ item, statusLabels }: { item: ContentSummaryItem; statusLabels: Record<string, string> }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '8px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--green)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title}
        </div>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.75rem', color: 'var(--muted)' }}>
          {formatDate(item.created_at)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        <Badge variant={chipVariant(item)}>
          {statusLabels[item.status] ?? item.status}
        </Badge>
        {item.hidden && <Badge variant="gray">Hidden</Badge>}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  title,
  source,
  isLoading,
  groupFailed,
  onRetry,
  countLine,
  manageLabel,
  manageUrl,
  statusLabels,
}: {
  icon: LucideIcon;
  title: string;
  source: ContentSummarySource | undefined;
  isLoading: boolean;
  // The whole /me/content-summary request failed - a single line already
  // says so above the group, so each card just stays in a quiet shell state
  // rather than repeating the message eight times.
  groupFailed: boolean;
  onRetry: () => void;
  countLine: (source: ContentSummarySource) => string;
  manageLabel: string;
  manageUrl: string;
  statusLabels: Record<string, string>;
}) {
  // The group request can succeed (200) while this one source's own upstream
  // failed - `ok: false` on an otherwise-empty source. Render that as a
  // failure, not as "you haven't posted yet", with its own retry since it's
  // the only card affected.
  const sourceFailed = !groupFailed && !!source && !source.ok;

  return (
    <div className="card" style={{ marginBottom: 16, minHeight: 140 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={17} strokeWidth={2} color="var(--amber)" aria-hidden="true" /> {title}
      </h3>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
          <Spinner size="md" />
        </div>
      ) : groupFailed ? null : sourceFailed ? (
        <div>
          <p style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 10px',
          }}>
            <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> Couldn't load this right now.
          </p>
          <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">
            Retry
          </button>
        </div>
      ) : source ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
              {countLine(source)}
            </span>
            {source.attention_total > 0 && (
              <Badge variant="amber">{source.attention_total} need{source.attention_total === 1 ? 's' : ''} attention</Badge>
            )}
          </div>

          {source.recent.map(item => (
            <RecentRow key={item.id} item={item} statusLabels={statusLabels} />
          ))}

          <Link
            to={manageUrl}
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: 44,
              marginTop: 12, fontFamily: 'var(--font-sans)',
              fontSize: '0.85rem', fontWeight: 600, color: 'var(--green)',
            }}
          >
            {manageLabel} &rarr;
          </Link>
        </>
      ) : null}
    </div>
  );
}

// A zero-activity source collapses into one compact row here instead of its
// own ~140px empty card (Gate 8.1 - eight empty cards was ~1100px of "you
// haven't done anything yet" for a brand-new member). Donor: the My Stamps
// row on this same page (MyProfile.tsx) - icon, label, chevron, nothing new
// invented. minHeight is explicit rather than inherited from padding alone,
// so the 44px touch target holds regardless of font metrics.
function MoreRow({ icon: Icon, title, value, href }: { icon: LucideIcon; title: string; value: string; href: string }) {
  return (
    <Link
      to={href}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        minHeight: 44, padding: '8px 0', borderBottom: '1px solid var(--border)',
        color: 'var(--green)', textDecoration: 'none',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Icon size={16} strokeWidth={2} color="var(--sage)" aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: '0.88rem', fontWeight: 600 }}>{title}</span>
          <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: '0.75rem', color: 'var(--muted)' }}>{value}</span>
        </span>
      </span>
      <ChevronRight size={15} color="var(--muted)" style={{ flexShrink: 0 }} />
    </Link>
  );
}

interface SourceConfig {
  key: keyof ContentSummary;
  icon: LucideIcon;
  title: string;
  countLine: (s: ContentSummarySource) => string;
  manageLabel: string;
  manageUrl: string;
  statusLabels: Record<string, string>;
  collapsedTitle: string;
  collapsedValue: string;
  collapsedHref: string;
}

// Locked copy: Gate D mockup board, "Locked copy appendix" (approved
// 2026-07-27, https://claude.ai/code/artifact/f2ad12ea-33a4-4dc8-a2fb-60d1c736f900).
const SOURCES: SourceConfig[] = [
  {
    key: 'field_notes',
    icon: Newspaper,
    title: 'My Field Notes',
    countLine: s => {
      const total = sourceTotal(s);
      const published = s.counts.published ?? 0;
      return `${total} ${total === 1 ? 'story' : 'stories'} - ${published} published`;
    },
    manageLabel: 'Manage my stories',
    manageUrl: FIELD_NOTES_MY_STORIES_URL,
    statusLabels: STORY_STATUS_LABEL,
    collapsedTitle: 'Share a story',
    collapsedValue: 'Local-life stories, visible to the whole network',
    collapsedHref: FIELD_NOTES_SUBMIT_URL,
  },
  {
    key: 'exchange',
    icon: ArrowLeftRight,
    title: 'My Exchange Posts',
    countLine: s => {
      const total = sourceTotal(s);
      return `${total} ${total === 1 ? 'post' : 'posts'} - ${s.counts.active ?? 0} active`;
    },
    manageLabel: 'Manage my posts',
    manageUrl: EXCHANGE_MY_POSTS_URL,
    statusLabels: EXCHANGE_STATUS_LABEL,
    collapsedTitle: 'Post on the Exchange',
    collapsedValue: 'Trade skills and goods, no cash needed',
    collapsedHref: EXCHANGE_NEW_OFFER_URL,
  },
  {
    key: 'fresh',
    icon: Sprout,
    title: 'My Stand',
    countLine: s => {
      const stands = s.counts.stands ?? 0;
      const posts = s.counts.live_posts ?? 0;
      return `${stands} ${stands === 1 ? 'stand' : 'stands'} - ${posts} ${posts === 1 ? 'post' : 'posts'} live today`;
    },
    manageLabel: 'Manage my stand',
    manageUrl: '/fresh/mine',
    statusLabels: FRESH_STATUS_LABEL,
    collapsedTitle: 'Set up my stand',
    collapsedValue: "A page for what you're growing or making, on Fresh Today",
    collapsedHref: '/fresh/mine',
  },
  {
    key: 'sales',
    icon: Signpost,
    title: 'My Sales',
    countLine: s => {
      const total = s.counts.sales ?? 0;
      const onNow = s.counts.on_now ?? 0;
      return `${total} ${total === 1 ? 'sale' : 'sales'} · ${onNow} on now`;
    },
    manageLabel: 'Manage my sales',
    manageUrl: '/sales/mine',
    statusLabels: SALES_STATUS_LABEL,
    collapsedTitle: 'Post a sale',
    collapsedValue: 'List a yard, barn, or moving sale on Sale Day',
    collapsedHref: '/sales/mine',
  },
  {
    key: 'popups',
    icon: Truck,
    title: 'My Schedule',
    countLine: s => {
      const vendors = s.counts.vendors ?? 0;
      const upcoming = s.counts.upcoming_stops ?? 0;
      return `${vendors} ${vendors === 1 ? 'vendor' : 'vendors'} · ${upcoming} stop${upcoming === 1 ? '' : 's'} coming up`;
    },
    manageLabel: 'Manage my schedule',
    manageUrl: '/popups/mine',
    statusLabels: POPUPS_STATUS_LABEL,
    collapsedTitle: 'Set up my vendor page',
    collapsedValue: 'Where your truck or pop-up shop is, and when',
    collapsedHref: '/popups/mine',
  },
  {
    key: 'meals',
    icon: UtensilsCrossed,
    title: 'My Kitchen',
    countLine: s => {
      const kitchens = s.counts.kitchens ?? 0;
      const upcoming = s.counts.upcoming_meals ?? 0;
      return `${kitchens} ${kitchens === 1 ? 'kitchen' : 'kitchens'} · ${upcoming} meal${upcoming === 1 ? '' : 's'} coming up`;
    },
    manageLabel: 'Manage my kitchen',
    manageUrl: '/meals/mine',
    statusLabels: MEALS_STATUS_LABEL,
    collapsedTitle: 'Set up our kitchen',
    collapsedValue: 'Meals your kitchen is serving, posted to Community Table',
    collapsedHref: '/meals/mine',
  },
  {
    key: 'pets',
    icon: PawPrint,
    title: 'Home Safe',
    countLine: s => {
      const looking = s.counts.looking ?? 0;
      const homeSafe = s.counts.home_safe ?? 0;
      return `${looking} looking · ${homeSafe} home safe`;
    },
    manageLabel: 'Manage my posts',
    manageUrl: '/pets/mine',
    statusLabels: PETS_STATUS_LABEL,
    // Kept verbatim per Gate 8's plan - two reviewers independently called
    // this the right register for a break-glass feature. Do not "improve" it.
    collapsedTitle: 'Home Safe',
    collapsedValue: 'No posts yet - here if you ever need it.',
    collapsedHref: '/pets/mine',
  },
  {
    key: 'splash',
    icon: Camera,
    title: 'My Splash',
    countLine: s => {
      const total = s.counts.submissions ?? 0;
      const licensed = s.counts.licensed ?? 0;
      return `${total} ${total === 1 ? 'photo' : 'photos'} shared - ${licensed} licensed`;
    },
    manageLabel: 'Manage my splash',
    manageUrl: '/splash',
    statusLabels: SPLASH_STATUS_LABEL,
    collapsedTitle: 'Go to My Splash',
    collapsedValue: 'Share a photo when a business scans you in',
    collapsedHref: '/splash',
  },
];

export default function MyPostsCards({ tenantId }: { tenantId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['content-summary', tenantId],
    queryFn: () => getContentSummary(tenantId),
    staleTime: 60_000,
  });

  const summary = data?.data;

  const collapsedRows: SourceConfig[] = [];
  const fullCards: JSX.Element[] = [];

  for (const cfg of SOURCES) {
    const source = summary?.[cfg.key];
    // A source graduates to its own full card the first time it's used;
    // while loading, on a group failure, or on its own upstream failure it
    // also gets the full-card treatment (spinner / retry) rather than being
    // folded silently into the collapsed row.
    const isEmpty = !isLoading && !isError && !!source && source.ok && sourceTotal(source) === 0;
    if (isEmpty) {
      collapsedRows.push(cfg);
    } else {
      fullCards.push(
        <SummaryCard
          key={cfg.key}
          icon={cfg.icon}
          title={cfg.title}
          source={source}
          isLoading={isLoading}
          groupFailed={isError}
          onRetry={() => refetch()}
          countLine={cfg.countLine}
          manageLabel={cfg.manageLabel}
          manageUrl={cfg.manageUrl}
          statusLabels={cfg.statusLabels}
        />
      );
    }
  }

  return (
    <>
      {isError && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 10px',
          }}>
            <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> Couldn't load your posts and stories right now.
          </p>
          <button type="button" onClick={() => refetch()} className="btn btn-secondary btn-sm">
            Retry
          </button>
        </div>
      )}

      {fullCards}

      {collapsedRows.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold' }}>
            More you can do here
          </h3>
          {collapsedRows.map(row => (
            <MoreRow
              key={row.key}
              icon={row.icon}
              title={row.collapsedTitle}
              value={row.collapsedValue}
              href={row.collapsedHref}
            />
          ))}
        </div>
      )}
    </>
  );
}
