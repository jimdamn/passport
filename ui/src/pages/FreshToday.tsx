import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listFresh, listFreshStands, listFreshSeasons, categoryLabel, standLocation, FRESH_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type FreshFeedPost, type FreshStandPin,
} from '../api/fresh';
import { Sprout, List, Map as MapIcon, Phone, MapPin, Navigation } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui/map';

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

// Distance is a filter, never a sort. Same four values, same location
// control set, on every board module - matches Happenings.tsx exactly
// (kk-shared-ui/DESIGN-LANGUAGE.md §4, the platform's one location control
// set). Filtering happens server-side now (fresh.ts's parseNearby/
// DISTANCE_SQL), not client-side - so the nearest posts can never be cut
// off by the 200-row cap.
const RADIUS_OPTIONS = [
  { mi: 5, label: '5 mi' },
  { mi: 15, label: '15 mi' },
  { mi: 30, label: '30 mi' },
  { mi: 0, label: 'Any' },
];

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

  // Location filtering - copied from Happenings.tsx verbatim (coords/source/
  // radius/locating/geoError/touched shape, the home-area auto-seed effect,
  // useMyLocation/clearLocation). Coords live only in component state, never
  // persisted. `source` records where they came from so the UI can be honest
  // about whether it's showing the live position or a default from the saved
  // profile.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [source, setSource] = useState<'home' | 'live' | null>(null);
  const [radius, setRadius] = useState(15);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched || coords) return;
    if (user?.home_zip_lat != null && user?.home_zip_lon != null) {
      setCoords({ lat: user.home_zip_lat, lon: user.home_zip_lon });
      setRadius(30);
      setSource('home');
    }
  }, [user, touched, coords]);

  const useMyLocation = () => {
    setGeoError('');
    setTouched(true);
    if (!('geolocation' in navigator)) {
      setGeoError("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setSource('live');
        setLocating(false);
      },
      () => {
        setLocating(false);
        if (user?.home_zip_lat != null && user?.home_zip_lon != null) {
          setCoords({ lat: user.home_zip_lat, lon: user.home_zip_lon });
          setSource('home');
          setGeoError('Using your home area - allow location to use where you are now.');
        } else {
          setGeoError("Couldn't get your location. Check your browser's location permission.");
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  const clearLocation = () => {
    setTouched(true);
    setCoords(null);
    setSource(null);
    setGeoError('');
  };

  // Origin for the map center: coords when set, else the region center.
  // Primitives feed the memo so `origin` only gets a new identity when the
  // real coordinates change, not on every unrelated re-render (RegionMap
  // recenters whenever the `center` prop's reference changes, so a fresh
  // object every render here would snap the map back on every click).
  const originLat = coords?.lat ?? REGION_CENTER.lat;
  const originLon = coords?.lon ?? REGION_CENTER.lon;
  const origin = useMemo(() => ({ lat: originLat, lon: originLon }), [originLat, originLon]);

  // Seasons don't depend on category/location - load once per tenant.
  useEffect(() => {
    if (!tenant) return;
    listFreshSeasons(tenant.id)
      .then(res => {
        const inSeason = (res.data || []).filter(s => s.in_season_now).map(s => s.item_name);
        setSeasonLine(inSeason.length ? `In season now: ${inSeason.join(', ')}` : '');
      })
      .catch(() => setSeasonLine(''));
  }, [tenant]);

  // Stand pins - refetch whenever location changes so the server can filter
  // and label distance (same reasoning as the posts feed below).
  useEffect(() => {
    if (!tenant) return;
    listFreshStands(tenant.id, coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined)
      .then(res => setStands(res.data || []))
      .catch(() => setStands([]));
  }, [tenant, coords, radius]);

  // Refetch whenever the category, location, or radius changes. The server
  // does the distance filtering, so the closest posts are never cut off by
  // the limit (matches Happenings.tsx's listHappenings refetch exactly).
  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await listFresh(
          tenant.id,
          filter === 'all' ? undefined : filter,
          coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined,
        );
        setPosts(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Fresh Today.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, filter, coords, radius]);

  // Distance filtering happens server-side now; render the board as
  // returned. Order stays left exactly as the API returned it - distance is
  // a filter, never a ranking.
  const pins: RegionPin[] = useMemo(() => stands.map(s => {
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
  }), [stands]);

  const visiblePosts = posts;

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

      {/* Location filter - copied from Happenings.tsx verbatim (the one
          platform location control set, DESIGN-LANGUAGE.md §4). Live
          position is "near me"; a saved profile zip is shown as a clearly
          labeled "home area" default that live location can override. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: source === 'home' ? 6 : 12 }}>
        {!coords ? (
          <button onClick={useMyLocation} disabled={locating}
            className="btn btn-sm btn-secondary"
            style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Navigation size={13} /> {locating ? 'Locating…' : 'Near me'}
          </button>
        ) : (
          <>
            {RADIUS_OPTIONS.map(r => (
              <button key={r.mi} onClick={() => setRadius(r.mi)}
                className={`btn btn-sm ${radius === r.mi ? 'btn-amber' : 'btn-secondary'}`}
                style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {r.label}
              </button>
            ))}
            {source === 'home' && (
              <button onClick={useMyLocation} disabled={locating}
                className="btn btn-sm btn-secondary"
                style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Navigation size={13} /> {locating ? 'Locating…' : 'Use my location'}
              </button>
            )}
            <button onClick={clearLocation}
              className="btn btn-sm btn-secondary"
              style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              Clear
            </button>
          </>
        )}
      </div>
      {source === 'home' && !geoError && (
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <MapPin size={12} style={{ color: 'var(--amber)' }} />
          Showing your home area{user?.home_zip_location ? ` (${user.home_zip_location})` : ''} - tap "Use my location" if you're out and about.
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
        <RegionMap pins={pins} center={origin} maxBounds={REGION_BOUNDS} height="60vh" />
      ) : visiblePosts.length === 0 && coords && radius > 0 ? (
        // A distance filter is active and returned nothing - a distinct
        // message from the true empty-board state below, matching
        // Happenings.tsx's equivalent branch exactly.
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Sprout size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing within {radius} miles right now.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            Try a wider range, or clear the location filter to see the whole board.
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
