import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import {
  getHappenings, categoryLabel, HAPPENING_CATEGORIES,
  type Happening,
} from '../api/happenings';
import { useAuth } from '../context/AuthContext';
import { CalendarDays, MapPin, Phone, Globe, Store, Tag, X, Navigation } from 'lucide-react';
import { Alert } from '../components/ui/Alert';
import { Spinner } from '../components/ui/Spinner';

// Empty-state illustrations only. These are clearly-labeled "Example" cards so a
// first-time visitor sees the intent of the board when nothing is posted yet - 
// never styled or wired to look like a real merchant post (no contact, no tap).
const SAMPLE_HAPPENINGS: { category: string; body: string }[] = [
  { category: 'food_drink', body: 'Fresh sourdough out of the oven at 3 - still warm if you hurry.' },
  { category: 'live_music', body: 'Live acoustic set on the patio tonight, 6–8pm. Pull up a chair.' },
  { category: 'markets', body: 'Extra sweet corn just came in at the farm stand this morning.' },
  { category: 'sales', body: 'End-of-season flannels 20% off through the weekend.' },
  { category: 'community', body: 'Pickup euchre at the coffee shop Thursday at 7 - all are welcome.' },
];

// A calm bulletin board: chronological, no countdowns, no urgency. Posts clear
// themselves at end of day, so there is nothing to chase.
function postedAgo(createdAt: number): string {
  const mins = Math.floor((Date.now() / 1000 - createdAt) / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

// Distance is a quiet relevance filter, not an urgency signal - no "3 nearby!"
// pressure. The "Any" option keeps the board unfiltered by distance. Filtering
// happens server-side (the board refetches with the visitor's coords) so the
// nearest posts can never be cut off by the result limit.
const RADIUS_OPTIONS = [
  { mi: 5, label: '5 mi' },
  { mi: 15, label: '15 mi' },
  { mi: 30, label: '30 mi' },
  { mi: 0, label: 'Any' },
];

function mapHref(h: Happening): string {
  if (h.merchant_lat != null && h.merchant_lon != null) {
    return `https://www.google.com/maps/search/?api=1&query=${h.merchant_lat},${h.merchant_lon}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.merchant_address ?? '')}`;
}

function ContactBubble({ happening, onClose }: { happening: Happening; onClose: () => void }) {
  const h = happening;
  const hasContact = h.merchant_name || h.merchant_address || h.merchant_phone || h.merchant_website;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div className="card" style={{ background: 'var(--white)', padding: 24, maxWidth: 380, width: '100%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
            borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
          }}>
            {categoryLabel(h.category)}
          </span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: '0.95rem', color: 'var(--text)', lineHeight: 1.45 }}>{h.body}</p>

        {h.merchant_name && (
          <p style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Store size={15} /> {h.merchant_name}
          </p>
        )}

        {hasContact ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {h.merchant_address && (
              <a href={mapHref(h)} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text)', textDecoration: 'none' }}>
                <MapPin size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <span>{h.merchant_address}</span>
              </a>
            )}
            {h.merchant_phone && (
              <a href={`tel:${h.merchant_phone.replace(/[^0-9+]/g, '')}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text)', textDecoration: 'none' }}>
                <Phone size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <span>{h.merchant_phone}</span>
              </a>
            )}
            {h.merchant_website && (
              <a href={h.merchant_website} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text)', textDecoration: 'none' }}>
                <Globe size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <span>Visit website</span>
              </a>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>No contact details shared for this post.</p>
        )}
      </div>
    </div>
  );
}

export default function Happenings() {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<Happening[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Happening | null>(null);

  // Location filtering. Coords live only in component state - never persisted.
  // `source` records where they came from so the UI can be honest about whether
  // we're showing the live position or just a default from the saved profile.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [source, setSource] = useState<'home' | 'live' | null>(null);
  const [radius, setRadius] = useState(15);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  // Once the visitor acts on the location control, stop auto-seeding their home
  // area so a cleared/overridden choice never snaps back on the next render.
  const [touched, setTouched] = useState(false);

  // Smart default for registered users: seed the board with their saved home
  // area the first time their profile loads. It's a default, never a lock - live
  // location overrides it, and clearing turns it off for good.
  useEffect(() => {
    if (touched || coords) return;
    if (user?.home_zip_lat != null && user?.home_zip_lon != null) {
      setCoords({ lat: user.home_zip_lat, lon: user.home_zip_lon });
      setRadius(30); // home browsing is regional - a bit wider than live "near me"
      setSource('home');
    }
  }, [user, touched, coords]);

  const useMyLocation = () => {
    setGeoError('');
    setTouched(true);
    if (!('geolocation' in navigator)) {
      setGeoError('Location isn’t available on this device.');
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
        // Fall back to the saved home area if we have it; otherwise just ask
        // them to allow location.
        if (user?.home_zip_lat != null && user?.home_zip_lon != null) {
          setCoords({ lat: user.home_zip_lat, lon: user.home_zip_lon });
          setSource('home');
          setGeoError('Using your home area - allow location to use where you are now.');
        } else {
          setGeoError('Couldn’t get your location. Check your browser’s location permission.');
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

  // Refetch whenever the category, location, or radius changes. The server does
  // the distance filtering, so the closest posts are never cut off by the limit.
  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await getHappenings(
          tenant.id,
          filter === 'all' ? undefined : filter,
          coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined,
        );
        setItems(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load happenings.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, filter, coords, radius]);

  // Distance filtering happens server-side; render the board as returned. Order
  // stays chronological - distance is a filter, never a ranking, so it's calm.
  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={22} /> Happenings
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        What's going on around the region today - straight from local businesses. The board
        clears each night, so it's always about right now.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {/* Category filter - calm chips, no counts or badges */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...HAPPENING_CATEGORIES].map(c => (
          <button key={c.key} onClick={() => setFilter(c.key)}
            className={`btn btn-sm ${filter === c.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Location filter. Live position is "near me"; a saved profile zip is shown
          as a clearly-labeled "home area" default that live location can override. */}
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
              <X size={13} /> Clear
            </button>
          </>
        )}
      </div>
      {source === 'home' && !geoError && (
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <MapPin size={12} style={{ color: 'var(--amber)' }} />
          Showing your home area{user?.home_zip_location ? ` (${user.home_zip_location})` : ''} - tap “Use my location” if you’re out and about.
        </p>
      )}
      {geoError && (
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>{geoError}</p>
      )}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        coords && radius > 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
            <Navigation size={26} style={{ color: 'var(--amber)', marginBottom: 8 }} />
            <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
              Nothing within {radius} miles right now.
            </p>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>
              Try a wider range, or clear the location filter to see the whole board.
            </p>
          </div>
        ) : (
        <div>
          <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)', marginBottom: 16 }}>
            <CalendarDays size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
              {filter === 'all'
                ? 'Nothing posted yet today. Here’s the kind of thing neighbors share here as the day goes on.'
                : `No ${categoryLabel(filter).toLowerCase()} happenings right now. Here’s the kind of thing you’ll see here.`}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden="true">
            {SAMPLE_HAPPENINGS.map((s, i) => (
              <div key={i} className="card" style={{
                background: 'var(--white)', padding: 16, opacity: 0.7,
                borderLeft: '4px dashed var(--muted, #999)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                    borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                  }}>
                    {categoryLabel(s.category)}
                  </span>
                  <span style={{
                    fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                    padding: '2px 8px', borderRadius: 'var(--r-sm)',
                    background: 'rgba(200,134,10,0.12)', color: 'var(--amber)',
                  }}>
                    Example
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.45 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(h => (
            <div key={h.id} className="card" role="button" tabIndex={0}
              onClick={() => setOpen(h)}
              onKeyDown={e => { if (e.key === 'Enter') setOpen(h); }}
              style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                <span style={{
                  fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                  borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                }}>
                  {categoryLabel(h.category)}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{postedAgo(h.created_at)}</span>
              </div>

              <p style={{ margin: '0 0 8px', fontSize: '0.95rem', color: 'var(--text)', lineHeight: 1.45 }}>{h.body}</p>

              {h.photo_url && (
                <img src={h.photo_url} alt="" loading="lazy"
                  style={{ width: '100%', borderRadius: 'var(--r-md, 8px)', marginBottom: 8, maxHeight: 220, objectFit: 'cover' }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {h.merchant_name ? (
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Store size={12} /> {h.merchant_name}
                    {h.distance_mi != null && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <span>·</span><MapPin size={11} /> {h.distance_mi < 1 ? '<1' : Math.round(h.distance_mi)} mi
                      </span>
                    )}
                  </span>
                ) : h.distance_mi != null ? (
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={11} /> {h.distance_mi < 1 ? '<1' : Math.round(h.distance_mi)} mi
                  </span>
                ) : <span />}
                {h.deal && (
                  <button
                    className="btn btn-amber btn-sm"
                    style={{ minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    onClick={e => { e.stopPropagation(); navigate('/deals'); }}>
                    <Tag size={12} /> Deal: {h.deal.title}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && <ContactBubble happening={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
