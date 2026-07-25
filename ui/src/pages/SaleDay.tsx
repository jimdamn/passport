import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listSales, listSalePins, listSaleEvents, categoryLabel, saleLocation, SALE_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type SaleFeedRow, type SalePin, type SaleEventChip,
} from '../api/sales';
import { Signpost, List, Map as MapIcon, Phone, MapPin, Navigation } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui';

// Sale Day's public browse board. Follows Happenings/Fresh Today's design
// language exactly (FreshToday.tsx is the structural donor) - serif header,
// calm chip rows, white cards with a green left accent, centered spinner,
// calm empty state, 800px column, and the platform's one location control
// set (kk-shared-ui/DESIGN-LANGUAGE.md §4). Diff vs Fresh Today: an event
// chip row replaces the season strip.

// Same four values, same location control set, on every board module.
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

export default function SaleDay() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [sales, setSales] = useState<SaleFeedRow[]>([]);
  const [pins, setPins] = useState<SalePin[]>([]);
  const [events, setEvents] = useState<SaleEventChip[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Location filtering - copied from Happenings.tsx verbatim, see
  // FreshToday.tsx for the identical adaptation.
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

  // Event chips don't depend on category/event/location filters - load once
  // per tenant.
  useEffect(() => {
    if (!tenant) return;
    listSaleEvents(tenant.id).then(res => setEvents(res.data || [])).catch(() => setEvents([]));
  }, [tenant]);

  // Pins refetch on location change so the server can filter and label
  // distance, same as the feed below (same pattern as FreshToday.tsx).
  useEffect(() => {
    if (!tenant) return;
    listSalePins(tenant.id, coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined)
      .then(res => setPins(res.data || []))
      .catch(() => setPins([]));
  }, [tenant, coords, radius]);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await listSales(
          tenant.id,
          category === 'all' ? undefined : category,
          eventFilter ?? undefined,
          coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined,
        );
        setSales(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Sale Day.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, category, eventFilter, coords, radius]);

  const mapPins: RegionPin[] = useMemo(() => pins.map(p => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    label: p.title,
    sublabel: p.status_note,
    href: `/sales/sale/${p.id}`,
    kind: p.status === 'on_now' ? 'amber' : 'green',
  })), [pins]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Signpost size={22} style={{ color: 'var(--amber)' }} /> Sale Day
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Yard sales, barn sales, estate sales and auctions - on the map before you head out.
      </p>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Event chip row - the corridor-event feature (US-12 weekend). Omitted
          entirely when no event has 2+ visible sales. */}
      {events.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>This weekend:</span>
          {events.map(e => (
            <button key={e.event_name}
              onClick={() => setEventFilter(prev => prev === e.event_name ? null : e.event_name)}
              className={`btn btn-sm ${eventFilter === e.event_name ? 'btn-amber' : 'btn-secondary'}`}
              style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {e.event_name}
            </button>
          ))}
        </div>
      )}

      {/* Category filter - calm chips, no counts or badges */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...SALE_CATEGORIES].map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)}
            className={`btn btn-sm ${category === c.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.label}
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
        <RegionMap pins={mapPins} center={origin} maxBounds={REGION_BOUNDS} height="60vh" />
      ) : sales.length === 0 && coords && radius > 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Signpost size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing within {radius} miles right now.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            Try a wider range, or clear the location filter to see the whole board.
          </p>
        </div>
      ) : sales.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Signpost size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            No sales on the board right now.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Sales show up here as neighbors post them - weekends fill up fast. Having one? Put it on the map in a minute.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/sales/mine')}>
            Post my sale
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sales.map(s => (
            <div key={s.id} className="card" role="button" tabIndex={0}
              onClick={() => navigate(`/sales/sale/${s.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/sales/sale/${s.id}`); }}
              style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{s.title}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                    borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                    whiteSpace: 'nowrap',
                  }}>
                    {categoryLabel(s.category)}
                  </span>
                  {s.event_name && (
                    <span style={{
                      fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                      borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.14)', color: 'var(--amber)',
                      whiteSpace: 'nowrap',
                    }}>
                      {s.event_name}
                    </span>
                  )}
                </div>
              </div>

              {saleLocation(s.nearest_city, s.nearest_state) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>
                  <MapPin size={12} style={{ color: 'var(--amber)' }} />
                  {saleLocation(s.nearest_city, s.nearest_state)}
                </div>
              )}

              <p style={{
                margin: '0 0 8px', fontSize: '1rem', color: 'var(--text)', lineHeight: 1.45,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {s.body}
              </p>

              {s.photo_url && (
                <img src={s.photo_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8, display: 'block' }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                  {truncate(s.address_hint ?? '', 60)}
                </span>
                {s.phone && (
                  <a href={`tel:${s.phone.replace(/[^0-9+]/g, '')}`}
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
                    <Phone size={12} style={{ color: 'var(--amber)' }} /> {s.phone}
                  </a>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                {(s.status === 'on_now' || s.status === 'ended') ? (
                  <Badge variant="amber">{s.status_note}</Badge>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{s.status_note}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
