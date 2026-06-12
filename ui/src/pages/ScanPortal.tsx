import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { Spinner } from '../components/ui/Spinner';
import { MapPin } from 'lucide-react';

interface PlaqueData {
  name: string;
  location_name: string;
  category: string;
}

interface PrizeData {
  name: string;
  prize_type: string;
  value: number;
  details: string | null;
}

export default function ScanPortal() {
  const { token } = useAuth();
  const { tenant } = useTenant();
  const [searchParams] = useSearchParams();
  const plaqueId = searchParams.get('plaque') || searchParams.get('id');
  // HMAC signature baked into the printed QR link — the backend rejects
  // scans without it, so a hand-typed plaque id can't mint stamps.
  const sig = searchParams.get('sig');

  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'guest_win' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  // Geolocation states
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoDenied, setGeoDenied] = useState<boolean>(false);
  const [geoPrompting, setGeoPrompting] = useState<boolean>(true);

  // Roll result states
  const [plaque, setPlaque] = useState<PlaqueData | null>(null);
  const [prize, setPrize] = useState<PrizeData | null>(null);
  const [claimToken, setClaimToken] = useState<string>('');
  const [newBadges, setNewBadges] = useState<string[]>([]);

  // Claim registration states
  const [contactInfo, setContactInfo] = useState<string>('');
  const [registeringClaim, setRegisteringClaim] = useState<boolean>(false);
  const [claimRegistered, setClaimRegistered] = useState<boolean>(false);

  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  // Request browser geolocation with friendly rationale
  const requestLocation = () => {
    setGeoPrompting(true);
    setGeoDenied(false);

    if (!navigator.geolocation) {
      setErrorMessage("Your browser doesn't support geocoding, which is required to verify physical presence.");
      setStatus('error');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoCoords({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setGeoPrompting(false);
      },
      (error) => {
        console.warn('Geolocation access denied:', error);
        setGeoDenied(true);
        setGeoPrompting(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (!plaqueId || !sig) {
      setErrorMessage('This scan link is incomplete or invalid. Please re-scan the QR code with your camera.');
      setStatus('error');
      return;
    }
    requestLocation();
  }, [plaqueId, sig]);

  // Execute scan when coords are available
  useEffect(() => {
    if (geoCoords && plaqueId) {
      performScan();
    }
  }, [geoCoords]);

  const performScan = async () => {
    setStatus('scanning');

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/t/${tenant?.id}/passport/scan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          plaque_id: plaqueId,
          sig,
          lat: geoCoords?.lat,
          lon: geoCoords?.lon,
        }),
      });

      const json = (await res.json()) as {
        data?: {
          unlocked: boolean;
          claim_token?: string;
          plaque: PlaqueData;
          prize: PrizeData;
          user?: { balance: number; new_badges: string[] };
        };
        error?: string;
      };

      if (!res.ok) {
        throw new Error(json.error ?? 'An unexpected error occurred during the scan.');
      }

      const data = json.data;
      if (!data) throw new Error('Invalid response received from server.');

      setPlaque(data.plaque);
      setPrize(data.prize);

      if (data.unlocked) {
        setStatus('success');
        if (data.user) {
          setNewBadges(data.user.new_badges);
        }
      } else {
        setClaimToken(data.claim_token || '');
        setStatus('guest_win');
      }
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Failed to complete scan.');
      setStatus('error');
    }
  };

  const handleRegisterClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactInfo.trim()) return;

    setRegisteringClaim(true);
    try {
      const res = await fetch(`/api/t/${tenant?.id}/passport/claims/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_code: claimToken,
          contact_info: contactInfo.trim(),
        }),
      });

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to register your claim.');
      }

      setClaimRegistered(true);
    } catch (err: any) {
      alert(err.message || 'Failed to submit registration.');
    } finally {
      setRegisteringClaim(false);
    }
  };


  // Get Stamp Icon based on category
  const getStampIcon = (cat?: string) => {
    switch (cat?.toLowerCase()) {
      case 'dining': return '🍔';
      case 'shopping': return '🛍️';
      case 'farmfood': return '🌾';
      case 'recreation': return '🌲';
      case 'attractions': return '🏛️';
      case 'lodging': return '🏨';
      default: return '📍';
    }
  };

  return (
    <div className="main-content" style={{ maxWidth: 480, margin: '0 auto', paddingTop: 20 }}>
      {/* 1. Loading Geolocation Prompt */}
      {geoPrompting && (
        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div style={{
            fontSize: '3.5rem',
            marginBottom: 16,
            animation: 'pulse 1.5s infinite',
            willChange: 'transform',
            transform: 'translate3d(0, 0, 0)'
          }}>🧭</div>
          <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 8 }}>Verifying Location...</h2>
          <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 20 }}>
            To safeguard our community and prevent automated spam, we verify your physical presence near this location using secure browser coordinates.
          </p>
          <Spinner size="md" />
        </div>
      )}

      {/* 2. Geolocation Access Denied */}
      {geoDenied && (
        <div className="card" style={{ padding: '30px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--error)', marginBottom: 10 }}>Location Required</h2>
          <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 20 }}>
            KrowdKraft operates as a hyper-local trust network. To collect stamps and claim rewards in the wild, we must check that you are physically standing at the location. We do not track or save your continuous location history.
          </p>
          <button className="btn btn-primary btn-block" onClick={requestLocation}>
            <MapPin size={18} /> Enable Location Verification
          </button>
        </div>
      )}

      {/* 3. Scanning API Progress */}
      {status === 'scanning' && (
        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 16 }}>⚡</div>
          <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 8 }}>Rolling the Stamp...</h2>
          <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)', fontSize: '0.88rem', marginBottom: 20 }}>
            Contacting the regional credits matrix vault. Hold tight!
          </p>
          <Spinner size="md" />
        </div>
      )}

      {/* 4. Authenticated Success Win Screen (Pillar 3 & 4: Delighting the Explorer) */}
      {status === 'success' && plaque && prize && (
        <div style={{ textAlign: 'center', paddingBottom: 24 }}>
          {/* Animated SVG Ink Stamp */}
          <div style={{
            position: 'relative',
            width: 140,
            height: 140,
            margin: '20px auto 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              border: '4px dashed var(--sage)',
              borderRadius: '50%',
              background: 'rgba(80,120,80,0.06)',
              animation: 'spin 3s cubic-bezier(0.1, 0.8, 0.3, 1) 1 both',
              willChange: 'transform',
              transform: 'translate3d(0, 0, 0)',
            }} />
            <div style={{
              fontSize: '4.5rem',
              transform: 'rotate(-8deg)',
              animation: 'bounceIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) both',
              willChange: 'transform',
            }}>
              {getStampIcon(plaque.category)}
            </div>
            <div style={{
              position: 'absolute',
              bottom: 4,
              right: 4,
              background: 'var(--sage)',
              color: 'var(--white)',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 'bold',
              border: '3px solid var(--cream)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            }}>
              ✓
            </div>
          </div>

          <span className="badge badge-sage" style={{ marginBottom: 12 }}>★ Stamp Collected</span>
          <h1 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', fontSize: '1.8rem', margin: '0 0 4px 0' }}>
            {plaque.name}
          </h1>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', margin: '0 0 24px 0' }}>
            📍 {plaque.location_name}
          </p>

          {/* Reward Card */}
          <div className="card" style={{
            background: 'var(--white)',
            border: '2px solid var(--amber)',
            borderRadius: 'var(--r-lg)',
            padding: '24px 20px',
            position: 'relative',
            boxShadow: '0 4px 20px rgba(200,134,10,0.08)',
            marginBottom: 24,
          }}>
            <div style={{
              position: 'absolute',
              top: -12,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--amber)',
              color: 'var(--white)',
              padding: '2px 14px',
              borderRadius: 'var(--r-pill)',
              fontSize: '0.7rem',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Your Explorer Reward
            </div>

            <div style={{ fontSize: '2.2rem', marginBottom: 8 }}>🎁</div>
            <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', fontSize: '1.25rem', margin: '0 0 6px 0' }}>
              {prize.name}
            </h3>
            {prize.value > 0 && (
              <div className="credits-pill" style={{ fontSize: '0.95rem', padding: '6px 16px', margin: '4px auto 12px' }}>
                +{prize.value} {creditsName}
              </div>
            )}
            {prize.details && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.82rem', color: 'var(--muted)', background: 'var(--cream)', padding: '8px 12px', borderRadius: 'var(--r-sm)', margin: '10px 0 0 0', wordBreak: 'break-all' }}>
                Coupon Code: <strong>{prize.details}</strong>
              </p>
            )}
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)', margin: '12px 0 0 0', lineHeight: 1.4 }}>
              Thanks for supporting our independent main street stores! The prize has been linked to your regional wallet.
            </p>
          </div>

          {/* Badge Unlocked Notification */}
          {newBadges.length > 0 && (
            <div className="alert alert-success" style={{ textAlign: 'left', display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: '1.8rem' }}>🏆</div>
              <div>
                <strong style={{ display: 'block', fontSize: '0.9rem' }}>New Milestone Unlocked!</strong>
                <span style={{ fontSize: '0.78rem' }}>You earned the {newBadges.join(', ')} explorer badge. Check your passport to view it!</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <Link to="/my-stamps" className="btn btn-primary" style={{ flex: 1 }}>
              🗺️ My Passport Stamps
            </Link>
            <Link to="/" className="btn btn-secondary" style={{ flex: 1 }}>
              🏠 Back to Hub
            </Link>
          </div>
        </div>
      )}

      {/* 5. Unauthenticated Guest Win Screen (Pillar 2 & 3: Deferred Registration) */}
      {status === 'guest_win' && plaque && prize && (
        <div>
          <div style={{ textAlign: 'center', paddingBottom: 16 }}>
            <div style={{
              position: 'relative',
              width: 120,
              height: 120,
              margin: '10px auto 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                border: '3px dashed var(--amber)',
                borderRadius: '50%',
                background: 'rgba(200,134,10,0.04)',
                animation: 'spin 3s cubic-bezier(0.1, 0.8, 0.3, 1) 1 both',
                willChange: 'transform',
                transform: 'translate3d(0, 0, 0)',
              }} />
              <div style={{ fontSize: '4rem', transform: 'rotate(-6deg)' }}>
                {getStampIcon(plaque.category)}
              </div>
            </div>

            <span className="badge badge-amber" style={{ marginBottom: 8 }}>★ Winning Scan Unlocked</span>
            <h1 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', fontSize: '1.6rem', margin: '0 0 2px 0' }}>
              {plaque.name}
            </h1>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.82rem', color: 'var(--muted)', margin: '0 0 16px 0' }}>
              📍 {plaque.location_name}
            </p>
          </div>

          <div className="card" style={{ border: '2px solid var(--amber)', padding: '20px 16px', marginBottom: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>🎁</div>
              <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', fontSize: '1.15rem', margin: '0 0 4px 0' }}>
                {prize.name}
              </h3>
              {prize.value > 0 && (
                <span className="credits-pill">+{prize.value} {creditsName}</span>
              )}
            </div>

            {!claimRegistered ? (
              <form onSubmit={handleRegisterClaim} style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 14, lineHeight: 1.4 }}>
                  Enter your email or phone below. We'll lock this stamp into your temporary parade slot and queue a secure claim OTP so you don't lose your rewards!
                </p>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter email or phone number"
                    value={contactInfo}
                    onChange={(e) => setContactInfo(e.target.value)}
                    required
                    style={{ fontSize: '0.9rem', minHeight: 40 }}
                  />
                </div>
                <button type="submit" className="btn btn-amber btn-block" disabled={registeringClaim} style={{ minHeight: 40, fontSize: '0.9rem' }}>
                  {registeringClaim ? 'Securing Reward...' : 'Secure My Stamp & Credits'}
                </button>
              </form>
            ) : (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, textAlign: 'center' }}>
                <div style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '0.9rem', marginBottom: 6 }}>
                  ✓ Reward Slot Secured!
                </div>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.78rem', color: 'var(--muted)', margin: 0, lineHeight: 1.4 }}>
                  We've secured your claim token: <strong>{claimToken}</strong>. A verification link has been queued for <strong>{contactInfo}</strong>. Simply click it later to complete your free profile and deposit your earnings!
                </p>
              </div>
            )}
          </div>

          {/* Fallback Screenshot Box */}
          <div style={{
            background: 'var(--white)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '12px 14px',
            textAlign: 'center',
            marginBottom: 20,
          }}>
            <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 'bold', display: 'block', marginBottom: 2 }}>
              Fallback Claim Code
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--green)', letterSpacing: '0.05em' }}>
              {claimToken}
            </span>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.72rem', color: 'var(--muted)', margin: '4px 0 0 0' }}>
              Take a screenshot of this card as a backup.
            </p>
          </div>

          <div style={{ textAlign: 'center' }}>
            <Link to="/auth/login" style={{ fontSize: '0.85rem', fontWeight: 'bold', textDecoration: 'underline' }}>
              Already have an account? Sign In
            </Link>
          </div>
        </div>
      )}

      {/* 6. Friendly Errors (Cooldowns / Geofence Failures) */}
      {status === 'error' && (
        <div className="card" style={{ padding: '30px 20px', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>🗺️</div>
          <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 8, fontSize: '1.25rem' }}>
            Scan Check Status
          </h2>
          <div className="alert alert-info" style={{ textAlign: 'left', fontSize: '0.82rem', lineHeight: 1.5, margin: '16px 0 20px 0' }}>
            {errorMessage || 'Something didn\'t match. Please try standing closer to the QR code and retry.'}
          </div>
          
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={requestLocation} style={{ flex: 1, fontSize: '0.88rem' }}>
              🔄 Retry Scan
            </button>
            <Link to="/my-stamps" className="btn btn-secondary" style={{ flex: 1, fontSize: '0.88rem' }}>
              🗺️ My Stamps
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
