import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import { Spinner } from './components/ui/Spinner';
import { ErrorBoundary } from './components/ErrorBoundary';

// Pages
import Home from './pages/Home';
import SSOLanding from './pages/auth/SSOLanding';
import LoginPage from './pages/auth/LoginPage';
import MyStamps from './pages/MyStamps';
import ScanPortal from './pages/ScanPortal';
import MyProfile from './pages/profile/MyProfile';
import ApplyMerchant from './pages/profile/ApplyMerchant';
import AdminMerchants from './pages/profile/AdminMerchants';
import AdminUsers from './pages/profile/AdminUsers';
import AdminContent from './pages/profile/AdminContent';
import AdminTestPlaque from './pages/profile/AdminTestPlaque';
import AdminPlaques from './pages/profile/AdminPlaques';
import AdminPrizes from './pages/profile/AdminPrizes';

import PublicProfile from './pages/profile/PublicProfile';
import RedeemClaim from './pages/RedeemClaim';
import ClaimVisit from './pages/ClaimVisit';
import MerchantDashboard from './pages/MerchantDashboard';
import Help from './pages/Help';
import EmbedDrawer from './pages/EmbedDrawer';
import Explore from './pages/Explore';
import MapRoom from './pages/explore/MapRoom';
import Deals from './pages/Deals';
import Happenings from './pages/Happenings';
import FreshToday from './pages/FreshToday';
import FreshStand from './pages/FreshStand';
import FreshMine from './pages/FreshMine';
import SaleDay from './pages/SaleDay';
import SaleDetail from './pages/SaleDetail';
import SalesMine from './pages/SalesMine';
import PetsBoard from './pages/PetsBoard';
import PetPost from './pages/PetPost';
import PetsMine from './pages/PetsMine';
import PopupsBoard from './pages/PopupsBoard';
import PopupVendor from './pages/PopupVendor';
import PopupsMine from './pages/PopupsMine';
import MealsBoard from './pages/MealsBoard';
import MealDetail from './pages/MealDetail';
import KitchenPage from './pages/KitchenPage';
import MealsMine from './pages/MealsMine';
import LendAHand from './pages/LendAHand';
import Splash from './pages/Splash';
import AdminDeals from './pages/profile/AdminDeals';
import AdminSupport from './pages/profile/AdminSupport';
import AdminVolunteer from './pages/profile/AdminVolunteer';
import AdminHappenings from './pages/profile/AdminHappenings';
import AdminFresh from './pages/profile/AdminFresh';
import AdminSplash from './pages/profile/AdminSplash';
import AdminSales from './pages/profile/AdminSales';
import AdminPets from './pages/profile/AdminPets';
import AdminPopups from './pages/profile/AdminPopups';
import AdminMeals from './pages/profile/AdminMeals';
import KwestHome from './pages/kwest/KwestHome';
import KwestHelp from './pages/kwest/KwestHelp';
import KwestHunt from './pages/kwest/KwestHunt';
import KwestRetro from './pages/kwest/KwestRetro';
import AdminKwest from './pages/profile/AdminKwest';
import AdminKwestEdit from './pages/profile/AdminKwestEdit';
import AdminKwestFieldTest from './pages/profile/AdminKwestFieldTest';
import AdminKwestDashboard from './pages/profile/AdminKwestDashboard';
import AdminSponsors from './pages/profile/AdminSponsors';

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
    <ErrorBoundary>
    <Routes>
      <Route path="/embed/drawer" element={<EmbedDrawer />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/auth/sso" element={<SSOLanding />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/explore/map" element={<MapRoom />} />
        <Route path="/deals" element={<Deals />} />
        <Route path="/happenings" element={<Happenings />} />
        <Route path="/fresh" element={<FreshToday />} />
        <Route path="/fresh/stand/:id" element={<FreshStand />} />
        <Route path="/fresh/mine" element={<FreshMine />} />
        <Route path="/sales" element={<SaleDay />} />
        <Route path="/sales/sale/:id" element={<SaleDetail />} />
        <Route path="/sales/mine" element={<SalesMine />} />
        <Route path="/pets" element={<PetsBoard />} />
        <Route path="/pets/post/:id" element={<PetPost />} />
        <Route path="/pets/mine" element={<PetsMine />} />
        <Route path="/popups" element={<PopupsBoard />} />
        <Route path="/popups/vendor/:id" element={<PopupVendor />} />
        <Route path="/popups/mine" element={<PopupsMine />} />
        <Route path="/meals" element={<MealsBoard />} />
        <Route path="/meals/meal/:id" element={<MealDetail />} />
        <Route path="/meals/kitchen/:id" element={<KitchenPage />} />
        <Route path="/meals/mine" element={<MealsMine />} />
        <Route path="/lend-a-hand" element={<LendAHand />} />
        <Route path="/splash" element={<Splash />} />
        <Route path="/kwest" element={<KwestHome />} />
        <Route path="/kwest/help" element={<KwestHelp />} />
        <Route path="/kwest/:slug/retro" element={<KwestRetro />} />
        <Route path="/kwest/:slug" element={<KwestHunt />} />
        <Route path="/my-stamps" element={<MyStamps />} />
        <Route path="/scan" element={<ScanPortal />} />
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/profile/apply-merchant" element={<ApplyMerchant />} />
        <Route path="/profile/admin/merchants" element={<AdminMerchants />} />
        <Route path="/profile/admin/users" element={<AdminUsers />} />
        <Route path="/profile/admin/content" element={<AdminContent />} />
        <Route path="/profile/admin/test-plaque" element={<AdminTestPlaque />} />
        <Route path="/profile/admin/plaques" element={<AdminPlaques />} />
        <Route path="/profile/admin/prizes" element={<AdminPrizes />} />
        <Route path="/profile/admin/deals" element={<AdminDeals />} />
        <Route path="/profile/admin/support" element={<AdminSupport />} />
        <Route path="/profile/admin/volunteer" element={<AdminVolunteer />} />
        <Route path="/profile/admin/happenings" element={<AdminHappenings />} />
        <Route path="/profile/admin/fresh" element={<AdminFresh />} />
        <Route path="/profile/admin/splash" element={<AdminSplash />} />
        <Route path="/profile/admin/sales" element={<AdminSales />} />
        <Route path="/profile/admin/pets" element={<AdminPets />} />
        <Route path="/profile/admin/popups" element={<AdminPopups />} />
        <Route path="/profile/admin/sponsors" element={<AdminSponsors />} />
        <Route path="/profile/admin/meals" element={<AdminMeals />} />
        <Route path="/profile/admin/kwest" element={<AdminKwest />} />
        <Route path="/profile/admin/kwest/:id" element={<AdminKwestEdit />} />
        <Route path="/profile/admin/kwest/:id/field-test" element={<AdminKwestFieldTest />} />
        <Route path="/profile/admin/kwest/:id/dashboard" element={<AdminKwestDashboard />} />
        <Route path="/claim/visit" element={<ClaimVisit />} />
        <Route path="/redeem" element={<RedeemClaim />} />
        <Route path="/merchant" element={<MerchantDashboard />} />
        <Route path="/members/:id" element={<PublicProfile />} />
        <Route path="/help" element={<Help />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
