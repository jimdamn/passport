import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';

import { updateLocation } from '../api/profile';
import { MapPin, Compass, Utensils, ShoppingBag, Trees, Landmark, Hotel, Wheat, Briefcase, CalendarDays, ChevronRight } from 'lucide-react';

// A verified member business on the network - real data from KKAuth via the
// network-members endpoint. No fabricated ratings, coordinates, or samples.
interface Business {
  member_uid: number;
  name: string;
  category: string;      // mapped to a category slug below
  icon: string;
  description: string | null;
  address: string | null;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  website: string | null;
}

// Map a business's free-text category from KKAuth onto the browse slugs.
const CATEGORY_ICONS: Record<string, string> = {
  dining: '🍔', shopping: '🛍️', recreation: '🌲', attractions: '🏛️',
  lodging: '🏨', farmfood: '🌾', services: '💼',
};

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

// Canonical Steuben County & Angola, Indiana Region coordinates
const LOCAL_ZIP_COORDINATES: Record<string, { lat: number; lon: number; label: string }> = {
  '46703': { lat: 41.6348, lon: -84.9997, label: 'Angola, IN' },
  '46737': { lat: 41.7303, lon: -84.9316, label: 'Fremont, IN' },
  '46742': { lat: 41.5342, lon: -84.8916, label: 'Hamilton, IN' },
  '46747': { lat: 41.5317, lon: -85.0811, label: 'Hudson, IN' },
  '46706': { lat: 41.3653, lon: -85.0636, label: 'Auburn, IN' },
};

function getCoordinatesForZip(zip: string): { lat: number; lon: number; label: string } {
  const cleaned = zip.trim();
  if (LOCAL_ZIP_COORDINATES[cleaned]) {
    return LOCAL_ZIP_COORDINATES[cleaned];
  }
  // Generate a deterministic coordinate close to Angola, IN (46703) for other inputs
  let seed = 0;
  for (let i = 0; i < cleaned.length; i++) {
    seed = (seed << 5) - seed + cleaned.charCodeAt(i);
  }
  const latOffset = (Math.abs(seed % 100) / 500) - 0.1;
  const lonOffset = (Math.abs((seed >> 3) % 100) / 500) - 0.1;
  return {
    lat: 41.6348 + latOffset,
    lon: -84.9997 + lonOffset,
    label: `Area ${cleaned}`
  };
}

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

// (sample listings removed - the feed is real verified member businesses only)

export default function Explore() {
  const { user, updateUser } = useAuth();
  const { tenant } = useTenant();

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [zipInput, setZipInput] = useState<string>('');
  const [maxDistance, setMaxDistance] = useState<number>(25); // Default 25 miles
  const [dbMembers, setDbMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Synchronize filters with user preferences when user loads/changes
  useEffect(() => {
    if (user) {
      setZipInput(user.home_zip_location || '');
      setMaxDistance(user.home_distance_preference ?? 100);
    } else {
      setZipInput('46703'); // Angola, IN guest default
      setMaxDistance(25);
    }
  }, [user?.home_zip_location, user?.home_distance_preference]);

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

  // Live Location DB updates on the fly for registered users
  const handleZipChange = async (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 5);
    setZipInput(cleaned);

    if (user) {
      if (cleaned.length === 5 || cleaned === '') {
        try {
          const res = await updateLocation({
            home_zip_location: cleaned || null,
            home_distance_preference: cleaned ? maxDistance : null
          });
          const p = res.data.profile;
          updateUser({
            home_zip_location: p.home_zip_location,
            home_zip_lat: p.home_zip_lat,
            home_zip_lon: p.home_zip_lon,
            home_distance_preference: p.home_distance_preference,
          });
        } catch (err) {
          console.error('Failed to save ZIP preference:', err);
        }
      }
    }
  };

  const handleDistanceChange = async (d: number) => {
    setMaxDistance(d);

    if (user && zipInput.length === 5) {
      try {
        const res = await updateLocation({
          home_zip_location: zipInput,
          home_distance_preference: d
        });
        const p = res.data.profile;
        updateUser({
          home_zip_location: p.home_zip_location,
          home_zip_lat: p.home_zip_lat,
          home_zip_lon: p.home_zip_lon,
          home_distance_preference: p.home_distance_preference,
        });
      } catch (err) {
        console.error('Failed to save search-radius preference:', err);
      }
    }
  };

  // Handle location geocoding
  const activeZip = zipInput.trim() || '46703';
  const userCoords = getCoordinatesForZip(activeZip);

  // Real member businesses only - category from their own listing, real
  // coordinates when they share an address, nothing invented.
  const allListings: Business[] = dbMembers.map((m: any) => {
    const slug = categorySlug(m.category);
    return {
      member_uid: m.member_uid,
      name: m.name,
      category: slug,
      icon: CATEGORY_ICONS[slug] ?? '💼',
      description: m.description ?? null,
      address: m.address ?? null,
      zip: m.zip ?? null,
      lat: m.lat ?? null,
      lon: m.lon ?? null,
      phone: m.phone ?? null,
      website: m.website ?? null,
    };
  });

  // Distance only when the business shares real coordinates; members without
  // them are never distance-filtered out - they list after the located ones.
  const filteredListings = allListings
    .map(b => ({
      ...b,
      distance: b.lat != null && b.lon != null
        ? calculateDistance(userCoords.lat, userCoords.lon, b.lat, b.lon)
        : null,
    }))
    .filter(b => {
      if (selectedCategory !== 'all' && b.category !== selectedCategory) return false;
      if (zipInput.length === 5 && b.distance != null && b.distance > maxDistance) return false;
      return true;
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  const categories = [
    { slug: 'all', name: 'All Destinations', Icon: Compass },
    { slug: 'dining', name: 'Dining & Drinks', Icon: Utensils },
    { slug: 'shopping', name: 'Boutiques & Shops', Icon: ShoppingBag },
    { slug: 'recreation', name: 'Parks & Trails', Icon: Trees },
    { slug: 'attractions', name: 'Attractions', Icon: Landmark },
    { slug: 'lodging', name: 'Lodging & B&Bs', Icon: Hotel },
    { slug: 'farmfood', name: 'Farm & Fresh', Icon: Wheat },
    { slug: 'services', name: 'Services', Icon: Briefcase }
  ];

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Events live under Around Town — entry point into the Happenings page. */}
      <Link
        to="/happenings"
        className="card"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', marginBottom: 16,
          textDecoration: 'none', color: 'inherit',
          background: 'var(--white)', border: '1px solid var(--border)',
        }}
      >
        <CalendarDays size={22} color="var(--amber)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: '0.95rem' }}>Events &amp; Happenings</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>See what's going on around town</div>
        </div>
        <ChevronRight size={20} color="var(--amber)" style={{ flexShrink: 0 }} />
      </Link>

      {/* Search & Location Card (Matches the Premium Exchange Design!) */}
      <div className="card" style={{ padding: '20px', marginBottom: '24px', background: 'var(--white)' }}>
        <h1 className="page-title" style={{ marginBottom: 6, fontSize: '1.6rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
          Member Businesses
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 20 }}>
          The local businesses of the Lake &amp; Locals network. Visit their member pages
          to book an appointment, share your experience, or see what they offer.
        </p>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            {/* Location field */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 200px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--green)' }}>
                Selected Location (Zip)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  className="form-control"
                  value={zipInput}
                  onChange={e => handleZipChange(e.target.value)}
                  placeholder="e.g. 46703"
                  style={{ paddingLeft: 32, fontSize: '0.85rem', height: 38 }}
                />
                <MapPin size={15} color="var(--amber)" style={{ position: 'absolute', left: 10, top: 12 }} />
              </div>
            </div>

            {/* Distance Segment Control (Matching Exchange Design System!) */}
            {zipInput.length === 5 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '2 1 300px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--green)' }}>
                  Search Radius
                </label>
                <div className="seg-control" style={{ height: 38, display: 'flex', width: '100%' }}>
                  {[10, 25, 50, 100].map(d => (
                    <button
                      key={d}
                      type="button"
                      className={`seg-control-btn ${maxDistance === d ? 'active' : ''}`}
                      onClick={() => handleDistanceChange(d)}
                      style={{ fontSize: '0.8rem', flex: 1 }}
                    >
                      {d} mi
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category Picker horizontal carousel */}
      <div style={{ marginBottom: 20 }}>
        <p className="section-title" style={{ marginBottom: 10 }}>Categories</p>
        <div style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 8,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
        }}>
          {categories.map(cat => {
            const isSelected = selectedCategory === cat.slug;
            return (
              <button
                key={cat.slug}
                onClick={() => setSelectedCategory(cat.slug)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  background: isSelected ? 'var(--green)' : 'var(--white)',
                  border: isSelected ? '1px solid var(--green)' : '1px solid var(--border)',
                  borderRadius: '100px',
                  color: isSelected ? 'var(--white)' : 'var(--green)',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                <cat.Icon size={15} color={isSelected ? 'white' : 'var(--green)'} />
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Business Feed */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="section-title" style={{ margin: 0 }}>
          Network members near you ({filteredListings.length})
        </p>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>
          Sorted closest first
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '400px' }}>
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="card"
              style={{
                background: 'var(--white)',
                padding: '16px',
                height: '144px',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--r-md)',
                opacity: 0.5,
              }}
            />
          ))}
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 20px', background: 'var(--white)' }}>
          <div className="empty-state-icon">🧭</div>
          <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', fontSize: '1.15rem', marginBottom: 6 }}>
            No member businesses match
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', maxWidth: 280, margin: '0 auto 16px auto', lineHeight: 1.4 }}>
            The network is growing - try widening your search distance or clearing the
            category filter.
          </p>
          <button
            onClick={() => {
              setZipInput('46703');
              setMaxDistance(25);
              setSelectedCategory('all');
            }}
            className="btn btn-amber"
            style={{ minHeight: 38 }}
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredListings.map(b => (
            <Link
              key={b.member_uid}
              to={`/members/${b.member_uid}`}
              className="card"
              style={{
                background: 'var(--white)',
                padding: '16px',
                display: 'flex',
                gap: 16,
                position: 'relative',
                transition: 'transform 0.15s, box-shadow 0.15s',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {/* Category Icon box */}
              <div style={{
                width: 50,
                height: 50,
                background: 'rgba(200, 134, 10, 0.06)',
                borderRadius: 'var(--r-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                flexShrink: 0
              }}>
                {b.icon}
              </div>

              {/* Body */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header line */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <h3 style={{
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    margin: 0,
                    fontFamily: 'var(--font-serif)',
                    color: 'var(--green)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {b.name}
                  </h3>
                  {/* Distance badge - only when the business shares a location */}
                  {b.distance != null && (
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: 'var(--amber)',
                      background: 'rgba(200, 134, 10, 0.08)',
                      padding: '2px 8px',
                      borderRadius: '100px',
                      flexShrink: 0
                    }}>
                      {b.distance.toFixed(1)} mi
                    </span>
                  )}
                </div>

                {/* Verified member line */}
                <div style={{ fontSize: '0.72rem', color: 'var(--sage)', marginBottom: 8 }}>
                  Verified member business
                </div>

                {/* Description */}
                <p style={{
                  fontSize: '0.78rem',
                  color: 'var(--muted)',
                  lineHeight: '1.4',
                  margin: '0 0 12px 0'
                }}>
                  {b.description ?? 'A member business of the Lake & Locals network.'}
                </p>

                {/* Details Footer line */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: '0.7rem',
                  color: 'var(--muted)',
                  borderTop: '1px solid var(--border)',
                  paddingTop: 10,
                  flexWrap: 'wrap'
                }}>
                  {/* Phone and website live on the member page - the card
                      stays uncrowded on a phone: place, then the action. */}
                  {b.address && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
                      <MapPin size={12} color="var(--sage)" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.address}</span>
                    </div>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2, color: 'var(--amber)', fontWeight: 600, flexShrink: 0 }}>
                    View member page <ChevronRight size={12} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Premium Business CTA Banner */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, var(--green) 0%, #2c442e 100%)',
        color: 'var(--cream)',
        padding: '24px',
        borderRadius: 'var(--r-lg)',
        boxShadow: '0 4px 15px rgba(30, 51, 32, 0.15)',
        textAlign: 'center',
        marginTop: 12
      }}>
        <h3 style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '1.2rem',
          fontWeight: 'bold',
          marginBottom: 8,
          color: 'var(--white)'
        }}>
          Own a Regional Business or Organization?
        </h3>
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '0.8rem',
          lineHeight: '1.5',
          opacity: 0.9,
          maxWidth: 440,
          margin: '0 auto 16px auto'
        }}>
          Join {tenant?.config.brand_name || 'Lake & Locals'}, a KrowdKraft network! Get your own customized QR code, reward checked-in visitors with {tenant?.config.credits_name ?? 'KrowdKredits'}, and showcase your shop in our regional explore passport.
        </p>
        <Link
          to={user ? "/profile/apply-merchant" : "/auth/login?return_to=/profile/apply-merchant"}
          className="btn btn-amber"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 40,
            padding: '0 24px',
            fontWeight: 600
          }}
        >
          Register Your Business &rarr;
        </Link>
      </div>
    </div>
  );
}
