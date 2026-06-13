import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Award, QrCode, User, HelpCircle, LayoutGrid } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { useProfilePanel } from '../../context/ProfilePanelContext';
import { getBalanceOnly } from '../../api/credits';
import { getMe } from '../../api/auth';
import QrDrawer from '../ui/QrDrawer';

// Renders a brand name, coloring any "&" in amber to match L&L identity.
function BrandName({ name }: { name: string }) {
  const parts = name.split('&');
  if (parts.length === 1) return <>{name}</>;
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span style={{ color: 'var(--amber)' }}>&amp;</span>
          )}
        </span>
      ))}
    </>
  );
}

export default function Topbar() {
  const { user, logout, updateUser } = useAuth();
  const { tenant } = useTenant();
  const { openProfile } = useProfilePanel();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const location = useLocation();

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // Route-change auto-close
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const avatarLetter = user
    ? (user.display_name ?? user.email).charAt(0).toUpperCase()
    : '?';

  // Fetch user profile
  const { data: fullUserData } = useQuery({
    queryKey: ['me', tenant?.id],
    queryFn: () => getMe(tenant!.id),
    enabled: !!user && !!tenant,
    staleTime: 5 * 60_000,
  });

  // Sync full user data with AuthContext when fetched
  useEffect(() => {
    if (fullUserData) {
      updateUser(fullUserData);
    }
  }, [fullUserData, updateUser]);

  // Lightweight balance fetch
  const { data: balanceData } = useQuery({
    queryKey: ['credits:balance', tenant?.id],
    queryFn: () => getBalanceOnly(tenant!.id),
    enabled: !!user && !!tenant,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const displayBalance = Number(balanceData?.data?.balance ?? user?.credits_balance ?? 0);

  function handleLogout() {
    logout();
    setDrawerOpen(false);
    navigate('/');
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="topbar-brand">
          <span className="topbar-brand-main">
            <span className="topbar-brand-name"><BrandName name={tenant?.config.brand_name ?? 'Lake & Locals'} /></span>
            <span className="topbar-brand-exchange">Passport</span>
          </span>
          <span className="topbar-brand-powered">Powered by KrowdKraft</span>
        </Link>

        <div className="topbar-actions topbar-desktop-only">
          {user ? (
            <>
              <Link to="/my-stamps" className="topbar-link">My Stamps</Link>
              <button
                onClick={() => openProfile()}
                className="topbar-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                My Profile
              </button>
              <Link to="/help" className="topbar-link">Help</Link>
              <a href="https://apps.lakeandlocals.com" className="topbar-link">Hub</a>
              <button
                onClick={handleLogout}
                className="topbar-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/help" className="topbar-link">Help</Link>
              <a href="https://apps.lakeandlocals.com" className="topbar-link">Hub</a>
              <Link to="/auth/login" className="topbar-link">Sign in</Link>
            </>
          )}
        </div>

        <button
          className="topbar-menu-btn topbar-mobile-only"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
      </header>

      <div className={`nav-drawer-overlay${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(false)} />
      {/* inert + aria-hidden when closed: the drawer is still in the DOM (just
          translated off-canvas), so without this its links stay in the tab
          order and screen-reader tree on every page. */}
      <nav
        className={`nav-drawer${drawerOpen ? ' open' : ''}`}
        aria-hidden={!drawerOpen}
        {...(!drawerOpen ? { inert: '' } : {})}
      >
        <button
          className="nav-drawer-close"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close menu"
        >
          <X size={22} />
        </button>

        {user && (
          <div className="pd-user">
            <div className="pd-avatar" style={{ overflow: 'hidden' }}>
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.display_name ?? user.email}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                avatarLetter
              )}
            </div>
            <div className="pd-user-name">{user.display_name || user.email.split('@')[0]}</div>
            <div className="pd-credits-pill">
              <span>💰</span>
              <span>{displayBalance.toLocaleString()} {tenant?.config.credits_name ?? 'KrowdKredits'}</span>
            </div>
          </div>
        )}

        {user && (
          <>
            <Link
              to="/my-stamps"
              className={`nav-drawer-link${location.pathname === '/my-stamps' ? ' active' : ''}`}
              onClick={() => setDrawerOpen(false)}
            >
              <Award size={18} color="var(--cream)" />
              My Stamps
            </Link>
            <button
              className="nav-drawer-link"
              onClick={() => { setDrawerOpen(false); setQrOpen(true); }}
            >
              <QrCode size={18} color="var(--cream)" />
              My QR Code
            </button>
            <button
              className="nav-drawer-link"
              onClick={() => { setDrawerOpen(false); openProfile(); }}
            >
              <User size={18} color="var(--cream)" />
              My Profile
            </button>
          </>
        )}
        <Link
          to="/help"
          className={`nav-drawer-link${location.pathname === '/help' ? ' active' : ''}`}
          onClick={() => setDrawerOpen(false)}
        >
          <HelpCircle size={18} color="var(--cream)" />
          Help
        </Link>
        <a
          href="https://apps.lakeandlocals.com"
          className="nav-drawer-link"
          onClick={() => setDrawerOpen(false)}
        >
          <LayoutGrid size={18} color="var(--cream)" />
          Hub
        </a>

        <div className="nav-drawer-logout">
          {user ? (
            <button
              onClick={handleLogout}
              style={{
                width: '100%',
                padding: '12px',
                background: 'rgba(200,134,10,0.2)',
                border: '1px solid rgba(200,134,10,0.4)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--amber)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.9rem',
              }}
            >
              Sign out
            </button>
          ) : (
            <Link
              to="/auth/login"
              className="btn btn-amber btn-block"
              onClick={() => setDrawerOpen(false)}
            >
              Sign In
            </Link>
          )}
        </div>
      </nav>
      <QrDrawer
        open={qrOpen}
        onClose={() => setQrOpen(false)}
      />
    </>
  );
}
