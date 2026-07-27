import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Newspaper, ArrowLeftRight, Sprout, Signpost, Truck, UtensilsCrossed, PawPrint, Camera, AlertCircle } from 'lucide-react';
import { getContentSummary } from '../../api/content';
import type { ContentSummaryItem, ContentSummarySource } from '../../api/content';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';

const EXCHANGE_MY_POSTS_URL = 'https://exchange.lakeandlocals.com/me/posts';
const FIELD_NOTES_MY_STORIES_URL = 'https://fieldnotes.lakeandlocals.com/my-stories';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  emptyLine,
  emptyCtaLabel,
  emptyCtaUrl,
  statusLabels,
}: {
  icon: typeof Newspaper;
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
  emptyLine: string;
  emptyCtaLabel: string;
  emptyCtaUrl: string;
  statusLabels: Record<string, string>;
}) {
  const total = source ? Object.values(source.counts).reduce((a, b) => a + b, 0) : 0;
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
      ) : source && total === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px 8px' }}>
          <Icon size={26} strokeWidth={1.5} color="var(--amber)" style={{ marginBottom: 8 }} aria-hidden="true" />
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 4 }}>
            {emptyLine}
          </p>
          <Link
            to={emptyCtaUrl}
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: 44,
              fontFamily: 'var(--font-sans)', fontSize: '0.85rem', fontWeight: 600,
            }}
          >
            {emptyCtaLabel}
          </Link>
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

export default function MyPostsCards({ tenantId }: { tenantId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['content-summary', tenantId],
    queryFn: () => getContentSummary(tenantId),
    staleTime: 60_000,
  });

  const summary = data?.data;

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

      <SummaryCard
        icon={Newspaper}
        title="My Field Notes"
        source={summary?.field_notes}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
          const published = s.counts.published ?? 0;
          return `${total} ${total === 1 ? 'story' : 'stories'} - ${published} published`;
        }}
        manageLabel="Manage my stories"
        manageUrl={FIELD_NOTES_MY_STORIES_URL}
        emptyLine="You haven't shared a story yet."
        emptyCtaLabel="Share a story"
        emptyCtaUrl="https://fieldnotes.lakeandlocals.com/submit"
        statusLabels={STORY_STATUS_LABEL}
      />

      <SummaryCard
        icon={ArrowLeftRight}
        title="My Exchange Posts"
        source={summary?.exchange}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
          return `${total} ${total === 1 ? 'post' : 'posts'} - ${s.counts.active ?? 0} active`;
        }}
        manageLabel="Manage my posts"
        manageUrl={EXCHANGE_MY_POSTS_URL}
        emptyLine="You haven't posted on the Exchange yet."
        emptyCtaLabel="Post on the Exchange"
        emptyCtaUrl="https://exchange.lakeandlocals.com/offers/new"
        statusLabels={EXCHANGE_STATUS_LABEL}
      />

      <SummaryCard
        icon={Sprout}
        title="My Stand"
        source={summary?.fresh}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const stands = s.counts.stands ?? 0;
          const posts = s.counts.live_posts ?? 0;
          return `${stands} ${stands === 1 ? 'stand' : 'stands'} - ${posts} ${posts === 1 ? 'post' : 'posts'} live today`;
        }}
        manageLabel="Manage my stand"
        manageUrl="/fresh/mine"
        emptyLine="No stand yet - takes a minute to set up."
        emptyCtaLabel="Set up my stand"
        emptyCtaUrl="/fresh/mine"
        statusLabels={FRESH_STATUS_LABEL}
      />

      <SummaryCard
        icon={Signpost}
        title="My Sales"
        source={summary?.sales}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const total = s.counts.sales ?? 0;
          const onNow = s.counts.on_now ?? 0;
          return `${total} ${total === 1 ? 'sale' : 'sales'} · ${onNow} on now`;
        }}
        manageLabel="Manage my sales"
        manageUrl="/sales/mine"
        emptyLine="No sales yet - takes about a minute to post one."
        emptyCtaLabel="Post a sale"
        emptyCtaUrl="/sales/mine"
        statusLabels={SALES_STATUS_LABEL}
      />

      <SummaryCard
        icon={Truck}
        title="My Schedule"
        source={summary?.popups}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const vendors = s.counts.vendors ?? 0;
          const upcoming = s.counts.upcoming_stops ?? 0;
          return `${vendors} ${vendors === 1 ? 'vendor' : 'vendors'} · ${upcoming} stop${upcoming === 1 ? '' : 's'} coming up`;
        }}
        manageLabel="Manage my schedule"
        manageUrl="/popups/mine"
        emptyLine="No vendor page yet - takes about a minute to set up."
        emptyCtaLabel="Set up my vendor page"
        emptyCtaUrl="/popups/mine"
        statusLabels={POPUPS_STATUS_LABEL}
      />

      <SummaryCard
        icon={UtensilsCrossed}
        title="My Kitchen"
        source={summary?.meals}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const kitchens = s.counts.kitchens ?? 0;
          const upcoming = s.counts.upcoming_meals ?? 0;
          return `${kitchens} ${kitchens === 1 ? 'kitchen' : 'kitchens'} · ${upcoming} meal${upcoming === 1 ? '' : 's'} coming up`;
        }}
        manageLabel="Manage my kitchen"
        manageUrl="/meals/mine"
        emptyLine="No kitchen yet - takes about a minute to set up."
        emptyCtaLabel="Set up our kitchen"
        emptyCtaUrl="/meals/mine"
        statusLabels={MEALS_STATUS_LABEL}
      />

      <SummaryCard
        icon={PawPrint}
        title="Home Safe"
        source={summary?.pets}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const looking = s.counts.looking ?? 0;
          const homeSafe = s.counts.home_safe ?? 0;
          return `${looking} looking · ${homeSafe} home safe`;
        }}
        manageLabel="Manage my posts"
        manageUrl="/pets/mine"
        emptyLine="No posts yet - here if you ever need it."
        emptyCtaLabel="Report a pet"
        emptyCtaUrl="/pets/mine"
        statusLabels={PETS_STATUS_LABEL}
      />

      <SummaryCard
        icon={Camera}
        title="My Splash"
        source={summary?.splash}
        isLoading={isLoading}
        groupFailed={isError}
        onRetry={() => refetch()}
        countLine={s => {
          const total = s.counts.submissions ?? 0;
          const licensed = s.counts.licensed ?? 0;
          return `${total} ${total === 1 ? 'photo' : 'photos'} shared - ${licensed} licensed`;
        }}
        manageLabel="Manage my splash"
        manageUrl="/splash"
        emptyLine="Scan a business's plaque, then share a photo with them."
        emptyCtaLabel="Go to My Splash"
        emptyCtaUrl="/splash"
        statusLabels={SPLASH_STATUS_LABEL}
      />
    </>
  );
}
