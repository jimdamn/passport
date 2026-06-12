import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import { Spinner } from './components/ui/Spinner';

// Pages
import Home from './pages/Home';
import SSOLanding from './pages/auth/SSOLanding';
import LoginPage from './pages/auth/LoginPage';
import MyStamps from './pages/MyStamps';
import ScanPortal from './pages/ScanPortal';
import MyProfile from './pages/profile/MyProfile';
import ApplyMerchant from './pages/profile/ApplyMerchant';
import AdminMerchants from './pages/profile/AdminMerchants';
import AdminTestPlaque from './pages/profile/AdminTestPlaque';

import PublicProfile from './pages/profile/PublicProfile';
import Help from './pages/Help';
import EmbedDrawer from './pages/EmbedDrawer';
import Explore from './pages/Explore';

export default function App() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="spinner-center" style={{ minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/embed/drawer" element={<EmbedDrawer />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/auth/sso" element={<SSOLanding />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/my-stamps" element={<MyStamps />} />
        <Route path="/scan" element={<ScanPortal />} />
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/profile/apply-merchant" element={<ApplyMerchant />} />
        <Route path="/profile/admin/merchants" element={<AdminMerchants />} />
        <Route path="/profile/admin/test-plaque" element={<AdminTestPlaque />} />
        <Route path="/members/:id" element={<PublicProfile />} />
        <Route path="/help" element={<Help />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
