import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { RegionMap } from 'kk-shared-ui';
import { CalendarDays, ChevronRight, HeartHandshake, Maximize2, Sprout, Tag, type LucideIcon } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import LensRow from '../components/explore/LensRow';
import InterestChips from '../components/explore/InterestChips';
import PlacesLens from './explore/PlacesLens';
import {
  useLens, getAroundInterests, putAroundInterests, toggleInterest, fetchAroundBoardData,
  todayFeedForLens, pinsForLens, captionForLens,
  FEED_SECTION_LABEL, FEED_EMPTY_COPY, REGION_CENTER,
  type AroundInterests, type AroundBoardData, type TodayRow,
} from '../api/around';

// Around Town - the town board. A dated, living surface that opens on what
// each member cares about most: a lens row re-aims the whole page, a small
// static map postcard previews the full map room, and the feed below is a
// client-side merge of the modules' own existing public endpoints. See
// AROUND-TOWN-BUILD-PLAN.md - this file is Increment 3.

const POSTCARD_PIN_CAP = 150;

function timeBucket(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Morning,';
  if (h < 17) return 'Afternoon,';
  return 'Evening,';
}

function weekdayName(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

const SOURCE_ICON: Record<TodayRow['source'], LucideIcon> = {
  events: CalendarDays,
  fresh: Sprout,
  deals: Tag,
  hands: HeartHandshake,
};

function FeedRowCard({ row }: { row: TodayRow }) {
  const Icon = SOURCE_ICON[row.source];
  return (
    <Link
      to={row.href}
      className="card"
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14,
        background: 'var(--white)', borderLeft: '3px solid var(--green)',
        textDecoration: 'none', color: 'inherit',
      }}
    >
      <Icon size={14} color="var(--amber)" style={{ marginTop: 3, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.9rem', color: 'var(--green)' }}>{row.title}</p>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>{row.meta}</p>
      </div>
    </Link>
  );
}

function EmptyFeedCard({ lens }: { lens: string }) {
  const copy = FEED_EMPTY_COPY[lens];
  return (
    <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
      <p style={{ margin: copy.body ? '0 0 4px' : 0, fontSize: '0.9rem', color: 'var(--text)' }}>{copy.title}</p>
      {copy.body && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>{copy.body}</p>}
    </div>
  );
}

function InterestPickerCard({ tenantId, onSaved }: { tenantId: string; onSaved: (data: AroundInterests) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function save(picks: string[]) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await putAroundInterests(tenantId, picks);
      onSaved(res.data);
    } catch {
      setSaving(false); // leave the card up so they can retry
    }
  }

  return (
    <div className="card" style={{ borderLeft: '4px solid var(--amber)', marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--font-serif)', fontSize: '1.15rem', color: 'var(--green)' }}>
        This is your community.
      </h2>
      <p style={{ margin: '0 0 12px', fontSize: '0.88rem', color: 'var(--muted)' }}>
        What do you keep an eye on? Pick a few - we'll put them first.
      </p>
      <InterestChips value={selected} onToggle={slug => setSelected(prev => toggleInterest(prev, slug))} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          className="btn btn-amber"
          disabled={selected.length === 0 || saving}
          onClick={() => save(selected)}
          style={{ minHeight: 44 }}
        >
          That's me
        </button>
        <button
          type="button"
          onClick={() => save([])}
          disabled={saving}
          style={{ background: 'none', border: 'none', color: 'var(--amber)', fontSize: '0.85rem', cursor: 'pointer', padding: 0, minHeight: 44 }}
        >
          Just show me everything
        </button>
      </div>
      <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
        Change anytime from your profile.
      </p>
    </div>
  );
}

export default function Explore() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  // Interests: null = unknown yet (guest, or still loading for a signed-in
  // member). chosen_at === null is the picker signal - never shown to guests.
  const [interests, setInterests] = useState<AroundInterests | null>(null);

  useEffect(() => {
    if (!user || !tenant) { setInterests(null); return; }
    let cancelled = false;
    getAroundInterests(tenant.id)
      .then(res => { if (!cancelled) setInterests(res.data); })
      .catch(() => {
        // A transient failure shouldn't nag the member with the picker on
        // every load - treat it as "already chosen" (fail safe) and just
        // fall back to plain lens order until the next successful fetch.
        if (!cancelled) setInterests({ interests: [], chosen_at: 1 });
      });
    return () => { cancelled = true; };
  }, [user, tenant]);

  const picks = interests?.interests ?? [];
  const { activeLens, order, setLens } = useLens(picks);

  const [boardData, setBoardData] = useState<AroundBoardData | null>(null);
  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    fetchAroundBoardData(tenant.id).then(data => { if (!cancelled) setBoardData(data); });
    return () => { cancelled = true; };
  }, [tenant]);

  const firstName = user?.display_name?.trim().split(' ')[0];
  const dateLine = user?.home_zip_location
    ? `${weekdayName()} around ${user.home_zip_location}`
    : `${weekdayName()} in the Lakes Region`;

  const memberHome = user?.home_zip_lat != null && user?.home_zip_lon != null
    ? { lat: user.home_zip_lat, lon: user.home_zip_lon }
    : null;

  const postcardPins = boardData ? pinsForLens(activeLens, boardData, { cap: POSTCARD_PIN_CAP }) : [];
  const caption = boardData ? captionForLens(activeLens, boardData) : '';
  const { rows: feedRows, hasMore } = boardData
    ? todayFeedForLens(activeLens, boardData.todayRows)
    : { rows: [], hasMore: false };

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>

      {/* Greeting */}
      {user && firstName ? (
        <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
          {timeBucket()} {firstName}.
        </h1>
      ) : (
        <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
          Around Town
        </h1>
      )}
      <p style={{ margin: '0 0 16px', fontSize: '0.85rem', fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--sage)' }}>
        {dateLine}
      </p>

      {/* Lens row */}
      <div style={{ marginBottom: 16 }}>
        <LensRow order={order} activeLens={activeLens} onSelect={setLens} />
      </div>

      {/* First-visit interest picker - signed-in members with no picks yet */}
      {user && interests && interests.chosen_at === null && (
        <InterestPickerCard tenantId={tenant.id} onSaved={setInterests} />
      )}

      {/* Map postcard - static preview, never a scroll trap. Whole card is one
          tap target (a Link), so pan/zoom/pin taps live in the map room. */}
      <Link
        to="/explore/map"
        style={{ display: 'block', position: 'relative', marginBottom: 16, textDecoration: 'none' }}
      >
        <RegionMap
          interactive={false}
          height="140px"
          pins={postcardPins}
          center={memberHome ?? REGION_CENTER}
          zoom={memberHome ? 10 : 9}
        />
        <span style={{
          position: 'absolute', top: 8, right: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'var(--white)', color: 'var(--amber)', fontSize: '0.72rem', fontWeight: 700,
          padding: '4px 10px', borderRadius: 'var(--r-pill)', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}>
          <Maximize2 size={14} /> Open the map
        </span>
        {caption && (
          <span style={{
            position: 'absolute', bottom: 8, left: 8,
            background: 'rgba(255,255,255,0.92)', color: 'var(--green)', fontSize: '0.72rem', fontWeight: 600,
            padding: '4px 10px', borderRadius: 'var(--r-pill)',
          }}>
            {caption}
          </span>
        )}
      </Link>

      {/* Today feed - every lens but Places, which shows the directory instead */}
      {activeLens !== 'places' && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted)' }}>
            {FEED_SECTION_LABEL[activeLens]}
          </p>
          {!boardData ? (
            <div style={{ paddingTop: 24, textAlign: 'center' }}>
              <Spinner size="lg" />
            </div>
          ) : feedRows.length === 0 ? (
            <EmptyFeedCard lens={activeLens} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {feedRows.map(row => <FeedRowCard key={row.key} row={row} />)}
              {activeLens === 'everything' && hasMore && (
                <Link
                  to="/explore/map"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: 'var(--amber)', fontWeight: 600, minHeight: 44 }}
                >
                  Everything happening today <ChevronRight size={14} />
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quiet module links row - every lens */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, flexWrap: 'wrap', marginBottom: 16, fontSize: '0.85rem' }}>
        <Link to="/happenings" style={{ color: 'var(--amber)' }}>Happenings</Link>
        <span style={{ color: 'var(--muted)' }}>·</span>
        <Link to="/fresh" style={{ color: 'var(--amber)' }}>Fresh Today</Link>
        <span style={{ color: 'var(--muted)' }}>·</span>
        <Link to="/deals" style={{ color: 'var(--amber)' }}>Deals</Link>
        <span style={{ color: 'var(--muted)' }}>·</span>
        <Link to="/lend-a-hand" style={{ color: 'var(--amber)' }}>Lend a Hand</Link>
      </div>

      {/* Places lens - the member directory, intact */}
      {activeLens === 'places' && <PlacesLens />}
    </div>
  );
}
