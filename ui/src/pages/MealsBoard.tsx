import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listMeals, listMealPins, categoryLabel, MEAL_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type MealFeedRow, type MealPin,
} from '../api/meals';
import { UtensilsCrossed, List, Map as MapIcon, Phone, MapPin, Navigation } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui';

// Community Table's public browse board. Follows Happenings/Fresh Today/Sale
// Day/Pop-Ups' design language exactly (serif header, calm chip rows, white
// cards with a green left accent, centered spinner, calm empty state, 800px
// column, and the platform's one location control set, DESIGN-LANGUAGE.md
// §4). The differentiator: date-grouped list headers (Today/Tomorrow/
// weekday) like Pop-Ups' board, plus the benefit_line getting its own
// amber-tinted line - it's the line that makes someone drive out.

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

export default function MealsBoard() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [meals, setMeals] = useState<MealFeedRow[]>([]);
  const [pins, setPins] = useState<MealPin[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Location filtering - copied from Happenings.tsx verbatim, see
  // FreshToday.tsx/SaleDay.tsx/PopupsBoard.tsx for the identical adaptation.
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
    (async () => {
      setLoading(true);
      setError('');
      try {
        const categoryParam = category === 'all' ? undefined : category;
        const nearby = coords ? { lat: coords.lat, lon: coords.lon, radius } : undefined;
        const [feedRes, pinsRes] = await Promise.all([
          listMeals(tenant.id, categoryParam, nearby),
          listMealPins(tenant.id, categoryParam, nearby),
        ]);
        setMeals(feedRes.data || []);
        setPins(pinsRes.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Community Table.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, category, coords, radius]);

  const today = todayBoardDateStr();
  const tomorrow = tomorrowBoardDateStr();

  const grouped = useMemo(() => {
    const groups: { label: string; meals: MealFeedRow[] }[] = [];
    for (const m of meals) {
      const label = groupLabel(m.date, today, tomorrow);
      const existing = groups.find(g => g.label === label);
      if (existing) existing.meals.push(m);
      else groups.push({ label, meals: [m] });
    }
    return groups;
  }, [meals, today, tomorrow]);

  const mapPins: RegionPin[] = useMemo(() => pins.map(p => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    label: p.title,
    sublabel: p.status_note,
    href: `/meals/meal/${p.id}`,
    kind: (p.status === 'serving_now' || p.status === 'today') ? 'amber' : 'green',
  })), [pins]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <UtensilsCrossed size={22} style={{ color: 'var(--amber)' }} /> Community Table
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Fish fries, pancake breakfasts, suppers and benefits - who's serving, when, and who it helps.
      </p>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Category chips */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...MEAL_CATEGORIES].map(c => (
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
      ) : meals.length === 0 && coords && radius > 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <UtensilsCrossed size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing within {radius} miles right now.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            Try a wider range, or clear the location filter to see the whole board.
          </p>
        </div>
      ) : meals.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <UtensilsCrossed size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing on the table right now.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Fire halls, churches and clubs post their meals here - breakfasts, fish fries, benefits.
            Cooking for a crowd? Put your kitchen on the board.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/meals/mine')}>
            Set up our kitchen
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
                {group.meals.map(m => (
                  <div key={m.id} className="card" role="button" tabIndex={0}
                    onClick={() => navigate(`/meals/meal/${m.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/meals/meal/${m.id}`); }}
                    style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{m.title}</span>
                      <span style={{
                        fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                        borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                        whiteSpace: 'nowrap',
                      }}>
                        {categoryLabel(m.category)}
                      </span>
                    </div>

                    <p style={{ margin: '0 0 4px', fontSize: '0.82rem', color: 'var(--muted)' }}>
                      {m.kitchen.name}{m.kitchen.nearest_city ? ` · ${m.kitchen.nearest_city}` : ''}
                    </p>

                    <p style={{ margin: '0 0 6px', fontSize: '0.85rem', color: 'var(--text)' }}>
                      {clockLabel(m.open)} - {clockLabel(m.close)}
                    </p>

                    {m.benefit_line && (
                      <p style={{
                        margin: '0 0 8px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--amber)',
                        background: 'rgba(200,134,10,0.08)', padding: '6px 10px', borderRadius: 'var(--r-sm)',
                      }}>
                        {m.benefit_line}
                      </p>
                    )}

                    <p style={{
                      margin: '0 0 8px', fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.4,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {m.body}
                    </p>

                    {m.photo_url && (
                      <img src={m.photo_url} alt="" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, marginBottom: 8, display: 'block' }} />
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        {m.status === 'serving_now' ? (
                          <Badge variant="amber">{m.status_note}</Badge>
                        ) : m.status === 'sold_out' ? (
                          <Badge variant="amber">Sold out</Badge>
                        ) : m.status === 'cancelled' ? (
                          <Badge variant="gray">Cancelled</Badge>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{m.status_note}</span>
                        )}
                      </div>
                      {m.kitchen.phone && (
                        <a href={`tel:${m.kitchen.phone.replace(/[^0-9+]/g, '')}`}
                          onClick={e => e.stopPropagation()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
                          <Phone size={12} style={{ color: 'var(--amber)' }} /> {m.kitchen.phone}
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
