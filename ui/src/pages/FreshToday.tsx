import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listFresh, listFreshStands, listFreshSeasons, categoryLabel, standLocation, FRESH_CATEGORIES, REGION_CENTER,
  type FreshFeedPost, type FreshStandPin,
} from '../api/fresh';
import { Sprout, List, Map as MapIcon, Phone, MapPin, Navigation } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui';

// Fresh Today's public browse board. Follows the Happenings design language
// exactly: serif header with an inline icon, calm chip rows for filters,
// white cards with a 4px green left accent, centered spinner, calm empty
// state, 800px column. See kk-shared-ui/DESIGN-LANGUAGE.md.

function postedAt(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

// Distance is a filter, never a sort - matches Explore.tsx/Happenings.tsx
// exactly. Value set is the user's own profile preference options (10/25/
// 50/100 mi), NOT Explore's 5/15/30 set - the point is honoring the user's
// actual home_distance_preference, not just visually resembling Explore.
// "Any" (0) is the same 0 = no-filter sentinel Explore/Happenings use.
const RADIUS_OPTIONS = [
  { mi: 10, label: '10 mi' },
  { mi: 25, label: '25 mi' },
  { mi: 50, label: '50 mi' },
  { mi: 100, label: '100 mi' },
  { mi: 0, label: 'Any' },
];

// Local copy of Explore.tsx's Haversine helper - this codebase duplicates
// small helpers per-file rather than sharing them (see fresh.ts's own
// per-file constant comments for the same convention).
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function FreshToday() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<FreshFeedPost[]>([]);
  const [stands, setStands] = useState<FreshStandPin[]>([]);
  const [seasonLine, setSeasonLine] = useState<string>('');
  const [filter, setFilter] = useState<string>('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Distance filter. Radius defaults from the user's saved profile preference
  // (10/25/50/100) the first time it loads, else "Any" (0) - exactly like
  // today for guests and profiles with no home zip, no special-casing needed.
  const [radius, setRadius] = useState(0);
  const [radiusTouched, setRadiusTouched] = useState(false);

  useEffect(() => {
    if (radiusTouched) return;
    if (user?.home_distance_preference != null) {
      setRadius(user.home_distance_preference);
    }
  }, [user, radiusTouched]);

  // "Near me" - real GPS coordinates from the device, same mechanics as
  // Explore.tsx's useMyLocation. This is the actual point of "near me" on a
  // phone: where the visitor physically is right now, not their saved home
  // zip. Live location, when present, always wins over the home zip default.
  const [liveCoords, setLiveCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');

  const hasHomeCoords = user?.home_zip_lat != null && user?.home_zip_lon != null;

  const useMyLocation = () => {
    setGeoError('');
    if (!('geolocation' in navigator)) {
      setGeoError("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLiveCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setGeoError(
          hasHomeCoords
            ? 'Using your home area - allow location to use where you are now.'
            : "Couldn't get your location. Check your browser's location permission.",
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  const clearLocation = () => {
    setLiveCoords(null);
    setGeoError('');
  };

  // Origin for both the distance filter and the map center: live GPS location
  // when the visitor has used "Near me", else the user's saved home zip, else
  // the region center - unchanged from today for guests and anyone without a
  // home zip or live location. originLat/originLon are primitives so the
  // memoized `origin` object below only gets a new identity when the real
  // coordinates change, not on every unrelated re-render (RegionMap recenters
  // whenever the `center` prop's reference changes, so a fresh-object-every-
  // render here would snap the map back on every radius/category click).
  const hasOriginCoords = liveCoords != null || hasHomeCoords;
  const originLat = liveCoords?.lat ?? user?.home_zip_lat ?? REGION_CENTER.lat;
  const originLon = liveCoords?.lon ?? user?.home_zip_lon ?? REGION_CENTER.lon;
  const origin = useMemo(() => ({ lat: originLat, lon: originLon }), [originLat, originLon]);

  // Seasons and stand pins don't depend on the category filter - load once
  // per tenant, independent of the feed refetch below.
  useEffect(() => {
    if (!tenant) return;
    listFreshSeasons(tenant.id)
      .then(res => {
        const inSeason = (res.data || []).filter(s => s.in_season_now).map(s => s.item_name);
        setSeasonLine(inSeason.length ? `In season now: ${inSeason.join(', ')}` : '');
      })
      .catch(() => setSeasonLine(''));
    listFreshStands(tenant.id)
      .then(res => setStands(res.data || []))
      .catch(() => setStands([]));
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await listFresh(tenant.id, filter === 'all' ? undefined : filter);
        setPosts(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Fresh Today.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, filter]);

  const pins: RegionPin[] = useMemo(() => stands
    .filter(s => {
      if (!hasOriginCoords || radius <= 0) return true;
      return calculateDistance(originLat, originLon, s.lat, s.lon) <= radius;
    })
    .map(s => {
      const location = standLocation(s.nearest_city, s.nearest_state);
      const bodyLine = s.latest_body ? truncate(s.latest_body, 60) : 'Nothing posted today';
      return {
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        label: s.name,
        sublabel: location ? `${location} · ${bodyLine}` : bodyLine,
        href: `/fresh/stand/${s.id}`,
        kind: s.has_live_post ? 'amber' : 'green',
      };
    }), [stands, hasOriginCoords, originLat, originLon, radius]);

  // List view's distance filter - the same 0 = Any sentinel, applied against
  // each post's stand coordinates. Filter only: order is left exactly as the
  // API returned it, never re-sorted by distance.
  const visiblePosts = useMemo(() => posts.filter(p => {
    if (!hasOriginCoords || radius <= 0) return true;
    return calculateDistance(originLat, originLon, p.stand.lat, p.stand.lon) <= radius;
  }), [posts, hasOriginCoords, originLat, originLon, radius]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sprout size={22} style={{ color: 'var(--amber)' }} /> Fresh Today
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        What's out right now - farm stands, u-pick, eggs, and more.
      </p>

      {seasonLine && (
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>{seasonLine}</p>
      )}

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Category filter - calm chips, no counts or badges */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...FRESH_CATEGORIES].map(c => (
          <button key={c.key} onClick={() => setFilter(c.key)}
            className={`btn btn-sm ${filter === c.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Distance filter - same calm chip styling as the category row above.
          Filter only, never a sort. Applies to both List and Map views. */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 4, WebkitOverflowScrolling: 'touch' }}>
        {RADIUS_OPTIONS.map(r => (
          <button key={r.mi} onClick={() => { setRadius(r.mi); setRadiusTouched(true); }}
            className={`btn btn-sm ${radius === r.mi ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {r.label}
          </button>
        ))}
        <button onClick={useMyLocation} disabled={locating}
          className={`btn btn-sm ${liveCoords ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0 }}>
          <Navigation size={13} /> {locating ? 'Locating…' : 'Near me'}
        </button>
        {liveCoords && (
          <button onClick={clearLocation}
            className="btn btn-sm btn-secondary"
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            Clear
          </button>
        )}
      </div>
      {liveCoords && !geoError && (
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <MapPin size={12} style={{ color: 'var(--amber)' }} />
          Using your current location.
        </p>
      )}
      {!liveCoords && hasHomeCoords && !geoError && (
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Showing your home area - tap "Near me" to use where you are right now.
        </p>
      )}
      {geoError && (
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>{geoError}</p>
      )}

      {/* View toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setView('list')}
          className={`btn btn-sm ${view === 'list' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <List size={14} /> List
        </button>
        <button onClick={() => setView('map')}
          className={`btn btn-sm ${view === 'map' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <MapIcon size={14} /> Map
        </button>
      </div>

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : view === 'map' ? (
        <RegionMap pins={pins} center={origin} height="60vh" />
      ) : visiblePosts.length === 0 && posts.length > 0 ? (
        // There's something posted today - it's just outside the selected
        // radius. A distinct message from the true empty state below, so it
        // never implies nothing exists region-wide when something does.
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Sprout size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing within {radius} miles right now.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            Try a wider range, or choose Any to see the whole board.
          </p>
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Sprout size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing posted yet today.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Stands post in the morning as things come out of the field. Have something to sell?
            Set up your stand in a minute.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/fresh/mine')}>
            Set up your stand
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visiblePosts.map(p => (
            <div key={p.id} className="card" role="button" tabIndex={0}
              onClick={() => navigate(`/fresh/stand/${p.stand.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/fresh/stand/${p.stand.id}`); }}
              style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{p.stand.name}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {p.stand.categories.map(cat => (
                    <span key={cat} style={{
                      fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                      borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                      whiteSpace: 'nowrap',
                    }}>
                      {categoryLabel(cat)}
                    </span>
                  ))}
                </div>
              </div>

              {standLocation(p.stand.nearest_city, p.stand.nearest_state) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>
                  <MapPin size={12} style={{ color: 'var(--amber)' }} />
                  {standLocation(p.stand.nearest_city, p.stand.nearest_state)}
                </div>
              )}

              <p style={{ margin: '0 0 8px', fontSize: '1rem', color: 'var(--text)', lineHeight: 1.45 }}>{p.body}</p>

              {p.photo_url && (
                <img src={p.photo_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8, display: 'block' }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                  Posted {postedAt(p.created_at)}
                  {p.stand.address_hint ? ` · ${p.stand.address_hint}` : ''}
                </span>
                {p.stand.phone && (
                  <a href={`tel:${p.stand.phone.replace(/[^0-9+]/g, '')}`}
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
                    <Phone size={12} style={{ color: 'var(--amber)' }} /> {p.stand.phone}
                  </a>
                )}
              </div>

              {p.sold_out && (
                <div style={{ marginTop: 8 }}>
                  <Badge variant="amber">Sold out for today</Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
