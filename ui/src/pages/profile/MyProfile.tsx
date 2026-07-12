import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Award, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { useProfilePanel } from '../../context/ProfilePanelContext';
import { getMe } from '../../api/auth';
import { getBalance } from '../../api/credits';
import { Spinner } from '../../components/ui/Spinner';
import StatsPanel, { type StatsPanelType } from '../../components/profile/StatsPanel';
import BadgeStrip, { type Badge } from '../../components/ui/BadgeStrip';
import QrDrawer from '../../components/ui/QrDrawer';
import MerchantQrDrawer from '../../components/ui/MerchantQrDrawer';
import { PersonaSelector } from '../../components/PersonaSelector';
import { AnonymousPersonaDrawer } from '../../components/profile/AnonymousPersonaDrawer';
import { PersonalPersonaDrawer } from '../../components/profile/PersonalPersonaDrawer';
import { BusinessPersonaDrawer } from '../../components/profile/BusinessPersonaDrawer';

// Badge definitions mirrored client-side (server is authoritative; this is for /profile self-view)
const BADGE_DEFS: Badge[] = [
  { id: 'bd-member',   label: 'L&L Member',  description: 'Verified Lake & Locals member' },
];

function computeMyBadges(profile: any): Badge[] {
  const badges: Badge[] = [];
  if (profile.bd_member_since) badges.push(BADGE_DEFS[0]);
  return badges;
}

function AvatarDisplay({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const parts   = name.trim().split(' ');
  const letters = (parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : name.slice(0, 2)
  ).toUpperCase();

  return (
    <div style={{
      width: 72, height: 72, borderRadius: '50%',
      background: avatarUrl ? 'transparent' : 'var(--green)',
      color: 'var(--cream)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '1.6rem', fontWeight: 'bold',
      overflow: 'hidden', flexShrink: 0,
    }}>
      {avatarUrl
        ? <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : letters
      }
    </div>
  );
}

export default function MyProfile() {
  const { user, logout, updateUser } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const { openProfile } = useProfilePanel();
  const hasAutoOpened = useRef(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [merchantQrOpen, setMerchantQrOpen] = useState(false);
  const [personaDrawer, setPersonaDrawer] = useState<'anonymous' | 'personal' | 'business' | null>(null);

  const { data: meData, isLoading } = useQuery({
    queryKey: ['me', tenant?.id],
    queryFn: () => getMe(tenant!.id),
    enabled: !!user && !!tenant,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (meData) updateUser(meData);
  }, [meData, updateUser]);

  // Welcome flow
  useEffect(() => {
    if (isWelcome && user && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      openProfile(() => navigate('/', { replace: true }));
    }
  }, [isWelcome, user]);

  const { data: creditsData } = useQuery({
    queryKey: ['credits', tenant?.id],
    queryFn: () => getBalance(tenant!.id),
    enabled: !!tenant && !!user,
    staleTime: 5 * 60_000,
  });

  const [statsPanel,    setStatsPanel]    = useState<StatsPanelType | null>(null);

  function handleLogout() {
    logout();
    navigate('/');
  }

  if (!user) {
    return (
      <div className="main-content" style={{ paddingTop: 32 }}>
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ marginBottom: 16 }}>You are not signed in.</p>
          <a className="btn btn-primary" href="/auth/login">Sign In</a>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const profile: any     = meData || user;
  const credits          = creditsData?.data;
  const isBDMember       = !!profile.bd_member_since;
  const creditsName      = tenant?.config.credits_name ?? 'KrowdKredits';
  const currentAvatarUrl = (meData as any)?.avatar_url ?? user.avatar_url ?? null;
  const myBadges         = computeMyBadges(profile);

  return (
    <div className="main-content" style={{ paddingTop: 24, paddingBottom: 96 }}>

      {isWelcome && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: '#fffbf2' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
            Welcome to the Passport.
          </p>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>
            Add your name and location so you can build your profile.
          </p>
        </div>
      )}

      {/* ── Profile card ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 12 }}>
          <AvatarDisplay
            name={profile.display_name || 'Me'}
            avatarUrl={currentAvatarUrl}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 2px', fontSize: '1.15rem' }}>{profile.display_name}</h2>
            <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--muted)' }}>{profile.email}</p>
            {profile.location && (
              <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--sage)' }}>
                {profile.location}
              </p>
            )}
          </div>
        </div>

        {myBadges.length > 0 && (
          <BadgeStrip badges={myBadges} style={{ marginBottom: 12 }} />
        )}

        {profile.bio && (
          <p style={{
            margin: '0 0 12px', fontSize: '0.9rem',
            borderLeft: '3px solid var(--border)', paddingLeft: 12,
          }}>
            {profile.bio}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => openProfile()}>
            Edit Profile
          </button>
          <button
            className="btn btn-amber btn-sm"
            onClick={() => setQrOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            My QR Code 📱
          </button>
        </div>
      </div>

      {/* ── Persona Selector card ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold' }}>
          Active Persona
        </h3>
        <PersonaSelector
          currentPersona={user.active_persona ?? 'anonymous'}
          businessVerified={user.business_status === 'verified'}
          onManage={(p) => setPersonaDrawer(p)}
        />
      </div>

      {/* ── Stats grid ── */}
      <div className="stats-grid" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="stat-card stat-card--featured stat-card--btn" onClick={() => setStatsPanel('credits')} style={{ flex: 1, minWidth: 100, maxWidth: 180 }}>
          <div className="stat-num">{credits?.balance ?? user.credits_balance ?? 0}</div>
          <div className="stat-label">{creditsName}</div>
        </button>
      </div>

      <StatsPanel
        open={statsPanel !== null}
        type={statsPanel}
        onClose={() => setStatsPanel(null)}
      />

      <AnonymousPersonaDrawer
        open={personaDrawer === 'anonymous'}
        currentPersona={user.active_persona ?? 'anonymous'}
        tenantId={tenant!.id}
        onClose={() => setPersonaDrawer(null)}
        onSwitch={() => { updateUser({ active_persona: 'anonymous' }); setPersonaDrawer(null); }}
      />
      <PersonalPersonaDrawer
        open={personaDrawer === 'personal'}
        currentPersona={user.active_persona ?? 'anonymous'}
        tenantId={tenant!.id}
        displayName={profile.display_name}
        onClose={() => setPersonaDrawer(null)}
        onSwitch={() => { updateUser({ active_persona: 'personal' }); setPersonaDrawer(null); }}
      />
      <BusinessPersonaDrawer
        open={personaDrawer === 'business'}
        currentPersona={user.active_persona ?? 'anonymous'}
        businessStatus={user.business_status}
        businessName={user.business_name}
        onClose={() => setPersonaDrawer(null)}
        onSwitch={() => { updateUser({ active_persona: 'business' }); setPersonaDrawer(null); }}
      />

      <QrDrawer
        open={qrOpen}
        onClose={() => setQrOpen(false)}
      />

      <MerchantQrDrawer
        open={merchantQrOpen}
        onClose={() => setMerchantQrOpen(false)}
      />

      {credits && credits.history.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="card-title">{creditsName} Activity</p>
          {credits.history.slice(0, 8).map((entry: any) => (
            <div
              key={entry.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 0', borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: '0.875rem' }}>{entry.reason}</span>
              <span style={{
                fontWeight: 'bold', fontSize: '0.9rem',
                color: entry.amount > 0 ? 'var(--sage)' : 'var(--error)',
              }}>
                {entry.amount > 0 ? '+' : ''}{entry.amount}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Admin Portal Banners ── */}
      {user.is_admin && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--green)', background: 'rgba(30, 51, 32, 0.02)' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
            🛡️ Network Administrator Portal
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>
            You have administrator privileges. Manage local network configurations and review pending merchant applications.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/profile/admin/merchants" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Review Merchant Applications
            </Link>
            <Link to="/profile/admin/plaques" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Plaques & Events
            </Link>
            <Link to="/profile/admin/prizes" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Prize Pools
            </Link>
            <Link to="/profile/admin/deals" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Deal Review
            </Link>
            <Link to="/profile/admin/volunteer" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Volunteer Shift Review
            </Link>
            <Link to="/profile/admin/happenings" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Happenings
            </Link>
            <Link to="/redeem" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Redeem a Claim
            </Link>
            <Link to="/profile/admin/test-plaque" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Test Plaque
            </Link>
            <Link to="/profile/admin/kwest" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
              KrowdKwest
            </Link>
          </div>
        </div>
      )}

      {/* ── Merchant/Business Identity Onboarding & Status ── */}
      {!isLoading && !user.business_id && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
            Own a local business or organization?
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.45 }}>
            Apply for a network merchant profile to showcase your shop on our Explore passport map, distribute rewards, and reward check-ins.
          </p>
          <Link to="/profile/apply-merchant" className="btn btn-amber btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Register Your Business
          </Link>
        </div>
      )}

      {user.business_id && user.business_status === 'pending' && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: 'rgba(200, 134, 10, 0.04)' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold', color: 'var(--amber)', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
            ⚙️ Merchant Profile Pending Approval
          </p>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.45 }}>
            Your application for <strong>{user.business_name || 'your business'}</strong> is currently under review by our community admin and will be active shortly.
          </p>
        </div>
      )}

      {user.business_id && user.business_status === 'verified' && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--green)', background: 'rgba(30, 51, 32, 0.04)' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
            <span>🛡️</span> Verified Merchant Profile
          </p>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.45 }}>
            Your business <strong>{user.business_name}</strong> is live! It is fully integrated with the Explore network directory.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Link to="/merchant" className="btn btn-amber btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
              <span>🎁</span> Merchant Dashboard
            </Link>
            <button
              onClick={() => setMerchantQrOpen(true)}
              className="btn btn-green btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span>📱</span> Display Check-in QR Code
            </button>
          </div>
        </div>
      )}

      {user.business_id && user.business_status === 'rejected' && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--error)', background: 'rgba(176, 0, 0, 0.04)' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold', color: 'var(--error)', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
            ❌ Merchant Application Declined
          </p>
          <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.45 }}>
            The application for <strong>{user.business_name}</strong> could not be verified. Please check your details and re-apply.
          </p>
          <Link to="/profile/apply-merchant" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Re-apply Now
          </Link>
        </div>
      )}

      {!isBDMember && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold' }}>
            Are you a Lake &amp; Locals member?
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '0.875rem', color: 'var(--muted)' }}>
            Connect your membership to earn 25 bonus {creditsName} and sign in automatically next time.
          </p>
          <button
            className="btn btn-amber btn-sm"
            onClick={() => {
              alert('Connect your L&L account - BD SSO widget goes here.\nSee SETUP.md for the integration snippet.');
            }}
          >
            Connect my L&amp;L account
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <Link
          to="/my-stamps"
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '11px 0', color: 'var(--green)', textDecoration: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Award size={15} /> My Stamps
          </span>
          <ChevronRight size={15} color="var(--muted)" />
        </Link>
      </div>

      <button
        className="btn btn-secondary btn-block"
        onClick={handleLogout}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <LogOut size={16} /> Sign Out
      </button>

    </div>
  );
}
