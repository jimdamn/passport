import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import { Spinner } from './components/ui/Spinner';
import { ErrorBoundary } from './components/ErrorBoundary';

// Pages - bottom-nav destinations and the scan loop stay eager (a spinner on
// a nav tap would be a regression for the core flow); everything else is
// lazy so the profile path doesn't pay for admin tooling, the map stack, or
// Kwest that most visits never touch.
import Home from './pages/Home';
import SSOLanding from './pages/auth/SSOLanding';
import LoginPage from './pages/auth/LoginPage';
import MyStamps from './pages/MyStamps';
import ScanPortal from './pages/ScanPortal';
import MyProfile from './pages/profile/MyProfile';
import Deals from './pages/Deals';

const ApplyMerchant = lazy(() => import('./pages/profile/ApplyMerchant'));
const AdminMerchants = lazy(() => import('./pages/profile/AdminMerchants'));
const AdminUsers = lazy(() => import('./pages/profile/AdminUsers'));
const AdminContent = lazy(() => import('./pages/profile/AdminContent'));
const AdminTestPlaque = lazy(() => import('./pages/profile/AdminTestPlaque'));
const AdminPlaques = lazy(() => import('./pages/profile/AdminPlaques'));
const AdminPrizes = lazy(() => import('./pages/profile/AdminPrizes'));

const PublicProfile = lazy(() => import('./pages/profile/PublicProfile'));
const RedeemClaim = lazy(() => import('./pages/RedeemClaim'));
const ClaimVisit = lazy(() => import('./pages/ClaimVisit'));
const MerchantDashboard = lazy(() => import('./pages/MerchantDashboard'));
const Help = lazy(() => import('./pages/Help'));
const EmbedDrawer = lazy(() => import('./pages/EmbedDrawer'));
const Explore = lazy(() => import('./pages/Explore'));
const MapRoom = lazy(() => import('./pages/explore/MapRoom'));
const Happenings = lazy(() => import('./pages/Happenings'));
const FreshToday = lazy(() => import('./pages/FreshToday'));
const FreshStand = lazy(() => import('./pages/FreshStand'));
const FreshMine = lazy(() => import('./pages/FreshMine'));
const SaleDay = lazy(() => import('./pages/SaleDay'));
const SaleDetail = lazy(() => import('./pages/SaleDetail'));
const SalesMine = lazy(() => import('./pages/SalesMine'));
const PetsBoard = lazy(() => import('./pages/PetsBoard'));
const PetPost = lazy(() => import('./pages/PetPost'));
const PetsMine = lazy(() => import('./pages/PetsMine'));
const PopupsBoard = lazy(() => import('./pages/PopupsBoard'));
const PopupVendor = lazy(() => import('./pages/PopupVendor'));
const PopupsMine = lazy(() => import('./pages/PopupsMine'));
const MealsBoard = lazy(() => import('./pages/MealsBoard'));
const MealDetail = lazy(() => import('./pages/MealDetail'));
const KitchenPage = lazy(() => import('./pages/KitchenPage'));
const MealsMine = lazy(() => import('./pages/MealsMine'));
const LendAHand = lazy(() => import('./pages/LendAHand'));
const Splash = lazy(() => import('./pages/Splash'));
const AdminDeals = lazy(() => import('./pages/profile/AdminDeals'));
const AdminSupport = lazy(() => import('./pages/profile/AdminSupport'));
const AdminVolunteer = lazy(() => import('./pages/profile/AdminVolunteer'));
const AdminHappenings = lazy(() => import('./pages/profile/AdminHappenings'));
const AdminFresh = lazy(() => import('./pages/profile/AdminFresh'));
const AdminSplash = lazy(() => import('./pages/profile/AdminSplash'));
const AdminEconomy = lazy(() => import('./pages/profile/AdminEconomy'));
const AdminSales = lazy(() => import('./pages/profile/AdminSales'));
const AdminPets = lazy(() => import('./pages/profile/AdminPets'));
const AdminPopups = lazy(() => import('./pages/profile/AdminPopups'));
const AdminMeals = lazy(() => import('./pages/profile/AdminMeals'));
const KwestHome = lazy(() => import('./pages/kwest/KwestHome'));
const KwestHelp = lazy(() => import('./pages/kwest/KwestHelp'));
const KwestHunt = lazy(() => import('./pages/kwest/KwestHunt'));
const KwestRetro = lazy(() => import('./pages/kwest/KwestRetro'));
const AdminKwest = lazy(() => import('./pages/profile/AdminKwest'));
const AdminKwestEdit = lazy(() => import('./pages/profile/AdminKwestEdit'));
const AdminKwestFieldTest = lazy(() => import('./pages/profile/AdminKwestFieldTest'));
const AdminKwestDashboard = lazy(() => import('./pages/profile/AdminKwestDashboard'));
const AdminSponsors = lazy(() => import('./pages/profile/AdminSponsors'));

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
    <Suspense fallback={<div className="spinner-center"><Spinner size="lg" /></div>}>
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
        <Route path="/profile/admin/economy" element={<AdminEconomy />} />
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
    </Suspense>
    </ErrorBoundary>
  );
}
