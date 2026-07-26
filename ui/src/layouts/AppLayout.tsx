import { useState, useRef, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SponsorDrawer, Footer, shouldAttempt, markShown, markDismissed, markQuiet, otherOverlayOpen, type SponsorPlacementView } from 'kk-shared-ui';
import Topbar from '../components/nav/Topbar';
import BottomNav from '../components/nav/BottomNav';
import { ProfilePanelProvider } from '../context/ProfilePanelContext';
import ProfilePanel from '../components/profile/ProfilePanel';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';
import { resolveSponsorDrawer, sponsorBeacon } from '../api/sponsors';

// Sponsor Drawer trigger: show after 8s on route OR first scroll, whichever
// comes first (never on first paint - SPONSOR-DRAWER-BUILD-PLAN.md §1/§4).
const SPONSOR_TRIGGER_DELAY_MS = 8000;

// Client-side throttle for the treasure hunt roll. The server enforces its own
// cooldown; this only stops React StrictMode double-renders and rapid route
// bounces from burning requests. localStorage survives full page reloads.
const HUNT_THROTTLE_MS = 5000;
const HUNT_THROTTLE_KEY = 'kk_hunt_last_roll';

export default function AppLayout() {
  const { user, isLoading } = useAuth();
  const { tenant } = useTenant();
  const location = useLocation();

  // Digital Treasure Hunt — every route change for a logged-in user is one
  // server-side appearance roll. A win reveals itself through the game-toast
  // channel (chest overlay), so there is nothing to render here on a miss.
  useEffect(() => {
    if (!user || isLoading || !tenant) return;
    const last = Number(localStorage.getItem(HUNT_THROTTLE_KEY) || '0');
    if (Date.now() - last < HUNT_THROTTLE_MS) return;
    localStorage.setItem(HUNT_THROTTLE_KEY, String(Date.now()));

    api.post(`/t/${tenant.id}/hunt/roll`, { page_ref: location.pathname })
      .catch(() => { /* best-effort; a failed roll costs the user nothing */ });
  }, [location.pathname, user, isLoading, tenant]);
  // Sponsor Drawer - route-scoped attempt, reset on every navigation. Hiding
  // on route change (the cleanup below) fires no beacon; only an explicit X
  // dismiss or a tap-through does.
  const [sponsor, setSponsor] = useState<SponsorPlacementView | null>(null);
  useEffect(() => {
    setSponsor(null);
    if (!tenant) return;
    const route = location.pathname;
    let attempted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function attempt() {
      if (attempted) return;
      attempted = true;
      window.removeEventListener('scroll', onScroll);
      if (timer) { clearTimeout(timer); timer = null; }
      if (!shouldAttempt(route) || otherOverlayOpen()) return;
      try {
        const res = await resolveSponsorDrawer(tenant.id, 'passport', route);
        if (res.data) {
          setSponsor(res.data);
          markShown(route);
          sponsorBeacon(tenant.id, res.data.id, 'show').catch(() => {});
        }
      } catch {
        // A failed resolve costs the user nothing - the moment just passes.
      }
    }
    function onScroll() { attempt(); }

    timer = setTimeout(attempt, SPONSOR_TRIGGER_DELAY_MS);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [location.pathname, tenant]);

  const handleSponsorDismiss = () => {
    if (!sponsor || !tenant) return;
    markDismissed();
    markQuiet();
    sponsorBeacon(tenant.id, sponsor.id, 'dismiss').catch(() => {});
    setSponsor(null);
  };

  const handleSponsorTap = () => {
    if (!sponsor || !tenant) return;
    sponsorBeacon(tenant.id, sponsor.id, 'tap').catch(() => {});
  };

  const [profileOpen, setProfileOpen] = useState(false);
  const onSavedRef = useRef<(() => void) | undefined>(undefined);

  function openProfile(onSaved?: () => void) {
    onSavedRef.current = onSaved;
    setProfileOpen(true);
  }

  function handlePanelClose() {
    setProfileOpen(false);
    onSavedRef.current = undefined;
  }

  function handlePanelSaved() {
    const cb = onSavedRef.current;
    onSavedRef.current = undefined;
    setProfileOpen(false);
    cb?.();
  }

  return (
    <ProfilePanelProvider value={{ openProfile }}>
      <div className="page-shell">
        {/* Topbar (with the hamburger drawer) always renders. The dedicated
            SDK embed uses the separate /embed/drawer route (EmbedDrawer, no
            chrome), so full-app routes must never hide their own nav — hiding
            it on a generic iframe (e.g. a device emulator) stranded the
            hamburger and made navigation inconsistent across contexts. */}
        <Topbar />
        <main className="main-content">
          <Outlet />
        </main>
        <Footer brandName={tenant?.config.brand_name ?? 'Lake & Locals'} />
        <BottomNav />
        {sponsor && (
          <SponsorDrawer placement={sponsor} onDismiss={handleSponsorDismiss} onTap={handleSponsorTap} />
        )}
        {/* The one true profile path (all other apps link here). Rendered only
            for a signed-in user so logged-out pages carry no hidden panel DOM. */}
        {user && (
          <ProfilePanel
            open={profileOpen}
            onClose={handlePanelClose}
            onSaved={handlePanelSaved}
          />
        )}
      </div>
    </ProfilePanelProvider>
  );
}
