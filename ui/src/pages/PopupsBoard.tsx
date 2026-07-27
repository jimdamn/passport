import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listPopups, listPopupPins, listPopupEvents, categoryLabel, POPUP_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type PopupFeedStop, type PopupStopPin, type PopupWhen, type PopupEventChip,
} from '../api/popups';
import { Truck, List, Map as MapIcon, Phone, MapPin, Navigation } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui/map';

// Pop-Ups' public browse board. Follows Happenings/Fresh Today/Sale Day's
// design language exactly (serif header, calm chip rows, white cards with a
// green left accent, centered spinner, calm empty state, 800px column, and
// the platform's one location control set, DESIGN-LANGUAGE.md §4). The
// differentiator (POP-UPS-BUILD-PLAN.md §0/§1): a When row (Today/Coming up/
// All) sits above the category row, and both the list and the map carry two
// layers - green (checked in, verified) vs amber (on the schedule, a plan).
// The location control row sits below both, immediately above the List/Map
// toggle - same relative position as every other board.

const RADIUS_OPTIONS = [
  { mi: 5, label: '5 mi' },
  { mi: 15, label: '15 mi' },
  { mi: 30, label: '30 mi' },
  { mi: 0, label: 'Any' },
];

function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}

function todayBoardDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function tomorrowBoardDateStr(): string {
  const [y, m, d] = todayBoardDateStr().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function weekdayDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

function groupLabel(dateStr: string, today: string, tomorrow: string): string {
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  return weekdayDateLabel(dateStr);
}

export default function PopupsBoard() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [stops, setStops] = useState<PopupFeedStop[]>([]);
  const [pins, setPins] = useState<PopupStopPin[]>([]);
  const [events, setEvents] = useState<PopupEventChip[]>([]);
  const [when, setWhen] = useState<PopupWhen | 'all'>('all');
  const [category, setCategory] = useState<string>('all');
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Location filtering - copied from Happenings.tsx verbatim, see
  // FreshToday.tsx/SaleDay.tsx for the identical adaptation.
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

  // Event chips don't depend on the when/category/event/location filter -
  // load once per tenant (same pattern as SaleDay.tsx's listSaleEvents effect).
  useEffect(() => {
    if (!tenant) return;
    listPopupEvents(tenant.id).then(res => setEvents(res.data || [])).catch(() => setEvents([]));
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const whenParam = when === 'all' ? undefined : when;
        const categoryParam = category === 'all' ? undefined : category;
        const nearby = coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined;
        const [feedRes, pinsRes] = await Promise.all([
          listPopups(tenant.id, categoryParam, whenParam, eventFilter ?? undefined, nearby),
          listPopupPins(tenant.id, categoryParam, whenParam, eventFilter ?? undefined, nearby),
        ]);
        setStops(feedRes.data || []);
        setPins(pinsRes.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Pop-Ups.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, when, category, eventFilter, coords, radius]);

  const today = todayBoardDateStr();
  const tomorrow = tomorrowBoardDateStr();

  const grouped = useMemo(() => {
    const groups: { label: string; stops: PopupFeedStop[] }[] = [];
    for (const s of stops) {
      const label = groupLabel(s.date, today, tomorrow);
      const existing = groups.find(g => g.label === label);
      if (existing) existing.stops.push(s);
      else groups.push({ label, stops: [s] });
    }
    return groups;
  }, [stops, today, tomorrow]);

  const mapPins: RegionPin[] = useMemo(() => pins.map(p => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    label: p.vendor_name,
    sublabel: p.status_note,
    href: `/popups/vendor/${p.vendor_id}`,
    kind: p.layer === 'confirmed' ? 'green' : 'amber',
  })), [pins]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Truck size={22} style={{ color: 'var(--amber)' }} /> Pop-Ups
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Food trucks, pop-up shops and traveling vendors - where they are today, and where they'll be next.
      </p>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Event chip row - grouping for vendors sharing a fair/market/festival.
          Omitted entirely when no event has 2+ visible stops. */}
      {events.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>At the same event:</span>
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

      {/* When chips - the differentiator, first row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {[{ key: 'all', label: 'All' }, { key: 'today', label: 'Today' }, { key: 'coming', label: 'Coming up' }].map(w => (
          <button key={w.key} onClick={() => setWhen(w.key as PopupWhen | 'all')}
            className={`btn btn-sm ${when === w.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32 }}>
            {w.label}
          </button>
        ))}
      </div>

      {/* Category chips - second row */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...POPUP_CATEGORIES].map(c => (
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
        <>
          <RegionMap pins={mapPins} center={origin} maxBounds={REGION_BOUNDS} height="60vh" />
          <p style={{ margin: '10px 0 0', fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'center' }}>
            Green means they've checked in - they're there. Amber is their schedule - plans change.
          </p>
        </>
      ) : stops.length === 0 && coords && radius > 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Truck size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing within {radius} miles right now.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            Try a wider range, or clear the location filter to see the whole board.
          </p>
        </div>
      ) : stops.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Truck size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nobody's popped up yet.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Food trucks, pop-up shops and market vendors post their stops here - today's and the week ahead. Run one? Put your schedule on the map.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/popups/mine')}>
            Put my schedule on the map
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {grouped.map(group => (
            <div key={group.label}>
              <p style={{ margin: '0 0 8px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted)' }}>
                {group.label}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {group.stops.map(s => (
                  <div key={s.id} className="card" role="button" tabIndex={0}
                    onClick={() => navigate(`/popups/vendor/${s.vendor.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/popups/vendor/${s.vendor.id}`); }}
                    style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{s.vendor.name}</span>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{
                          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                          borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                          whiteSpace: 'nowrap',
                        }}>
                          {categoryLabel(s.vendor.category)}
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

                    <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text)' }}>
                      {clockLabel(s.open)} - {clockLabel(s.close)}
                    </p>

                    {s.address && (
                      <p style={{ margin: '0 0 2px', fontSize: '0.82rem', color: 'var(--text)' }}>{s.address}</p>
                    )}
                    {(s.location_hint || s.nearest_city) && (
                      <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {[s.location_hint, s.nearest_city].filter(Boolean).join(' · ')}
                      </p>
                    )}

                    {s.note && (
                      <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.4 }}>{s.note}</p>
                    )}

                    {s.vendor.photo_url && (
                      <img src={s.vendor.photo_url} alt="" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, marginBottom: 8, display: 'block' }} />
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        {s.status === 'here_now' ? (
                          <Badge variant="green">{s.status_note}</Badge>
                        ) : s.status === 'sold_out' ? (
                          <Badge variant="amber">{s.status_note}</Badge>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{s.status_note}</span>
                        )}
                      </div>
                      {s.vendor.phone && (
                        <a href={`tel:${s.vendor.phone.replace(/[^0-9+]/g, '')}`}
                          onClick={e => e.stopPropagation()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
                          <Phone size={12} style={{ color: 'var(--amber)' }} /> {s.vendor.phone}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
