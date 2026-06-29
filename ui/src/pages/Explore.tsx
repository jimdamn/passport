import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';

import { updateLocation } from '../api/profile';
import { MapPin, Star, Phone, Globe, Compass, Utensils, ShoppingBag, Trees, Landmark, Hotel, Wheat, Briefcase, CalendarDays, ChevronRight } from 'lucide-react';

interface Business {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  address: string;
  zip: string;
  lat: number;
  lon: number;
  rating: number;
  reviewsCount: number;
  creditsToEarn: number;
  phone?: string;
  website?: string;
  isLive?: boolean;
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

const SAMPLE_BUSINESSES: Business[] = [
  {
    id: 'sb-bistro',
    name: 'Angola Lakeside Bistro',
    category: 'dining',
    icon: '🍔',
    description: 'Scenic bistro with a lakeside deck, craft beers, and farm-to-table seasonal specials.',
    address: '200 Public Sq, Angola, IN',
    zip: '46703',
    lat: 41.6348,
    lon: -84.9997,
    rating: 4.8,
    reviewsCount: 124,
    creditsToEarn: 15,
    phone: '(260) 555-0143',
    website: 'https://lakesidebistro.example.com'
  },
  {
    id: 'sb-mill',
    name: 'Steuben Woolen Mill Boutique',
    category: 'shopping',
    icon: '🛍️',
    description: 'Locally made woolen goods, curated apparel, and unique gifts from regional artisans.',
    address: '305 N Wayne St, Angola, IN',
    zip: '46703',
    lat: 41.6360,
    lon: -85.0010,
    rating: 4.9,
    reviewsCount: 86,
    creditsToEarn: 10,
    phone: '(260) 555-0187',
    website: 'https://steubenboutique.example.com'
  },
  {
    id: 'sb-trail',
    name: 'Pokagon State Park & Trails',
    category: 'recreation',
    icon: '🌲',
    description: 'Beautiful gorges, hiking trails, and majestic lake views. Scan the post at the overlook!',
    address: '450 Lane 100 Lake James, Angola, IN',
    zip: '46703',
    lat: 41.7100,
    lon: -84.9850,
    rating: 4.7,
    reviewsCount: 54,
    creditsToEarn: 5,
    website: 'https://pokagon.example.gov'
  },
  {
    id: 'sb-orchards',
    name: 'Hudson Valley Orchard Stand',
    category: 'farmfood',
    icon: '🌾',
    description: 'Pick-your-own apples, fresh organic cider, and homemade pumpkin donuts.',
    address: '750 State Rd 4, Hudson, IN',
    zip: '46747',
    lat: 41.5317,
    lon: -85.0811,
    rating: 4.6,
    reviewsCount: 92,
    creditsToEarn: 10,
    phone: '(260) 555-0210'
  },
  {
    id: 'sb-bnb',
    name: 'Potawatomi Inn at Lake James',
    category: 'lodging',
    icon: '🏨',
    description: 'Charming historic inn with cozy rooms, full gourmet breakfasts, and garden lake pathways.',
    address: '6 Potawatomi Dr, Angola, IN',
    zip: '46737',
    lat: 41.7120,
    lon: -84.9860,
    rating: 4.9,
    reviewsCount: 38,
    creditsToEarn: 25,
    phone: '(260) 555-0155',
    website: 'https://potawatomiinn.example.com'
  },
  {
    id: 'sb-cider',
    name: 'Fremont Cider Barn',
    category: 'dining',
    icon: '🍎',
    description: 'Artisan hard cider tastings, local charcuterie boards, and sweeping farm vistas.',
    address: '505 W Toledo St, Fremont, IN',
    zip: '46737',
    lat: 41.7303,
    lon: -84.9316,
    rating: 4.8,
    reviewsCount: 156,
    creditsToEarn: 15,
    phone: '(260) 555-0199'
  },
  {
    id: 'sb-kayak',
    name: 'Lake James Paddleboards',
    category: 'recreation',
    icon: '🛶',
    description: 'Kayak, paddleboard, and canoe rentals for exploring the beautiful Lake James coastline.',
    address: '290 Lane 200 Lake James, Angola, IN',
    zip: '46703',
    lat: 41.6850,
    lon: -85.0120,
    rating: 4.5,
    reviewsCount: 42,
    creditsToEarn: 10
  },
  {
    id: 'sb-overlook',
    name: 'Pokagon Toboggan & Overlook',
    category: 'attractions',
    icon: '🏛️',
    description: 'Stunning panoramic views of the entire valley and lake. Famous refrigerated toboggan stop.',
    address: '1 Pokagon Overlook Rd, Angola, IN',
    zip: '46737',
    lat: 41.7080,
    lon: -84.9810,
    rating: 4.7,
    reviewsCount: 73,
    creditsToEarn: 5
  }
];

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

  // Fetch live network members from D1 database
  useEffect(() => {
    const fetchDbMembers = async () => {
      try {
        setLoading(true);
        const tenantId = tenant?.id || 'lake-locals';
        const res = await fetch(`/api/t/${tenantId}/passport/members`);
        if (res.ok) {
          const json = await res.json() as { data: any[] };
          setDbMembers(json.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch D1 directory members:', err);
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

  // Map D1 members to our business listings structure
  const mappedDbMembers: Business[] = dbMembers.map((m, index) => {
    // Deterministically assign categories/icons to D1 users based on display name or index
    const categoriesList = ['dining', 'shopping', 'recreation', 'attractions', 'lodging', 'farmfood'];
    const iconsList = ['🍔', '🛍️', '🌲', '🏛️', '🏨', '🌾'];
    const catIndex = Math.abs(m.id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)) % categoriesList.length;

    // Resolve lat/lon deterministically close to the user's current location or predefined zips
    const offsetSeed = index + 1;
    const latOffset = (offsetSeed * 0.015) - 0.03;
    const lonOffset = (offsetSeed * 0.02) - 0.04;

    return {
      id: m.id,
      name: m.display_name,
      category: categoriesList[catIndex],
      icon: iconsList[catIndex],
      description: m.bio || 'Active regional member contributing to local commerce and community trade.',
      address: m.location || 'Tri-State Lakes Region',
      zip: activeZip,
      lat: userCoords.lat + latOffset,
      lon: userCoords.lon + lonOffset,
      rating: m.rating_avg > 0 ? parseFloat(m.rating_avg.toFixed(1)) : 4.7,
      reviewsCount: m.rating_count || 12,
      creditsToEarn: 10,
      isLive: true
    };
  });

  // Combine live D1 members and high-fidelity sample listings
  const allListings = [...mappedDbMembers, ...SAMPLE_BUSINESSES];

  // Calculate distances and filter the list
  const filteredListings = allListings
    .map(b => {
      const distance = calculateDistance(userCoords.lat, userCoords.lon, b.lat, b.lon);
      return { ...b, distance };
    })
    .filter(b => {
      // 1. Category check
      if (selectedCategory !== 'all' && b.category !== selectedCategory) {
        return false;
      }
      // 2. Distance check (if zipInput is exactly 5 digits)
      if (zipInput.length === 5 && b.distance > maxDistance) {
        return false;
      }
      return true;
    })
    // Sort closest first
    .sort((a, b) => a.distance - b.distance);

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
          Explore Regional Partners
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 20 }}>
          Check in at boutique shops, farm stands, and scenic vistas to collect stamps and earn KrowdKredits.
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
          Local Partners Near You ({filteredListings.length})
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
            No Partners Found
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', maxWidth: 280, margin: '0 auto 16px auto', lineHeight: 1.4 }}>
            Try increasing your search distance or enter a local regional zip code (like <strong style={{ color: 'var(--amber)' }}>46703</strong>).
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
            <div
              key={b.id}
              className="card"
              style={{
                background: 'var(--white)',
                padding: '16px',
                display: 'flex',
                gap: 16,
                position: 'relative',
                transition: 'transform 0.15s, box-shadow 0.15s',
                cursor: 'default'
              }}
            >
              {/* Category Icon box */}
              <div style={{
                width: 50,
                height: 50,
                background: b.isLive ? 'rgba(30, 51, 32, 0.06)' : 'rgba(200, 134, 10, 0.06)',
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
                  {/* Distance badge */}
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
                </div>

                {/* Rating row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 1 }}>
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        size={11}
                        fill={i < Math.floor(b.rating) ? 'var(--amber)' : 'none'}
                        color="var(--amber)"
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--green)' }}>
                    {b.rating}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                    ({b.reviewsCount} reviews)
                  </span>
                  {b.isLive && (
                    <span style={{
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      color: 'var(--green)',
                      background: 'rgba(30, 51, 32, 0.06)',
                      padding: '1px 5px',
                      borderRadius: 3,
                      marginLeft: 4
                    }}>
                      LIVE MEMBER
                    </span>
                  )}
                </div>

                {/* Description */}
                <p style={{
                  fontSize: '0.78rem',
                  color: 'var(--muted)',
                  lineHeight: '1.4',
                  margin: '0 0 12px 0'
                }}>
                  {b.description}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={12} color="var(--sage)" />
                    <span>{b.address}</span>
                  </div>
                  {b.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Phone size={11} color="var(--sage)" />
                      <span>{b.phone}</span>
                    </div>
                  )}
                  {b.website && (
                    <a
                      href={b.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: 'var(--amber)',
                        textDecoration: 'none',
                        fontWeight: 600
                      }}
                    >
                      <Globe size={11} />
                      <span>Website</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subtle Disclaimer */}
      <p style={{
        fontSize: '0.72rem',
        color: 'var(--muted)',
        fontStyle: 'italic',
        textAlign: 'center',
        marginTop: 20,
        marginBottom: 24,
        lineHeight: 1.4,
        maxWidth: 500,
        marginLeft: 'auto',
        marginRight: 'auto'
      }}>
        * Regional partner destinations marked as examples are simulated to demonstrate KrowdKraft integration. Coordinates and distance metrics are calculated dynamically relative to your selected ZIP location.
      </p>

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
