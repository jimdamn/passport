import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { Lock } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';



interface Stamp {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
  count: number;
}

interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
}

const EXAMPLE_STAMPS: Stamp[] = [
  {
    id: 'pass-dining',
    name: 'Dining & Drinks',
    icon: '🍔',
    description: 'Scanned at restaurants, cafes, and breweries.',
    unlocked: true,
    count: 3,
  },
  {
    id: 'pass-shopping',
    name: 'Boutiques & Shops',
    icon: '🛍️',
    description: 'Scanned at local boutiques, markets, and retail shops.',
    unlocked: true,
    count: 1,
  },
  {
    id: 'pass-farmfood',
    name: 'Farm & Fresh Food',
    icon: '🌾',
    description: 'Scanned at farm stands, orchards, and CSAs.',
    unlocked: true,
    count: 2,
  },
  {
    id: 'pass-recreation',
    name: 'Parks & Recreation',
    icon: '🌲',
    description: 'Scanned at state parks, nature preserves, and trails.',
    unlocked: false,
    count: 0,
  },
  {
    id: 'pass-attractions',
    name: 'Local Attractions',
    icon: '🏛️',
    description: 'Scanned at museums, galleries, and historic landmarks.',
    unlocked: false,
    count: 0,
  },
  {
    id: 'pass-lodging',
    name: 'Lodging & B&Bs',
    icon: '🏨',
    description: 'Scanned at local inns, boutique hotels, and B&Bs.',
    unlocked: false,
    count: 0,
  },
];

const EXAMPLE_BADGES: Badge[] = [
  {
    id: 'welcome',
    name: 'Welcome Explorer',
    icon: '👋',
    description: 'Joined the regional KrowdKraft network.',
    unlocked: true,
  },
  {
    id: 'first-scan',
    name: 'First Scan',
    icon: '🔍',
    description: 'Scanned your first physical stamp in the wild.',
    unlocked: true,
  },
  {
    id: 'earned-100',
    name: 'Century Club',
    icon: '💯',
    description: 'Earned 100 KrowdKredits across the network.',
    unlocked: true,
  },
  {
    id: 'local-anchor',
    name: 'Local Anchor',
    icon: '⚓',
    description: 'Recognized as a trusted local contributor.',
    unlocked: false,
  },
  {
    id: 'five-star',
    name: 'Perfect Explorer',
    icon: '🌟',
    description: 'Maintained a flawless rating across all activities.',
    unlocked: false,
  },
  {
    id: 'earned-1000',
    name: 'Grand Explorer',
    icon: '🏆',
    description: 'Earned 1,000 KrowdKredits total.',
    unlocked: false,
  },
];

function ExampleDisclaimer() {
  return (
    <div style={{
      background: 'rgba(200,134,10,0.08)',
      border: '1px dashed var(--amber)',
      borderRadius: 'var(--r-sm)',
      padding: '12px 16px',
      marginBottom: 24,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.2rem', flexShrink: 0, lineHeight: 1 }}>📋</span>
      <p style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '0.82rem',
        color: 'var(--amber)',
        margin: 0,
        lineHeight: 1.5,
        fontWeight: 600,
      }}>
        Example data shown below — your real activity will appear here once you have scanned stamps and unlocked badges on the platform.
      </p>
    </div>
  );
}

export default function MyStamps() {
  const { user, token } = useAuth();
  const { tenant } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'stamps' | 'badges'>('stamps');

  // Real data state
  const [realScans, setRealScans] = useState<any[]>([]);
  const [realBadges, setRealBadges] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Claim deposit state (guest win → account)
  const claimFromUrl = searchParams.get('claim') || '';
  const [claimCode, setClaimCode] = useState<string>(claimFromUrl);
  const [depositing, setDepositing] = useState<boolean>(false);
  const [depositResult, setDepositResult] = useState<{ ok: boolean; message: string } | null>(null);
  const autoDeposited = useRef(false);

  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  useEffect(() => {
    if (user && token && tenant) {
      fetchStampsData();
    } else if (!user) {
      // Signed-out visitors shouldn't sit on the spinner forever
      setLoading(false);
    }
  }, [user, token, tenant]);

  // Auto-deposit when arriving from the win screen or claim email (?claim=LL-XXXX)
  useEffect(() => {
    if (user && token && tenant && claimFromUrl && !autoDeposited.current) {
      autoDeposited.current = true;
      depositClaim(claimFromUrl);
    }
  }, [user, token, tenant, claimFromUrl]);

  const depositClaim = async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setDepositing(true);
    setDepositResult(null);
    try {
      const res = await fetch(`/api/t/${tenant?.id}/passport/claims/attach`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ claim_code: trimmed }),
      });
      const json = (await res.json()) as { data?: { message: string }; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Could not deposit that claim code.');

      setDepositResult({ ok: true, message: json.data?.message ?? 'Deposited!' });
      setClaimCode('');
      // Clear the URL param so a refresh doesn't retry, then reload stamps
      if (claimFromUrl) setSearchParams({}, { replace: true });
      fetchStampsData();
    } catch (err: any) {
      setDepositResult({ ok: false, message: err.message || 'Could not deposit that claim code.' });
    } finally {
      setDepositing(false);
    }
  };

  const fetchStampsData = async () => {
    try {
      const res = await fetch(`/api/t/${tenant?.id}/passport/stamps`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = (await res.json()) as { data: { scans: any[]; badges: any[] } };
        setRealScans(json.data.scans || []);
        setRealBadges(json.data.badges || []);
      }
    } catch (err) {
      console.error('Failed to load real stamps history:', err);
    } finally {
      setLoading(false);
    }
  };


  if (loading) {
    return (
      <div className="spinner-center" style={{ minHeight: '60vh' }}>
        <Spinner size="md" />
      </div>
    );
  }

  if (!user) {
    const loginTo = claimFromUrl
      ? `/auth/login?return_to=${encodeURIComponent(`/my-stamps?claim=${claimFromUrl}`)}`
      : '/auth/login';

    return (
      <div style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center', padding: '0 16px' }}>
        <div style={{ fontSize: '3rem', marginBottom: 16 }}>🗺️</div>
        <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 10 }}>My Passport Stamps</h2>
        <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)', marginBottom: 20, fontSize: '0.9rem', lineHeight: 1.5 }}>
          {claimFromUrl
            ? `You have a winning claim code ready to deposit! Sign in (or create your free passport) and we'll add it to your account automatically.`
            : 'Sign in to view your collected stamps, track your exploration milestones, and view earned badges.'}
        </p>
        <Link to={loginTo} className="btn btn-primary btn-block">
          {claimFromUrl ? 'Sign In & Deposit My Win' : 'Sign In'}
        </Link>
      </div>
    );
  }

  // Determine if user has any real activity on the platform
  const hasRealData = realScans.length > 0 || realBadges.length > 0;

  // Build the dynamic stamps list by combining real counts with the example categories
  const stamps = EXAMPLE_STAMPS.map(stamp => {
    if (!hasRealData) return stamp;
    const catName = stamp.id.replace('pass-', '');
    const matchingScans = realScans.filter(s => s.category?.toLowerCase() === catName.toLowerCase());
    return {
      ...stamp,
      unlocked: matchingScans.length > 0,
      count: matchingScans.length,
    };
  });

  // Build the dynamic badges list by checking user's unlocked badges from KKCredits
  const badges = EXAMPLE_BADGES.map(badge => {
    if (!hasRealData) return badge;
    const isUnlocked = realBadges.some(b => b.slug === badge.id);
    return {
      ...badge,
      unlocked: isUnlocked,
    };
  });

  return (
    <div className="main-content" style={{ paddingTop: 24, paddingBottom: 80 }}>
      {/* Title */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title" style={{ margin: '0 0 4px 0' }}>My Passport</h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', margin: 0 }}>
          Track your regional exploration, collected stamps, and earned milestones.
        </p>
      </div>

      {/* Claim Code Deposit */}
      <div className="card" style={{ padding: '16px 16px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: '1.2rem' }}>🎟️</span>
          <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', fontSize: '1rem', margin: 0 }}>
            Have a claim code?
          </h3>
        </div>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--muted)', margin: '0 0 12px 0', lineHeight: 1.4 }}>
          Won before you had an account? Enter the code from your win screen or email — {creditsName} deposit instantly, and physical prizes get linked to your name.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); depositClaim(claimCode); }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            type="text"
            className="form-input"
            placeholder="LL-XXXXXXXX"
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
            style={{ flex: 1, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em', minHeight: 40 }}
          />
          <button type="submit" className="btn btn-amber" disabled={depositing || !claimCode.trim()} style={{ minHeight: 40, whiteSpace: 'nowrap' }}>
            {depositing ? 'Depositing...' : 'Deposit'}
          </button>
        </form>
        {depositResult && (
          <div
            className={`alert ${depositResult.ok ? 'alert-success' : 'alert-error'}`}
            style={{ marginTop: 12, marginBottom: 0, fontSize: '0.82rem' }}
          >
            {depositResult.ok ? '✓ ' : ''}{depositResult.message}
          </div>
        )}
      </div>

      {/* Example Disclaimer */}
      {!hasRealData && <ExampleDisclaimer />}

      {/* Tabs */}
      <div className="seg-control" style={{ marginBottom: 24 }}>
        <button
          className={`seg-control-btn ${activeTab === 'stamps' ? 'active' : ''}`}
          onClick={() => setActiveTab('stamps')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <span>📍</span> Stamps ({stamps.filter(s => s.unlocked).length})
        </button>
        <button
          className={`seg-control-btn ${activeTab === 'badges' ? 'active' : ''}`}
          onClick={() => setActiveTab('badges')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <span>🏆</span> Badges ({badges.filter(b => b.unlocked).length})
        </button>
      </div>


      {/* Tab Contents: Stamps */}
      {activeTab === 'stamps' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}>
            {EXAMPLE_STAMPS.map(stamp => (
              <div
                key={stamp.id}
                style={{
                  background: 'var(--white)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  padding: '20px 16px',
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  position: 'relative',
                  opacity: stamp.unlocked ? 1 : 0.65,
                  boxShadow: stamp.unlocked ? '0 2px 8px rgba(0,0,0,0.04)' : 'none',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
              >
                {/* Stamp Circle Illustration */}
                <div style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  border: stamp.unlocked ? '3px dashed var(--sage)' : '2px dashed var(--border)',
                  background: stamp.unlocked ? 'rgba(80,120,80,0.08)' : 'rgba(0,0,0,0.02)',
                  color: stamp.unlocked ? 'var(--green)' : 'var(--muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.8rem',
                  position: 'relative',
                  flexShrink: 0,
                  transform: stamp.unlocked ? 'rotate(-6deg)' : 'none',
                }}>
                  {stamp.icon}
                  {stamp.unlocked && (
                    <div style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      background: 'var(--sage)',
                      color: 'var(--white)',
                      borderRadius: '50%',
                      width: 18,
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.65rem',
                      fontWeight: 'bold',
                      border: '1.5px solid var(--white)',
                    }}>
                      ✓
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <h3 style={{
                      fontFamily: 'var(--font-serif)',
                      fontWeight: 'bold',
                      fontSize: '1rem',
                      color: 'var(--green)',
                      margin: 0,
                    }}>
                      {stamp.name}
                    </h3>
                    {!stamp.unlocked && <Lock size={12} color="var(--muted)" style={{ flexShrink: 0 }} />}
                  </div>
                  <p style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.78rem',
                    color: 'var(--muted)',
                    margin: '0 0 6px 0',
                    lineHeight: 1.4,
                  }}>
                    {stamp.description}
                  </p>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-sans)',
                    color: stamp.unlocked ? 'var(--sage)' : 'var(--muted)',
                    background: stamp.unlocked ? 'rgba(80,120,80,0.1)' : 'rgba(0,0,0,0.06)',
                    padding: '2px 8px',
                    borderRadius: 'var(--r-pill)',
                  }}>
                    {stamp.unlocked ? `✓ Stamped ${stamp.count}x` : 'Locked'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 32,
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: '24px 20px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>🧭</div>
            <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', margin: '0 0 6px 0', fontSize: '1.1rem' }}>
              How to Collect Stamps
            </h3>
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '0.85rem',
              color: 'var(--muted)',
              maxWidth: 500,
              margin: '0 auto 16px auto',
              lineHeight: 1.5,
            }}>
              Locate scannable QR codes at member businesses, parks, and attractions throughout the Tri-State Lakes region. Scan them using your phone to unlock stamps and earn {creditsName}!
            </p>
          </div>
        </div>
      )}

      {/* Tab Contents: Badges */}
      {activeTab === 'badges' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}>
            {EXAMPLE_BADGES.map(badge => (
              <div
                key={badge.id}
                style={{
                  background: badge.unlocked ? 'var(--white)' : 'rgba(0,0,0,0.01)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  padding: '20px 16px',
                  display: 'flex',
                  gap: 16,
                  alignItems: 'flex-start',
                  opacity: badge.unlocked ? 1 : 0.6,
                  position: 'relative',
                }}
              >
                {/* Badge Icon */}
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: '12px',
                  background: badge.unlocked ? 'rgba(200,134,10,0.1)' : 'rgba(0,0,0,0.04)',
                  border: badge.unlocked ? '1px solid rgba(200,134,10,0.25)' : '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.75rem',
                  flexShrink: 0,
                }}>
                  {badge.icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
                    <h3 style={{
                      fontFamily: 'var(--font-serif)',
                      fontWeight: 'bold',
                      fontSize: '1rem',
                      color: badge.unlocked ? 'var(--green)' : 'var(--muted)',
                      margin: 0,
                    }}>
                      {badge.name}
                    </h3>
                    {!badge.unlocked && <Lock size={12} color="var(--muted)" />}
                  </div>
                  <p style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.78rem',
                    color: 'var(--muted)',
                    margin: '0 0 6px 0',
                    lineHeight: 1.4,
                  }}>
                    {badge.description}
                  </p>
                  <span style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: badge.unlocked ? 'var(--amber)' : 'var(--muted)',
                  }}>
                    {badge.unlocked ? '★ Unlocked' : 'Locked'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
