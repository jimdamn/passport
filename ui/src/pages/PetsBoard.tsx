import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listPetPosts, listPetPins, speciesLabel, PET_TYPES, PET_SPECIES, REGION_CENTER, REGION_BOUNDS,
  type PetFeedRow, type PetPin,
} from '../api/pets';
import { PawPrint, List, Map as MapIcon, Phone, Mail, MapPin, Navigation } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap } from 'kk-shared-ui/map';

// Home Safe's public browse board. Follows Happenings/Sale Day's design
// language exactly (SaleDay.tsx is the visual donor) - serif header, calm
// chip rows, white cards with a green left accent, centered spinner, calm
// empty state, 800px column, and the platform's one location control set
// (DESIGN-LANGUAGE.md §4). Diff vs Sale Day: two chip rows (type, then
// species) instead of one, and contact is masked by default - list cards
// show a "Get in touch" link instead of a bare phone number unless the
// poster opted into inline display. No credits, no KKGame calls, no
// notifications, ever (standing constraint, HOME-SAFE-BUILD-PLAN.md) - this
// change touches none of that.

const RADIUS_OPTIONS = [
  { mi: 5, label: '5 mi' },
  { mi: 15, label: '15 mi' },
  { mi: 30, label: '30 mi' },
  { mi: 0, label: 'Any' },
];

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

function lastSeenLine(p: PetFeedRow): string {
  const place = p.location_hint || p.nearest_city;
  const verb = p.type === 'lost' ? 'Last seen' : 'Found';
  const base = place ? `${verb} near ${place}` : verb;
  return p.seen_date ? `${base} · ${p.seen_date}` : base;
}

export default function PetsBoard() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<PetFeedRow[]>([]);
  const [pins, setPins] = useState<PetPin[]>([]);
  const [type, setType] = useState<string>('all');
  const [species, setSpecies] = useState<string>('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Location filtering - copied from Happenings.tsx verbatim, see
  // FreshToday.tsx/SaleDay.tsx/PopupsBoard.tsx/MealsBoard.tsx for the
  // identical adaptation.
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

  const originLat = coords?.lat ?? REGION_CENTER.lat;
  const originLon = coords?.lon ?? REGION_CENTER.lon;
  const origin = useMemo(() => ({ lat: originLat, lon: originLon }), [originLat, originLon]);

  useEffect(() => {
    if (!tenant) return;
    listPetPins(tenant.id, coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined)
      .then(res => setPins(res.data || []))
      .catch(() => setPins([]));
  }, [tenant, coords, radius]);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await listPetPosts(
          tenant.id,
          type === 'all' ? undefined : type,
          species === 'all' ? undefined : species,
          coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined,
        );
        setPosts(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Home Safe.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, type, species, coords, radius]);

  const mapPins = useMemo(() => pins.map(p => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    label: p.pet_name || speciesLabel(p.species),
    sublabel: p.status === 'home_safe' ? 'Home safe' : (p.type === 'lost' ? `Lost near ${p.location_hint || p.nearest_city || 'the area'}` : `Found near ${p.location_hint || p.nearest_city || 'the area'}`),
    href: `/pets/post/${p.id}`,
    kind: p.kind,
  })), [pins]);

  const unresolved = posts.filter(p => p.status !== 'home_safe');
  const resolved = posts.filter(p => p.status === 'home_safe');

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <PawPrint size={22} style={{ color: 'var(--amber)' }} /> Home Safe
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Lost and found pets across the Lakes Region - post it, share it, bring them home.
      </p>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Type chip row */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...PET_TYPES].map(t => (
          <button key={t.key} onClick={() => setType(t.key)}
            className={`btn btn-sm ${type === t.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Species chip row */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...PET_SPECIES].map(s => (
          <button key={s.key} onClick={() => setSpecies(s.key)}
            className={`btn btn-sm ${species === s.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Location filter - copied from Happenings.tsx verbatim (the one
          platform location control set, DESIGN-LANGUAGE.md §4). */}
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
        <>
          <RegionMap pins={mapPins} center={origin} maxBounds={REGION_BOUNDS} height="60vh" />
          <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
            Amber is missing - keep your eyes open. Green means found or home safe.
          </p>
        </>
      ) : posts.length === 0 && coords && radius > 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <PawPrint size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing within {radius} miles right now.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            Try a wider range, or clear the location filter to see the whole board.
          </p>
        </div>
      ) : posts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <PawPrint size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            No lost or found pets posted right now.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            That's a good day. If one goes missing, post it here in a minute - and share it anywhere you like, the link does the work.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/pets/mine')}>
            Report a pet
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {unresolved.map(p => <PetCard key={p.id} post={p} onOpen={() => navigate(`/pets/post/${p.id}`)} />)}
          {resolved.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Recently home safe</span>
                <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
              </div>
              {resolved.map(p => <PetCard key={p.id} post={p} onOpen={() => navigate(`/pets/post/${p.id}`)} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PetCard({ post, onOpen }: { post: PetFeedRow; onOpen: () => void }) {
  const title = post.pet_name || speciesLabel(post.species);
  return (
    <div role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      className="card"
      style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)', display: 'flex', gap: 12 }}>
      {post.photo_url && (
        <img src={post.photo_url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{title}</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
              borderRadius: 'var(--r-sm)',
              background: post.type === 'lost' ? 'rgba(200,134,10,0.14)' : 'rgba(80,120,80,0.12)',
              color: post.type === 'lost' ? 'var(--amber)' : 'var(--green)',
              whiteSpace: 'nowrap',
            }}>
              {post.type === 'lost' ? 'Lost' : 'Found'}
            </span>
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
              borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
              whiteSpace: 'nowrap',
            }}>
              {speciesLabel(post.species)}
            </span>
          </div>
        </div>

        <p style={{
          margin: '0 0 6px', fontSize: '0.85rem', color: 'var(--muted)',
        }}>
          {lastSeenLine(post)}
        </p>

        <p style={{
          margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {truncate(post.body, 140)}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {post.status === 'home_safe' ? (
            <Badge variant="green">Home safe</Badge>
          ) : post.contact_public && post.phone ? (
            <a href={`tel:${post.phone.replace(/[^0-9+]/g, '')}`}
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
              <Phone size={12} style={{ color: 'var(--amber)' }} /> {post.phone}
            </a>
          ) : post.contact_public && post.email ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)' }}>
              <Mail size={12} style={{ color: 'var(--amber)' }} /> {post.email}
            </span>
          ) : (
            <span style={{ fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 600 }}>Get in touch</span>
          )}
        </div>
      </div>
    </div>
  );
}
