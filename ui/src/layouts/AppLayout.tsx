import { useState, useRef, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Topbar from '../components/nav/Topbar';
import BottomNav from '../components/nav/BottomNav';
import { ProfilePanelProvider } from '../context/ProfilePanelContext';
import ProfilePanel from '../components/profile/ProfilePanel';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [isEmbedded, setIsEmbedded] = useState(false);
  const onSavedRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    setIsEmbedded(window.self !== window.top);
  }, []);

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
        {!isEmbedded && <Topbar />}
        <main className="main-content">
          <Outlet />
        </main>
        <BottomNav />
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
