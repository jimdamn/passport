import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, QrCode, User, HelpCircle, LayoutGrid } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Topbar, type TopbarLink } from 'kk-shared-ui';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { useProfilePanel } from '../../context/ProfilePanelContext';
import { getBalanceOnly } from '../../api/credits';
import { getMe } from '../../api/auth';
import { resolveBalance, balanceText } from '../../utils/balance';
import QrDrawer from '../ui/QrDrawer';

const HUB_URL = 'https://apps.lakeandlocals.com';

export default function PassportTopbar() {
  const { user, logout, updateUser } = useAuth();
  const { tenant } = useTenant();
  const { openProfile } = useProfilePanel();
  const navigate = useNavigate();
  const [qrOpen, setQrOpen] = useState(false);

  // Sync full user profile (avatar_url etc.) into AuthContext once tenant is known.
  const { data: fullUserData } = useQuery({
    queryKey: ['me', tenant?.id],
    queryFn: () => getMe(tenant!.id),
    enabled: !!user && !!tenant.id,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (fullUserData) updateUser(fullUserData);
  }, [fullUserData, updateUser]);

  // Lightweight balance-only fetch for the drawer pill. KKCredits is the source
  // of truth; this is a display cache that refetches on window focus.
  const { data: balanceData } = useQuery({
    queryKey: ['credits:balance', tenant?.id],
    queryFn: () => getBalanceOnly(tenant!.id),
    enabled: !!user && !!tenant.id,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const balanceDisplay = resolveBalance(balanceData?.data?.balance, user?.credits_balance);
  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  function handleLogout() {
    logout();
    navigate('/');
  }

  const desktopLinks: TopbarLink[] = user
    ? [
        { label: 'My Stamps', to: '/my-stamps' },
        { label: 'My Profile', onClick: () => openProfile() },
        { label: 'Help', to: '/help' },
        { label: 'Hub', to: HUB_URL, external: true },
      ]
    : [
        { label: 'Help', to: '/help' },
        { label: 'Hub', to: HUB_URL, external: true },
      ];

  const drawerLinks: TopbarLink[] = user
    ? [
        { label: 'My Stamps', to: '/my-stamps', icon: Award },
        { label: 'My QR Code', onClick: () => setQrOpen(true), icon: QrCode },
        { label: 'My Profile', onClick: () => openProfile(), icon: User },
        { label: 'Help', to: '/help', icon: HelpCircle },
        { label: 'Hub', to: HUB_URL, external: true, icon: LayoutGrid },
      ]
    : [
        { label: 'Help', to: '/help', icon: HelpCircle },
        { label: 'Hub', to: HUB_URL, external: true, icon: LayoutGrid },
      ];

  return (
    <>
      <Topbar
        brandName={tenant?.config.brand_name ?? 'Lake & Locals'}
        appLabel="Passport"
        user={user}
        balanceLabel={user ? `${balanceText(balanceDisplay)} ${creditsName}` : null}
        desktopLinks={desktopLinks}
        drawerLinks={drawerLinks}
        onLogout={handleLogout}
      />
      <QrDrawer open={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  );
}
