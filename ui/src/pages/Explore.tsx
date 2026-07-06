import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';

import { MapPin, Compass, CalendarDays, ChevronRight, Navigation, X, HeartHandshake } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';

// Around Town follows the Happenings design language exactly: serif header
// with an inline icon, calm text chip rows for every filter (btn-amber
// active / btn-secondary idle), quiet status lines, white cards with a 4px
// green left accent, centered spinner, calm empty states, 800px column.

// A verified member business on the network - real data from KKAuth via the
// network-members endpoint. No fabricated ratings, coordinates, or samples.
interface Business {
  member_uid: number;
  name: string;
  category: string;      // mapped to a category slug below
  description: string | null;
  address: string | null;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  website: string | null;
}

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'dining', label: 'Dining & Drinks' },
  { key: 'shopping', label: 'Boutiques & Shops' },
  { key: 'farmfood', label: 'Farm & Fresh' },
  { key: 'recreation', label: 'Parks & Trails' },
  { key: 'attractions', label: 'Attractions' },
  { key: 'lodging', label: 'Lodging' },
  { key: 'services', label: 'Services' },
];

function categoryLabel(slug: string): string {
  return CATEGORIES.find(c => c.key === slug)?.label ?? 'Services';
}

// Map a business's free-text category from KKAuth onto the browse slugs.
function categorySlug(raw: string | null): string {
  const c = (raw ?? '').toLowerCase();
  if (/food|dining|restaurant|cafe|coffee|bakery|brew|bar\b/.test(c)) return 'dining';
  if (/shop|retail|boutique|store|gift/.test(c)) return 'shopping';
  if (/farm|orchard|produce|market|csa/.test(c)) return 'farmfood';
  if (/lodg|hotel|inn|b&b|bnb|resort|camp/.test(c)) return 'lodging';
  if (/park|trail|recreat|outdoor|marina|golf/.test(c)) return 'recreation';
  if (/attraction|museum|landmark|theat/.test(c)) return 'attractions';
  return 'services';
}

const RADIUS_OPTIONS = [
  { mi: 5, label: '5 mi' },
  { mi: 15, label: '15 mi' },
  { mi: 30, label: '30 mi' },
  { mi: 0, label: 'Any' },
];

// Known regional zip centers; unknown zips honestly fall back to the region
// center - never an invented coordinate pretending to be the visitor's area.
const LOCAL_ZIP_COORDINATES: Record<string, { lat: number; lon: number }> = {
  '46703': { lat: 41.6348, lon: -84.9997 },
  '46737': { lat: 41.7303, lon: -84.9316 },
  '46742': { lat: 41.5342, lon: -84.8916 },
  '46747': { lat: 41.5317, lon: -85.0811 },
  '46706': { lat: 41.3653, lon: -85.0636 },
};
const REGION_CENTER = { lat: 41.6348, lon: -84.9997 };

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

export default function Explore() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [dbMembers, setDbMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Location filter, Happenings-style: live position is "near me"; a saved
  // profile zip is a clearly-labeled home-area default that live location
  // can override. Radius is a filter, never a ranking.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [source, setSource] = useState<'home' | 'live' | null>(null);
  const [radius, setRadius] = useState(30);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [touched, setTouched] = useState(false);

  // Smart default for registered users: seed with their saved home area the
  // first time their profile loads. A default, never a lock.
  useEffect(() => {
    if (touched || coords) return;
    if (user?.home_zip_lat != null && user?.home_zip_lon != null) {
      setCoords({ lat: user.home_zip_lat, lon: user.home_zip_lon });
      setRadius(30);
      setSource('home');
    } else if (user?.home_zip_location && LOCAL_ZIP_COORDINATES[user.home_zip_location]) {
      setCoords(LOCAL_ZIP_COORDINATES[user.home_zip_location]);
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

  // Persist a live-location visit as nothing; persist nothing here at all -
  // the saved home area is managed from the profile, this page only reads it.

  // Fetch the verified member businesses of the network (KKAuth-sourced).
  useEffect(() => {
    const fetchDbMembers = async () => {
      try {
        setLoading(true);
        const tenantId = tenant?.id || 'lake-locals';
        const res = await fetch(`/api/t/${tenantId}/network-members`);
        if (res.ok) {
          const json = await res.json() as { data: any[] };
          setDbMembers(json.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch network members:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDbMembers();
  }, [tenant]);

  const origin = coords ?? REGION_CENTER;

  // Real member businesses only - category from their own listing, real
  // coordinates when they share an address, nothing invented.
  const listings = dbMembers
    .map((m: any): Business & { distance: number | null } => {
      const slug = categorySlug(m.category);
      return {
        member_uid: m.member_uid,
        name: m.name,
        category: slug,
        description: m.description ?? null,
        address: m.address ?? null,
        zip: m.zip ?? null,
        lat: m.lat ?? null,
        lon: m.lon ?? null,
        phone: m.phone ?? null,
        website: m.website ?? null,
        distance: m.lat != null && m.lon != null
          ? calculateDistance(origin.lat, origin.lon, m.lat, m.lon)
          : null,
      };
    })
    .filter(b => {
      if (selectedCategory !== 'all' && b.category !== selectedCategory) return false;
      // Distance is a filter, never a cut for members who don't share a location.
      if (coords && radius > 0 && b.distance != null && b.distance > radius) return false;
      return true;
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Compass size={22} /> Around Town
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        The member businesses of the Lake &amp; Locals network. Visit a member page to
        book an appointment, share your experience, or see what they offer.
      </p>

      {/* Events entry - same calm card language as everything else */}
      <Link
        to="/happenings"
        className="card"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', marginBottom: 16,
          textDecoration: 'none', color: 'inherit',
          background: 'var(--white)', borderLeft: '4px solid var(--green)',
        }}
      >
        <CalendarDays size={20} color="var(--amber)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: '0.95rem' }}>Events &amp; Happenings</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>See what's going on around town today</div>
        </div>
        <ChevronRight size={18} color="var(--amber)" style={{ flexShrink: 0 }} />
      </Link>

      {/* Lend a Hand entry - same calm card language */}
      <Link
        to="/lend-a-hand"
        className="card"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', marginBottom: 16,
          textDecoration: 'none', color: 'inherit',
          background: 'var(--white)', borderLeft: '4px solid var(--green)',
        }}
      >
        <HeartHandshake size={20} color="var(--amber)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: '0.95rem' }}>Lend a Hand</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Volunteer shifts posted by local businesses - a thank-you in KrowdKredits</div>
        </div>
        <ChevronRight size={18} color="var(--amber)" style={{ flexShrink: 0 }} />
      </Link>

      {/* Category filter - calm chips, no icons, no counts */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, WebkitOverflowScrolling: 'touch' }}>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setSelectedCategory(c.key)}
            className={`btn btn-sm ${selectedCategory === c.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Location filter - identical control language to Happenings */}
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
          Showing your home area{user?.home_zip_location ? ` (${user.home_zip_location})` : ''} - tap "Use my location" if you're out and about.
        </p>
      )}
      {geoError && (
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>{geoError}</p>
      )}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : listings.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Compass size={26} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', fontSize: '0.9rem' }}>
            {coords && radius > 0 ? `No member businesses within ${radius} miles.` : 'No member businesses match.'}
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>
            The network is growing - try a wider range or a different category.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {listings.map(b => (
            <Link key={b.member_uid} to={`/members/${b.member_uid}`}
              className="card"
              style={{
                background: 'var(--white)', padding: 16, textDecoration: 'none',
                color: 'inherit', borderLeft: '4px solid var(--green)', display: 'block',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                <span style={{
                  fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                  borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                }}>
                  {categoryLabel(b.category)}
                </span>
                {b.distance != null && coords && (
                  <span style={{
                    fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                    padding: '2px 8px', borderRadius: 'var(--r-sm)',
                    background: 'rgba(200,134,10,0.12)', color: 'var(--amber)',
                  }}>
                    {b.distance.toFixed(1)} mi
                  </span>
                )}
              </div>

              <h3 style={{
                margin: '0 0 4px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)',
                color: 'var(--green)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {b.name}
              </h3>

              <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.45 }}>
                {b.description ?? 'A member business of the Lake & Locals network.'}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--muted)' }}>
                {b.address && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
                    <MapPin size={12} color="var(--sage)" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.address}</span>
                  </span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2, color: 'var(--amber)', fontWeight: 600, flexShrink: 0 }}>
                  View member page <ChevronRight size={12} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
