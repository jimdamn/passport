import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Award, ChevronRight, QrCode, MapPin, Compass } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { useProfilePanel } from '../../context/ProfilePanelContext';
import { getMe } from '../../api/auth';
import { updatePersona } from '../../api/profile';
import { getBalance } from '../../api/credits';
import { getAdminSupportCount } from '../../api/support';
import { getMyBusiness } from '../../api/merchant';
import { getAroundInterests, PICKER_LABELS } from '../../api/around';
import { getContentSummary } from '../../api/content';
import { resolveBalance, balanceText } from '../../utils/balance';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import StatsPanel, { type StatsPanelType } from '../../components/profile/StatsPanel';
import BadgeStrip, { type Badge as MemberBadge } from '../../components/ui/BadgeStrip';
import QrDrawer from '../../components/ui/QrDrawer';
import MerchantQrDrawer from '../../components/ui/MerchantQrDrawer';
import { PersonaSelector } from 'kk-shared-ui';
import { AnonymousPersonaDrawer } from '../../components/profile/AnonymousPersonaDrawer';
import { PersonalPersonaDrawer } from '../../components/profile/PersonalPersonaDrawer';
import { BusinessPersonaDrawer } from '../../components/profile/BusinessPersonaDrawer';
import { AroundInterestsDrawer } from '../../components/profile/AroundInterestsDrawer';
import MyPostsCards from '../../components/profile/MyPostsCards';
import NextStepCard from '../../components/profile/NextStepCard';
import BusinessOverviewCard from '../../components/profile/BusinessOverviewCard';
import AdminPortalCard from '../../components/profile/AdminPortalCard';

// Badge definitions mirrored client-side (server is authoritative; this is for /profile self-view)
const BADGE_DEFS: MemberBadge[] = [
  { id: 'bd-member',   label: 'L&L Member',  description: 'Verified Lake & Locals member' },
];

function computeMyBadges(profile: any): MemberBadge[] {
  const badges: MemberBadge[] = [];
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

// Zone headers (Gate 9 §9.1) reuse the existing .section-title class - sans,
// uppercase, muted (D-REV Option 2) - never serif green, which stays
// reserved for card titles one level down.
function ZoneHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="section-title" style={{ marginTop: 24 }}>{children}</h2>;
}

export default function MyProfile() {
  const { user, logout, updateUser } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const { openProfile } = useProfilePanel();
  const hasAutoOpened = useRef(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [merchantQrOpen, setMerchantQrOpen] = useState(false);
  const [personaDrawer, setPersonaDrawer] = useState<'anonymous' | 'personal' | 'business' | null>(null);
  const [personaNotice, setPersonaNotice] = useState<string | null>(null);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [personaSwitching, setPersonaSwitching] = useState(false);
  const [interestsDrawerOpen, setInterestsDrawerOpen] = useState(false);

  async function handlePersonaSwitch(persona: 'anonymous' | 'personal' | 'business') {
    if (personaSwitching) return;
    setPersonaSwitching(true);
    setPersonaError(null);
    setPersonaNotice(null);
    try {
      await updatePersona(persona);
      updateUser({ active_persona: persona });
      qc.invalidateQueries({ queryKey: ['me'] });
      const label = persona === 'anonymous' ? 'Anonymous' : persona === 'personal' ? (profile?.display_name || 'Personal') : (user?.business_name || 'Business');
      setPersonaNotice(`You now post as ${label}.`);
      window.setTimeout(() => setPersonaNotice(null), 4000);
    } catch (err: any) {
      setPersonaError(err?.message || 'Failed to switch persona.');
    } finally {
      setPersonaSwitching(false);
    }
  }

  const interestsQueryKey = ['around-interests', tenant.id];
  const { data: interestsData, isLoading: interestsLoading, isError: interestsError, refetch: refetchInterests } = useQuery({
    queryKey: interestsQueryKey,
    queryFn: () => getAroundInterests(tenant.id),
    enabled: !!tenant.id && !!user,
    staleTime: 5 * 60_000,
  });
  const interests = interestsData?.data ?? null;
  const aroundPick = interests && interests.interests.length > 0 ? interests.interests[0] : null;

  // Shares its cache with MyPostsCards's identical query (same key/fn) - one
  // network fetch, three consumers (also the attention row below), no
  // prop-drilling the summary through components that don't otherwise need it.
  const { data: contentSummaryData } = useQuery({
    queryKey: ['content-summary', tenant.id],
    queryFn: () => getContentSummary(tenant.id),
    enabled: !!tenant.id && !!user,
    staleTime: 60_000,
  });
  const contentSummary = contentSummaryData?.data;

  // Gate 9 §9.3 - "Waiting on you": attention_total was already in the API
  // and already rendered, just nine phone screens down inside My Splash's own
  // card. Splash is the only source with a real single-item decision and an
  // addressable deep link (/splash#submission-<id>); the others' `attention`
  // semantics aren't specified precisely enough here to safely deep-link, so
  // they stay visible only within their own SummaryCard, unchanged.
  const splashAttention = contentSummary?.splash;
  const attentionItem = splashAttention?.recent.find(item => item.attention);
  const showAttentionRow = !!splashAttention && splashAttention.attention_total > 0;
  const attentionHref = attentionItem ? `/splash#submission-${attentionItem.id}` : '/splash';

  const { data: meData, isLoading } = useQuery({
    queryKey: ['me', tenant?.id],
    queryFn: () => getMe(tenant!.id),
    enabled: !!user && !!tenant.id,
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

  const { data: creditsData, isError: creditsError, isSuccess: creditsSuccess, refetch: refetchCredits } = useQuery({
    queryKey: ['credits', tenant?.id],
    queryFn: () => getBalance(tenant!.id),
    enabled: !!tenant.id && !!user,
    staleTime: 5 * 60_000,
  });

  const { data: supportCountData } = useQuery({
    queryKey: ['support-count', tenant?.id],
    queryFn: () => getAdminSupportCount(tenant!.id),
    enabled: !!tenant.id && !!user?.is_admin,
    staleTime: 60_000,
  });

  // Cheap check so a verified merchant with no location on file is told about
  // it right here, instead of only discovering it after clicking a QR button
  // that silently fails.
  const { data: businessData } = useQuery({
    queryKey: ['my-business', tenant?.id],
    queryFn: () => getMyBusiness(tenant!.id),
    enabled: !!tenant.id && !!user && user.business_status === 'verified',
    staleTime: 60_000,
  });
  const businessMissingLocation = user?.business_status === 'verified'
    && businessData?.data
    && (businessData.data.lat == null || businessData.data.lon == null);

  const [statsPanel,    setStatsPanel]    = useState<StatsPanelType | null>(null);

  function handleLogout() {
    logout();
    navigate('/');
  }

  if (!user) {
    return (
      <div className="main-content" style={{ paddingTop: 24 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Passport
          </Link>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ marginBottom: 16 }}>You are not signed in.</p>
          <a className="btn btn-primary" href="/auth/login">Sign In</a>
        </div>
      </div>
    );
  }

  const profile: any     = meData || user;
  const credits          = creditsData?.data;
  const balanceDisplay   = resolveBalance(credits?.balance, user.credits_balance);
  // A 200 with balance: null means KKCredits itself was unreachable server-side -
  // an outage, not a real zero. Treat it the same as a client-side fetch failure.
  const creditsUnavailable = creditsError || (creditsSuccess && credits?.balance == null);
  const creditsName      = tenant?.config.credits_name ?? 'KrowdKredits';
  const currentAvatarUrl = (meData as any)?.avatar_url ?? user.avatar_url ?? null;
  const myBadges         = computeMyBadges(profile);
  const newSupportCount  = supportCountData?.data?.new_count ?? 0;

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

      {/* ── Waiting on you (Gate 9.3) - status, not urgency ── */}
      {showAttentionRow && (
        <Link
          to={attentionHref}
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            marginBottom: 16, minHeight: 44, textDecoration: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Badge variant="amber">Waiting on you</Badge>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--green)' }}>
              A Splash photo is waiting on your decision.
            </span>
          </span>
          <ChevronRight size={15} color="var(--muted)" style={{ flexShrink: 0 }} />
        </Link>
      )}

      {/* ══════════════════════════ Me ══════════════════════════ */}
      <ZoneHeader>Me</ZoneHeader>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 12 }}>
          <AvatarDisplay
            name={profile.display_name || 'Me'}
            avatarUrl={currentAvatarUrl}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: '0 0 2px', fontSize: '1.15rem', fontFamily: 'var(--font-serif)' }}>{profile.display_name}</h1>
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
            <QrCode size={15} strokeWidth={2} aria-hidden="true" /> My QR Code
          </button>
        </div>
      </div>

      {user.is_admin && <AdminPortalCard newSupportCount={newSupportCount} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold' }}>
          Active Persona
        </h3>
        <PersonaSelector
          currentPersona={user.active_persona ?? 'anonymous'}
          businessVerified={user.business_status === 'verified'}
          onSwitch={handlePersonaSwitch}
          onManage={(p) => setPersonaDrawer(p)}
        />
        {personaNotice && (
          <p role="status" style={{ margin: '10px 0 0', fontSize: '0.82rem', fontFamily: 'var(--font-sans)', color: 'var(--sage)', fontWeight: 600 }}>
            {personaNotice}
          </p>
        )}
        {personaError && <Alert type="error" style={{ marginTop: 10 }}>{personaError}</Alert>}
      </div>

      <div className="stats-grid" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="stat-card stat-card--featured stat-card--btn" onClick={() => setStatsPanel('credits')} style={{ flex: 1, minWidth: 100, maxWidth: 180 }}>
          <div className="stat-num">{balanceText(balanceDisplay)}</div>
          <div className="stat-label">{creditsName}</div>
        </button>
        {creditsUnavailable && (
          <p style={{ width: '100%', textAlign: 'center', margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
            Couldn't load right now.{' '}
            <button
              type="button"
              onClick={() => refetchCredits()}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--green)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Retry
            </button>
          </p>
        )}
      </div>

      {/* ══════════════════════════ My business ══════════════════════════
          Merchants only (D-REV Order B - right after identity, since a
          merchant's business doorway is often why they opened the app).
          Someone with no business relationship yet sees the recruitment CTA
          in Account instead - there is no doorway to collapse for them. */}
      {user.business_id && (
        <>
          <ZoneHeader>My business</ZoneHeader>

          {user.business_status === 'pending' && (
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: 'rgba(200, 134, 10, 0.04)' }}>
              <p style={{ margin: '0 0 4px', fontWeight: 'bold', color: 'var(--amber)', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
                Merchant Profile Pending Approval
              </p>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.45 }}>
                Your application for <strong>{user.business_name || 'your business'}</strong> is currently under review by our community admin and will be active shortly.
              </p>
            </div>
          )}

          {user.business_status === 'verified' && (
            <>
              {businessMissingLocation && (
                <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: 'rgba(200, 134, 10, 0.04)' }}>
                  <p style={{ margin: '0 0 4px', fontWeight: 'bold', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
                    <MapPin size={16} strokeWidth={2} aria-hidden="true" /> Almost There
                  </p>
                  <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.45 }}>
                    Add your business location to activate customer check-ins and your Display Check-in QR Code.
                  </p>
                  <Link to="/merchant" className="btn btn-amber btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
                    Set Business Location
                  </Link>
                </div>
              )}

              <BusinessOverviewCard businessName={user.business_name ?? ''} onShowQr={() => setMerchantQrOpen(true)} />
            </>
          )}

          {user.business_status === 'rejected' && (
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--error)', background: 'rgba(176, 0, 0, 0.04)' }}>
              <p style={{ margin: '0 0 4px', fontWeight: 'bold', color: 'var(--error)', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
                Merchant Application Declined
              </p>
              <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.45 }}>
                The application for <strong>{user.business_name}</strong> could not be verified. Please check your details and re-apply.
              </p>
              <Link to="/profile/apply-merchant" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', textDecoration: 'none' }}>
                Re-apply Now
              </Link>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════ My posts and places ══════════════════════════ */}
      <ZoneHeader>My posts and places</ZoneHeader>

      <NextStepCard pick={aroundPick} contentSummary={contentSummary} />

      {tenant.id && <MyPostsCards tenantId={tenant.id} />}

      {/* ══════════════════════════ Account ══════════════════════════ */}
      <ZoneHeader>Account</ZoneHeader>

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

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Compass size={17} strokeWidth={2} aria-hidden="true" /> Where Around Town opens
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
              {/* Existing-data note: a legacy multi-pick row's first element
                  is the pick everywhere - never join the whole array. */}
              {interestsLoading ? '' : interestsError ? (
                <>
                  Couldn't load your pick.{' '}
                  <button
                    type="button"
                    onClick={() => refetchInterests()}
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--green)', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    Retry
                  </button>
                </>
              ) : interests && interests.interests.length > 0
                ? (PICKER_LABELS[interests.interests[0]] ?? interests.interests[0])
                : 'Everything - no pick yet'}
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setInterestsDrawerOpen(true)} style={{ flexShrink: 0 }}>
            Edit
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <Link
          to="/my-stamps"
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '11px 0', color: 'var(--green)', textDecoration: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Award size={15} /> Stamps
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

      {/* ── Drawers (state lives here regardless of which zone triggers them) ── */}
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
        onSwitch={() => { updateUser({ active_persona: 'anonymous' }); qc.invalidateQueries({ queryKey: ['me'] }); setPersonaDrawer(null); }}
      />
      <PersonalPersonaDrawer
        open={personaDrawer === 'personal'}
        currentPersona={user.active_persona ?? 'anonymous'}
        tenantId={tenant!.id}
        displayName={profile.display_name}
        onClose={() => setPersonaDrawer(null)}
        onSwitch={() => { updateUser({ active_persona: 'personal' }); qc.invalidateQueries({ queryKey: ['me'] }); setPersonaDrawer(null); }}
      />
      <BusinessPersonaDrawer
        open={personaDrawer === 'business'}
        currentPersona={user.active_persona ?? 'anonymous'}
        businessStatus={user.business_status}
        businessName={user.business_name}
        onClose={() => setPersonaDrawer(null)}
        onSwitch={() => { updateUser({ active_persona: 'business' }); qc.invalidateQueries({ queryKey: ['me'] }); setPersonaDrawer(null); }}
      />

      <AroundInterestsDrawer
        open={interestsDrawerOpen}
        tenantId={tenant!.id}
        onClose={() => setInterestsDrawerOpen(false)}
        onSaved={data => qc.setQueryData(interestsQueryKey, { data })}
      />

      <QrDrawer
        open={qrOpen}
        onClose={() => setQrOpen(false)}
      />

      <MerchantQrDrawer
        open={merchantQrOpen}
        onClose={() => setMerchantQrOpen(false)}
      />

    </div>
  );
}
