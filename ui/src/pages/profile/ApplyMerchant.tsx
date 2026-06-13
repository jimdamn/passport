import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { applyMerchant } from '../../api/profile';
import { ArrowLeft, Store, Navigation, MapPin } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';

const CATEGORIES = [
  { value: 'dining', label: 'Dining & Drinks (Cafes, Bistros)' },
  { value: 'shopping', label: 'Boutiques & Shops (Retail, Local Goods)' },
  { value: 'recreation', label: 'Parks & Recreation (Trails, Rentals)' },
  { value: 'attractions', label: 'Attractions (Historic sites, Toboggan)' },
  { value: 'lodging', label: 'Lodging & B&Bs (Historic Inns, Hotels)' },
  { value: 'farmfood', label: 'Farm & Fresh (Orchards, Farm stands)' },
  { value: 'services', label: 'Services (Professionals, Contractors, Specialists)' },
];

export default function ApplyMerchant() {
  const { user, updateUser } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    category: 'dining',
    description: '',
    address: '',
    zip: '',
    phone: '',
    website: '',
    lat: '',
    lon: '',
    hide_address: false,
    hide_phone: false,
  });

  const [locationMethod, setLocationMethod] = useState<'zip' | 'gps' | 'search'>('zip');
  const [searchAddress, setSearchAddress] = useState('');
  const [geocodingPending, setGeocodingPending] = useState(false);
  const [geocodedDisplayName, setGeocodedDisplayName] = useState('');
  const [isMobile] = useState(() => {
    return /Mobi|Android|iPhone/i.test(navigator.userAgent);
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  if (!user) {
    return (
      <div className="main-content" style={{ paddingTop: 40, maxWidth: 500, margin: '0 auto' }}>
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ marginBottom: 16 }}>You must be logged in to apply for a merchant profile.</p>
          <a className="btn btn-primary" href="/auth/login">Sign In</a>
        </div>
      </div>
    );
  }

  const handleSelectMethod = (method: 'zip' | 'gps' | 'search') => {
    setLocationMethod(method);
    setError('');
    // Clear lat/lon states to start fresh on change
    setForm(f => ({ ...f, lat: '', lon: '' }));
    setGeocodedDisplayName('');
  };

  const handleCaptureGps = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setGeocodingPending(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm(f => ({
          ...f,
          lat: position.coords.latitude.toString(),
          lon: position.coords.longitude.toString(),
        }));
        setGeocodedDisplayName('Mobile Hardware GPS Capture');
        setGeocodingPending(false);
      },
      (err) => {
        setError(err.code === 1 ? 'Location access was denied. Please allow location access and try again.' : 'Failed to capture GPS telemetry. Please try again.');
        setGeocodingPending(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleSearchAddress = async () => {
    const addr = searchAddress.trim();
    if (!addr) {
      setError('Please enter a street address to search.');
      return;
    }
    setGeocodingPending(true);
    setError('');
    try {
      // US Census Geocoder — handles rural county road formats well
      const censusRes = await fetch(
        `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addr)}&benchmark=2020&format=json`
      );
      if (censusRes.ok) {
        const censusData = await censusRes.json() as any;
        const matches = censusData?.result?.addressMatches;
        if (matches && matches.length > 0) {
          const match = matches[0];
          setForm(f => ({
            ...f,
            lat: match.coordinates.y.toString(),
            lon: match.coordinates.x.toString(),
          }));
          setGeocodedDisplayName(match.matchedAddress);
          return;
        }
      }

      // Fallback: Nominatim
      const nomRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1&countrycodes=us`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (nomRes.ok) {
        const nomData = await nomRes.json() as any[];
        if (nomData && nomData.length > 0) {
          setForm(f => ({
            ...f,
            lat: nomData[0].lat,
            lon: nomData[0].lon,
          }));
          setGeocodedDisplayName(nomData[0].display_name);
          return;
        }
      }

      throw new Error('Address not found. Make sure to include city and state (e.g. 1255 N 170 W, Angola, IN).');
    } catch (err: any) {
      setError(err.message || 'Geocoding search failed. Please try again.');
    } finally {
      setGeocodingPending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setPending(true);

    if (form.zip && !/^\d{5}$/.test(form.zip)) {
      setError('Please enter a valid 5-digit zip code.');
      setPending(false);
      return;
    }

    try {
      const res = await applyMerchant({
        name: form.name.trim(),
        category: form.category,
        description: form.description.trim() || undefined,
        address: form.address.trim() || undefined,
        zip: form.zip.trim() || undefined,
        phone: form.phone.trim() || undefined,
        website: form.website.trim() || undefined,
        lat: form.lat ? parseFloat(form.lat) : undefined,
        lon: form.lon ? parseFloat(form.lon) : undefined,
        hide_address: form.hide_address || undefined,
        hide_phone: form.hide_phone || undefined,
      });

      setSuccess(true);
      
      if (res.data) {
        updateUser({
          business_id: res.data.id,
          business_status: 'pending',
          business_name: res.data.name,
        });
      }

      setTimeout(() => {
        navigate('/profile');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to submit merchant application.');
    } finally {
      setPending(false);
    }
  };

  const brandName = tenant?.config.brand_name ?? 'Lake & Locals';
  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  return (
    <div className="main-content" style={{ maxWidth: 540, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      {/* Back button */}
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="card" style={{ background: 'var(--white)', padding: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, background: 'rgba(200,134,10,0.08)', borderRadius: 'var(--r-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--amber)'
          }}>
            <Store size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
              Become a Network Partner
            </h1>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>
              Showcase your business in our explore passport directory
            </p>
          </div>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.5, marginBottom: 20 }}>
          Join the local {brandName} community. Registered merchant profiles can attract customers, reward checked-in visitors with {creditsName}, and gain premium exposure on the explore network. Applications are reviewed within 24 hours.
        </p>

        {success && <Alert type="success" style={{ marginBottom: 16 }}>Application submitted successfully! Redirecting...</Alert>}
        {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Name */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Business or Org Name *</label>
            <input
              type="text"
              className="form-input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Angola Woolen Mill Stand"
              required
              disabled={pending}
              style={{ minHeight: 38 }}
            />
          </div>

          {/* Category Selector */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Business Type *</label>
            <select
              className="form-select"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              disabled={pending}
              style={{ minHeight: 38, width: '100%' }}
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Short Description</label>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Tell visitors what makes your place special, opening hours, or checks details..."
              disabled={pending}
              rows={3}
            />
          </div>

          {/* Coordinates Verification Layer */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Configure Storefront Coordinates *</label>
            <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>
              Set precise physical coordinates so customers can scan and check-in when visiting your storefront.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {isMobile && (
                <button
                  type="button"
                  className={`btn btn-sm ${locationMethod === 'gps' ? 'btn-amber' : 'btn-secondary'}`}
                  onClick={() => handleSelectMethod('gps')}
                  disabled={pending}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 38, fontSize: '0.82rem' }}
                >
                  <Navigation size={14} /> 📍 Pin Current Storefront GPS Location (Mobile)
                </button>
              )}

              <button
                type="button"
                className={`btn btn-sm ${locationMethod === 'search' ? 'btn-amber' : 'btn-secondary'}`}
                onClick={() => handleSelectMethod('search')}
                disabled={pending}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 38, fontSize: '0.82rem' }}
              >
                <Store size={14} /> 🔍 Search Store Street Address (Explicit)
              </button>

              <button
                type="button"
                className={`btn btn-sm ${locationMethod === 'zip' ? 'btn-amber' : 'btn-secondary'}`}
                onClick={() => handleSelectMethod('zip')}
                disabled={pending}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 38, fontSize: '0.82rem' }}
              >
                <MapPin size={14} /> 🌐 Fallback to ZIP Code Center (Approximate)
              </button>
            </div>

            {/* Sub-panes based on selected method */}
            {locationMethod === 'gps' && (
              <div style={{ background: 'var(--cream)', padding: 14, borderRadius: 'var(--r-md)', border: '1px solid var(--border)', textAlign: 'center' }}>
                <p style={{ fontSize: '0.82rem', marginBottom: 10, fontFamily: 'var(--font-sans)', color: 'var(--muted)', lineHeight: 1.45 }}>
                  Query your phone's hardware GPS chip standing physically in your storefront.
                </p>
                <button
                  type="button"
                  className="btn btn-green btn-sm"
                  onClick={handleCaptureGps}
                  disabled={geocodingPending || pending}
                  style={{ minHeight: 34 }}
                >
                  {geocodingPending ? 'Accessing GPS...' : 'Capture GPS Coordinates'}
                </button>
              </div>
            )}

            {locationMethod === 'search' && (
              <div style={{ background: 'var(--cream)', padding: 14, borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.82rem', marginBottom: 10, fontFamily: 'var(--font-sans)', color: 'var(--muted)', lineHeight: 1.45 }}>
                  Type your storefront address and click the button to resolve exact coordinates.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="form-input"
                    value={searchAddress}
                    onChange={e => setSearchAddress(e.target.value)}
                    placeholder="e.g. 1255 N 170 W, Angola, IN"
                    style={{ minHeight: 36, margin: 0, flex: 1, fontSize: '0.85rem' }}
                    disabled={pending}
                  />
                  <button
                    type="button"
                    className="btn btn-green btn-sm"
                    onClick={handleSearchAddress}
                    disabled={geocodingPending || pending}
                    style={{ whiteSpace: 'nowrap', minHeight: 36 }}
                  >
                    {geocodingPending ? 'Locating...' : 'Locate Store'}
                  </button>
                </div>
              </div>
            )}

            {locationMethod === 'zip' && (
              <div style={{ background: 'var(--cream)', padding: 14, borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.82rem', margin: 0, fontFamily: 'var(--font-sans)', color: 'var(--muted)', lineHeight: 1.45 }}>
                  Your coordinates will fallback to the geometric center of your 5-digit ZIP code. (Note: Geofence check-ins will be less precise for clients).
                </p>
              </div>
            )}

            {/* Coordinate Status Layer */}
            {(form.lat || form.lon) && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(42,106,42,0.05)', border: '1px solid rgba(42,106,42,0.18)', borderRadius: 'var(--r-sm)', fontSize: '0.82rem', color: 'var(--success)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontWeight: 'bold' }}>📍 Storefront Coordinates Locked:</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>Latitude: {Number(form.lat).toFixed(6)} | Longitude: {Number(form.lon).toFixed(6)}</div>
                {geocodedDisplayName && <div style={{ fontSize: '0.74rem', marginTop: 2, color: 'var(--muted)' }}>Resolved Match: {geocodedDisplayName}</div>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Address */}
            <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Street Address</label>
              <input
                type="text"
                className="form-input"
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="e.g. 200 Public Sq"
                disabled={pending}
                style={{ minHeight: 38 }}
              />
            </div>

            {/* ZIP */}
            <div className="form-group" style={{ margin: 0, flex: '0 0 120px' }}>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>ZIP Code</label>
              <input
                type="text"
                className="form-input"
                value={form.zip}
                onChange={e => setForm(f => ({ ...f, zip: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                placeholder="e.g. 46703"
                disabled={pending}
                style={{ minHeight: 38 }}
              />
            </div>
          </div>

          {/* Home-based business address privacy */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', background: 'var(--cream)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <input
              type="checkbox"
              checked={form.hide_address}
              onChange={e => setForm(f => ({ ...f, hide_address: e.target.checked }))}
              disabled={pending}
              style={{ marginTop: 2, accentColor: 'var(--green)', flexShrink: 0 }}
            />
            <span style={{ fontSize: '0.82rem', color: 'var(--body)', lineHeight: 1.45 }}>
              <strong>Home-based business</strong> — keep my street address private. Only my city/ZIP will be shown publicly.
            </span>
          </label>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Phone */}
            <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Contact Phone</label>
              <input
                type="tel"
                className="form-input"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. (260) 555-0199"
                disabled={pending}
                style={{ minHeight: 38 }}
              />
            </div>

            {/* Website */}
            <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Website URL</label>
              <input
                type="url"
                className="form-input"
                value={form.website}
                onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                placeholder="e.g. https://mybiz.com"
                disabled={pending}
                style={{ minHeight: 38 }}
              />
            </div>
          </div>

          {/* Phone privacy */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', background: 'var(--cream)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <input
              type="checkbox"
              checked={form.hide_phone}
              onChange={e => setForm(f => ({ ...f, hide_phone: e.target.checked }))}
              disabled={pending}
              style={{ marginTop: 2, accentColor: 'var(--green)', flexShrink: 0 }}
            />
            <span style={{ fontSize: '0.82rem', color: 'var(--body)', lineHeight: 1.45 }}>
              <strong>Personal phone</strong> — keep my phone number private. It will not be shown on public listings.
            </span>
          </label>

          <button type="submit" className="btn btn-amber btn-block" disabled={pending || success} style={{ minHeight: 40, marginTop: 8 }}>
            {pending ? 'Submitting Application...' : 'Submit Application'}
          </button>
        </form>
      </div>
    </div>
  );
}
