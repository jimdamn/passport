import { useState } from 'react';
import { Map, Tag, QrCode, Wallet, User } from 'lucide-react';
import { BottomNav, type BottomNavItem } from 'kk-shared-ui';
import { useAuth } from '../../context/AuthContext';
import QrDrawer from '../ui/QrDrawer';

export default function PassportBottomNav() {
  const { user } = useAuth();
  const [qrOpen, setQrOpen] = useState(false);

  // The center FAB shows the member's QR for merchants to scan. Signed-out users
  // are sent to login instead.
  const scanItem: BottomNavItem = user
    ? { label: 'Scan', icon: QrCode, fab: true, onClick: () => setQrOpen(true), ariaLabel: 'Show my QR code' }
    : { label: 'Scan', icon: QrCode, fab: true, to: '/auth/login', ariaLabel: 'Sign in to scan' };

  const items: BottomNavItem[] = [
    { to: '/explore',   label: 'Around Town', icon: Map,    match: '/explore',   ariaLabel: 'Around Town' },
    { to: '/deals',     label: 'Marketplace', icon: Tag,    match: '/deals',     ariaLabel: 'Marketplace' },
    scanItem,
    { to: '/my-stamps', label: 'Wallet',      icon: Wallet, match: '/my-stamps', ariaLabel: 'Wallet' },
    { to: user ? '/profile' : '/auth/login', label: 'Me', icon: User, match: '/profile', ariaLabel: 'My profile' },
  ];

  return (
    <>
      <BottomNav items={items} />
      <QrDrawer open={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  );
}
