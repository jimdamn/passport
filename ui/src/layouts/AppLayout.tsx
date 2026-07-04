import { useState, useRef, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Topbar from '../components/nav/Topbar';
import BottomNav from '../components/nav/BottomNav';
import { ProfilePanelProvider } from '../context/ProfilePanelContext';
import ProfilePanel from '../components/profile/ProfilePanel';
import { useAuth } from '../context/AuthContext';

export default function AppLayout() {
  const { user } = useAuth();
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
