import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../../src/types';
/// <reference types="@cloudflare/workers-types" />
import { resolveTenant } from '../../src/middleware/tenant';
import { requireAuth } from '../../src/middleware/auth';
import { authRouter } from '../../src/routers/auth';
import { scanPlaque, registerClaim, attachClaim, getStamps } from '../../src/handlers/passport';
import { getBalance, getBalanceOnly } from '../../src/handlers/credits';
import { getMember, provisionMember, getNetworkMembers } from '../../src/handlers/members';
import {
  createTestPlaque, removeTestPlaque,
  listPlaques, createPlaque, updatePlaque, deletePlaque,
  listPrizes, createPrize, updatePrize, deletePrize,
} from '../../src/handlers/admin';
import { lookupClaim, confirmClaim } from '../../src/handlers/redeem';
import { claimVisit } from '../../src/handlers/claim-visit';
import { listMyPrizes, createMyPrize, updateMyPrize, deleteMyPrize, listMyClaims, getMyBusiness, updateMyBusiness } from '../../src/handlers/merchant';
import {
  listDeals, purchaseDeal, listMyDealClaims, regenerateDealClaimCode,
  listMerchantDeals, createMerchantDeal, updateMerchantDeal, deleteMerchantDeal,
  adminListDeals, adminUpdateDeal, adminDeleteDeal, internalSweep,
} from '../../src/handlers/deals';
import {
  listHappenings, listMerchantHappenings, createHappening, updateHappening, deleteHappening,
  adminListHappenings, adminUpdateHappening, adminDeleteHappening,
} from '../../src/handlers/happenings';
import {
  listFresh, listFreshStands, getFreshStand, listFreshSeasons,
  listMyFresh, createFreshStand, updateFreshStand, setFreshStandVisibility, deleteFreshStand,
  createFreshPost, updateFreshPost, setFreshPostSoldOut, relistFreshPost, deleteFreshPost,
  adminListFreshStands, adminListFreshPosts, adminHideFreshStand, adminHideFreshPost,
  uploadFreshPhoto,
} from '../../src/handlers/fresh';
import {
  listSales, listSalePins, listSaleEvents, getSale,
  listMySales, createSale, updateSale, setSaleVisibility, wrapSale, deleteSale, uploadSalePhoto,
  adminListSales, adminHideSale,
} from '../../src/handlers/sales';
import {
  listStops, listStopPins, listPopupEvents, getVendor,
  listMyPopups, createVendor, updateVendor, setVendorVisibility, deleteVendor,
  createStop, updateStop, checkInStop, setStopSoldOut, cancelStop, deleteStop, uploadPopupPhoto,
  adminListVendors, adminListStops, adminHideVendor, adminHideStop,
} from '../../src/handlers/popups';
import {
  listMeals, listMealPins, getKitchen, getMeal,
  listMyMeals, createKitchen, updateKitchen, setKitchenVisibility, deleteKitchen,
  createMeal, updateMeal, setMealSoldOut, cancelMeal, deleteMeal, uploadMealPhoto,
  adminListKitchens, adminListMeals, adminHideKitchen, adminHideMeal,
} from '../../src/handlers/meals';
import {
  listPetPosts, listPetPins, getPetPost,
  listMyPetPosts, createPetPost, updatePetPost, resolvePetPost, renewPetPost, deletePetPost,
  revealPetContact, uploadPetPhoto, adminListPetPosts, adminHidePetPost,
} from '../../src/handlers/pets';
import { geocodeAddress } from '../../src/handlers/geocode';
import { getAroundInterests, putAroundInterests } from '../../src/handlers/around';
import {
  getSplashEligible, submitSplash, getMySplash, updateSplashCaption, withdrawSplash,
  getSplashMediaView, getSplashMediaRaw, respondToSplashOffer, regenerateSplashCertificateCode,
  requestSplashVideoUpload, adminListSplash, adminRemoveSplash, adminGetSplashConfig, adminSetSplashConfig,
} from '../../src/handlers/splash';
import {
  getSplashInbox, putSplashSettings, acceptSplash, declineSplash, getSplashInboxMediaView,
  createSplashOffer, withdrawSplashOffer, getSplashMediaDownload, markSplashOriginalUnlocked, internalSplashSweep,
} from '../../src/handlers/splash-internal';

import { listExchangeOffers } from '../../src/handlers/exchange';
import { getContentSummary } from '../../src/handlers/content';
import {
  adminListExchangeOffers, adminListFieldNotesStories,
  adminSetExchangeVisibility, adminSetFieldNotesVisibility,
} from '../../src/handlers/adminContent';
import { rollHunt } from '../../src/lib/game';
import {
  listKwestHunts, getKwestHunt, getKwestRules, startKwest, ackKwest, getKwestState, revealKwest,
  getKwestRetro, attachKwestGuest, setKwestDisplayChoice, getMyKwestProgress, playKwestMinigame,
} from '../../src/handlers/kwest';
import {
  adminListHunts, adminCreateHunt, adminGetHunt, adminUpdateHunt, adminDeleteHunt,
  adminListSteps, adminCreateStep, adminUpdateStep, adminDeleteStep, adminReorderSteps, adminRecordFieldTest,
  adminSetHuntStatus, adminCreateTestRun, adminGetDashboard, adminPlayerLookup, adminHealthCheck,
  adminListClaims, adminUpdateClaim, adminSetRetroPublished, adminSetWeatherPause,
} from '../../src/handlers/kwest-admin';
import { internalKwestLifecycle, internalKwestRetention } from '../../src/handlers/kwest-internal';
import {
  submitSupport, getMySupport, adminListSupport, adminSupportCount, adminUpdateSupport,
  internalSubmitSupport, internalSupportRetention,
} from '../../src/handlers/support';
import {
  resolveSponsorDrawer, sponsorBeacon, uploadSponsorPhoto,
  adminListSponsors, adminCreateSponsor, adminUpdateSponsor, adminSetSponsorActive,
  adminEndSponsor, adminDeleteSponsor, adminGetSponsorFeature, adminSetSponsorFeature,
  adminGetInlineSponsorsFeature, adminSetInlineSponsorsFeature,
} from '../../src/handlers/sponsors';

import { logger } from '../../src/lib/logger';

const app = new Hono<{ Bindings: Env }>();

// Allowlist only — reflecting arbitrary origins with credentials:true would
// let any site make authenticated cookie-bearing requests to this API.
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    try {
      const { hostname } = new URL(origin);
      const allowed =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.endsWith('.pages.dev') ||
        hostname === 'lakeandlocals.com' ||
        hostname.endsWith('.lakeandlocals.com');
      return allowed ? origin : '';
    } catch {
      return '';
    }
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-App-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Auth — handled by KKAuth adapter (no tenant middleware needed)
app.route('/api/auth', authRouter);

// Public tenant bootstrap — returns tenant config
// Called by TenantContext on every page load to configure branding.
app.get('/api/t/:tenant', async (c) => {
  const tenantId = c.req.param('tenant');

  const tenantRow = await c.env.DB.prepare(
    'SELECT * FROM tenants WHERE id = ? AND is_active = 1'
  ).bind(tenantId).first<any>();

  if (!tenantRow) return c.json({ error: 'Tenant not found' }, 404);

  const tenant = { ...tenantRow, config: JSON.parse(tenantRow.config || '{}') };

  // Passport has no niches/categories tables — return an empty list so the
  // shared TenantContext shape stays compatible with the other apps.
  return c.json({ data: { tenant, niches: [] } });
});


// Tenant-scoped API
const tenantApp = new Hono<{ Bindings: Env }>();
tenantApp.use('*', resolveTenant);
tenantApp.use('*', requireAuth);

tenantApp.get('/passport/stamps', getStamps);
tenantApp.post('/passport/claims/attach', attachClaim);
tenantApp.get('/credits/balance', getBalance);
tenantApp.get('/credits/balance-only', getBalanceOnly);
tenantApp.get('/me/content-summary', getContentSummary);
tenantApp.get('/admin/content/exchange', adminListExchangeOffers);
tenantApp.get('/admin/content/field-notes', adminListFieldNotesStories);
tenantApp.post('/admin/content/exchange/:id/visibility', adminSetExchangeVisibility);
tenantApp.post('/admin/content/field-notes/:id/visibility', adminSetFieldNotesVisibility);
tenantApp.post('/admin/test-plaque', createTestPlaque);
tenantApp.delete('/admin/test-plaque', removeTestPlaque);
tenantApp.get('/admin/plaques', listPlaques);
tenantApp.post('/admin/plaques', createPlaque);
tenantApp.put('/admin/plaques/:id', updatePlaque);
tenantApp.delete('/admin/plaques/:id', deletePlaque);
tenantApp.get('/admin/prizes', listPrizes);
tenantApp.post('/admin/prizes', createPrize);
tenantApp.put('/admin/prizes/:id', updatePrize);
tenantApp.delete('/admin/prizes/:id', deletePrize);
tenantApp.post('/claim/visit', claimVisit);
tenantApp.post('/redeem/lookup', lookupClaim);
tenantApp.post('/redeem/confirm', confirmClaim);
tenantApp.get('/merchant/business', getMyBusiness);
tenantApp.patch('/merchant/business', updateMyBusiness);
tenantApp.get('/merchant/prizes', listMyPrizes);
tenantApp.post('/merchant/prizes', createMyPrize);
tenantApp.put('/merchant/prizes/:id', updateMyPrize);
tenantApp.delete('/merchant/prizes/:id', deleteMyPrize);
tenantApp.get('/merchant/claims', listMyClaims);
tenantApp.post('/deals/:id/claim', purchaseDeal);
tenantApp.get('/deals/mine', listMyDealClaims);
tenantApp.post('/deals/claims/:id/code', regenerateDealClaimCode);
tenantApp.get('/merchant/deals', listMerchantDeals);
tenantApp.post('/merchant/deals', createMerchantDeal);
tenantApp.put('/merchant/deals/:id', updateMerchantDeal);
tenantApp.delete('/merchant/deals/:id', deleteMerchantDeal);
tenantApp.get('/admin/deals', adminListDeals);
tenantApp.put('/admin/deals/:id', adminUpdateDeal);
tenantApp.delete('/admin/deals/:id', adminDeleteDeal);
tenantApp.get('/merchant/happenings', listMerchantHappenings);
tenantApp.post('/merchant/happenings', createHappening);
tenantApp.put('/merchant/happenings/:id', updateHappening);
tenantApp.delete('/merchant/happenings/:id', deleteHappening);
tenantApp.get('/admin/happenings', adminListHappenings);
tenantApp.put('/admin/happenings/:id', adminUpdateHappening);
tenantApp.delete('/admin/happenings/:id', adminDeleteHappening);

// Fresh Today - resident-owned farm-stand board (any signed-in user, no
// merchant verification). Public reads are registered on the root app below,
// alongside listHappenings.
tenantApp.get('/fresh/mine', listMyFresh);
tenantApp.post('/fresh/upload', uploadFreshPhoto);
tenantApp.post('/fresh/stands', createFreshStand);
tenantApp.put('/fresh/stands/:id', updateFreshStand);
tenantApp.post('/fresh/stands/:id/visibility', setFreshStandVisibility);
tenantApp.delete('/fresh/stands/:id', deleteFreshStand);
tenantApp.post('/fresh/stands/:id/posts', createFreshPost);
tenantApp.put('/fresh/posts/:id', updateFreshPost);
tenantApp.post('/fresh/posts/:id/sold-out', setFreshPostSoldOut);
tenantApp.post('/fresh/posts/:id/relist', relistFreshPost);
tenantApp.delete('/fresh/posts/:id', deleteFreshPost);
tenantApp.get('/admin/fresh/stands', adminListFreshStands);
tenantApp.get('/admin/fresh/posts', adminListFreshPosts);
tenantApp.post('/admin/fresh/stands/:id/hide', adminHideFreshStand);
tenantApp.post('/admin/fresh/posts/:id/hide', adminHideFreshPost);

tenantApp.get('/admin/splash', adminListSplash);
tenantApp.post('/admin/splash/:id/remove', adminRemoveSplash);
tenantApp.get('/admin/splash/config', adminGetSplashConfig);
tenantApp.post('/admin/splash/config', adminSetSplashConfig);

// Social Splash - private guest-content pipeline (Increment 2: guest submit +
// My Splash, photos only). No bare GET /splash/:id route exists (every :id
// route below has a trailing suffix), so /splash/mine has no "mine gotcha"
// collision to work around - safe on tenantApp like /fresh/mine above. The
// raw media-serving route is public (loaded via <img src>, no Bearer) and is
// registered on the root app below, alongside the other public reads.
tenantApp.get('/splash/eligible', getSplashEligible);
tenantApp.post('/splash/submit', submitSplash);
tenantApp.post('/splash/video/direct-upload', requestSplashVideoUpload);
tenantApp.get('/splash/mine', getMySplash);
tenantApp.patch('/splash/:id/caption', updateSplashCaption);
tenantApp.post('/splash/:id/withdraw', withdrawSplash);
tenantApp.get('/splash/media/:id/view', getSplashMediaView);
tenantApp.post('/splash/offers/:offerId/respond', respondToSplashOffer);
tenantApp.post('/splash/certificates/:id/code', regenerateSplashCertificateCode);

// Sale Day - yard/barn/moving/estate sales and auctions (any signed-in user,
// no merchant verification). Public reads are registered on the root app
// below, alongside listFresh/listHappenings. /sales/mine is ALSO registered
// on the root app (not here) - see the note by app.get('/api/t/:tenant/
// sales/mine', ...) below; mounting it on tenantApp would lose to the
// public /sales/:id pattern and 404 as "Sale not found." (same class of bug
// as GET /kwest/mine, documented further down in this file).
tenantApp.post('/sales/upload', uploadSalePhoto);
tenantApp.post('/sales', createSale);
tenantApp.put('/sales/:id', updateSale);
tenantApp.post('/sales/:id/visibility', setSaleVisibility);
tenantApp.post('/sales/:id/wrap', wrapSale);
tenantApp.delete('/sales/:id', deleteSale);
tenantApp.get('/admin/sales', adminListSales);
tenantApp.post('/admin/sales/:id/hide', adminHideSale);

// Pop-Ups - mobile/pop-up business board (any signed-in user, no merchant
// verification). Public reads are registered on the root app below, alongside
// listFresh/listSales. No "mine" registration-order gotcha here - the public
// detail route is nested at /popups/vendors/:id, not /popups/:id, so it never
// shares a path prefix with /popups/mine (ARCHITECTURE.md §7 "mine" note).
tenantApp.post('/popups/upload', uploadPopupPhoto);
tenantApp.get('/popups/mine', listMyPopups);
tenantApp.post('/popups/vendors', createVendor);
tenantApp.put('/popups/vendors/:id', updateVendor);
tenantApp.post('/popups/vendors/:id/visibility', setVendorVisibility);
tenantApp.delete('/popups/vendors/:id', deleteVendor);
tenantApp.post('/popups/vendors/:id/stops', createStop);
tenantApp.put('/popups/stops/:id', updateStop);
tenantApp.post('/popups/stops/:id/checkin', checkInStop);
tenantApp.post('/popups/stops/:id/sold-out', setStopSoldOut);
tenantApp.post('/popups/stops/:id/cancel', cancelStop);
tenantApp.delete('/popups/stops/:id', deleteStop);
tenantApp.get('/admin/popups/vendors', adminListVendors);
tenantApp.get('/admin/popups/stops', adminListStops);
tenantApp.post('/admin/popups/vendors/:id/hide', adminHideVendor);
tenantApp.post('/admin/popups/stops/:id/hide', adminHideStop);

// Community Table - community-meal board (fire halls, churches, Legion/VFW;
// any signed-in user, no organization verification). Public reads are
// registered on the root app below, alongside listFresh/listSales/listStops.
// No "mine" registration-order gotcha here - the public detail routes are
// nested at /meals/kitchens/:id and /meals/meals/:id, not directly
// /meals/:id, so neither shares a path prefix with /meals/mine
// (ARCHITECTURE.md §7 "mine" note; same reasoning as Pop-Ups' /popups/mine).
tenantApp.get('/meals/mine', listMyMeals);
tenantApp.post('/meals/upload', uploadMealPhoto);
tenantApp.post('/meals/kitchens', createKitchen);
tenantApp.put('/meals/kitchens/:id', updateKitchen);
tenantApp.post('/meals/kitchens/:id/visibility', setKitchenVisibility);
tenantApp.delete('/meals/kitchens/:id', deleteKitchen);
tenantApp.post('/meals/kitchens/:id/meals', createMeal);
tenantApp.put('/meals/meals/:id', updateMeal);
tenantApp.post('/meals/meals/:id/sold-out', setMealSoldOut);
tenantApp.post('/meals/meals/:id/cancel', cancelMeal);
tenantApp.delete('/meals/meals/:id', deleteMeal);
tenantApp.get('/admin/meals/kitchens', adminListKitchens);
tenantApp.get('/admin/meals/meals', adminListMeals);
tenantApp.post('/admin/meals/kitchens/:id/hide', adminHideKitchen);
tenantApp.post('/admin/meals/meals/:id/hide', adminHideMeal);

// Home Safe - lost-and-found pet posts (any signed-in user; ONE table, no
// stand/profile entity). Public reads are registered on the root app below,
// alongside listFresh/listSales/listStops/listMeals. /pets/mine is ALSO
// registered on the root app (not here) - see the note by
// app.get('/api/t/:tenant/pets/mine', ...) below; mounting it on tenantApp
// would lose to the public /pets/:id pattern and 404 as "Post not found."
// (same class of bug as GET /sales/mine, documented further up in this file).
// No credits, no KKGame calls, no notifications, ever (standing constraint,
// HOME-SAFE-BUILD-PLAN.md).
tenantApp.post('/pets/upload', uploadPetPhoto);
tenantApp.post('/pets', createPetPost);
tenantApp.put('/pets/posts/:id', updatePetPost);
tenantApp.post('/pets/posts/:id/home-safe', resolvePetPost);
tenantApp.post('/pets/posts/:id/renew', renewPetPost);
tenantApp.post('/pets/posts/:id/contact', revealPetContact);
tenantApp.delete('/pets/posts/:id', deletePetPost);
tenantApp.get('/admin/pets', adminListPetPosts);
tenantApp.post('/admin/pets/:id/hide', adminHidePetPost);

// Address geocoding proxy - used by the Sale Day and Fresh Today pin-picker
// forms. Server-side because the US Census Geocoder sends no CORS headers;
// a direct browser fetch to it is silently blocked and always falls through
// to the weaker Nominatim-only path. No tenant data touched - authenticated
// purely to keep this from being an open geocoding proxy for anyone on the
// internet.
tenantApp.get('/geocode', geocodeAddress);

// Around Town - private per-member interest picks that order the board's
// lens row. No public read, no admin surface (nothing to moderate).
tenantApp.get('/around/interests', getAroundInterests);
tenantApp.put('/around/interests', putAroundInterests);

// Support messages ("Talk to us") - unified platform inbox (kk-business forwards in).
tenantApp.get('/support/mine', getMySupport);
tenantApp.get('/admin/support', adminListSupport);
tenantApp.get('/admin/support/count', adminSupportCount);
tenantApp.patch('/admin/support/:id', adminUpdateSupport);

// Sponsor Drawer - admin-created "Brought to you by X" route sponsorships.
// Public resolve + beacon are registered on the root app below (optional
// auth, frictionless-reads standing order - see resolveSponsorDrawer).
tenantApp.post('/sponsors/upload', uploadSponsorPhoto);
tenantApp.get('/admin/sponsors', adminListSponsors);
tenantApp.post('/admin/sponsors', adminCreateSponsor);
tenantApp.put('/admin/sponsors/:id', adminUpdateSponsor);
tenantApp.post('/admin/sponsors/:id/active', adminSetSponsorActive);
tenantApp.post('/admin/sponsors/:id/end', adminEndSponsor);
tenantApp.delete('/admin/sponsors/:id', adminDeleteSponsor);
tenantApp.get('/admin/sponsors/feature', adminGetSponsorFeature);
tenantApp.post('/admin/sponsors/feature', adminSetSponsorFeature);
tenantApp.get('/admin/sponsors/inline-feature', adminGetInlineSponsorsFeature);
tenantApp.post('/admin/sponsors/inline-feature', adminSetInlineSponsorsFeature);

// KrowdKwest - guest progress migrates onto the account on sign-in.
tenantApp.post('/kwest/attach', attachKwestGuest);
tenantApp.post('/kwest/:slug/display-choice', setKwestDisplayChoice);
// NOTE: GET /kwest/mine is registered on the root app, BEFORE the
// guest-friendly GET /kwest/:slug pattern below - Hono resolves overlapping
// patterns by registration order (first match wins), not static-over-dynamic
// priority, so mounting it here (after tenantApp's routes are flattened in)
// would lose to :slug and 404 as "Hunt not found". See getMyKwestProgress.

// KrowdKwest admin (increment 4)
tenantApp.get('/admin/kwest', adminListHunts);
tenantApp.post('/admin/kwest', adminCreateHunt);
tenantApp.get('/admin/kwest/:id', adminGetHunt);
tenantApp.put('/admin/kwest/:id', adminUpdateHunt);
tenantApp.delete('/admin/kwest/:id', adminDeleteHunt);
tenantApp.post('/admin/kwest/:id/status', adminSetHuntStatus);
tenantApp.get('/admin/kwest/:id/steps', adminListSteps);
tenantApp.post('/admin/kwest/:id/steps', adminCreateStep);
tenantApp.put('/admin/kwest/steps/:stepId', adminUpdateStep);
tenantApp.delete('/admin/kwest/steps/:stepId', adminDeleteStep);
tenantApp.post('/admin/kwest/:id/steps/reorder', adminReorderSteps);
tenantApp.post('/admin/kwest/steps/:stepId/field-test', adminRecordFieldTest);
tenantApp.post('/admin/kwest/:id/test-run', adminCreateTestRun);
tenantApp.post('/admin/kwest/:id/health-check', adminHealthCheck);
tenantApp.get('/admin/kwest/:id/dashboard', adminGetDashboard);
tenantApp.get('/admin/kwest/:id/players', adminPlayerLookup);
tenantApp.get('/admin/kwest/:id/claims', adminListClaims);
tenantApp.post('/admin/kwest/claims/:claimId', adminUpdateClaim);
tenantApp.post('/admin/kwest/:id/retro', adminSetRetroPublished);
tenantApp.post('/admin/kwest/:id/weather-pause', adminSetWeatherPause);

// Digital Treasure Hunt — thin proxy to KKGame. Called on route changes for
// logged-in users; the win reveal arrives via the KKAuth game-toast channel,
// so a miss (the overwhelmingly common case) needs no client handling.
tenantApp.post('/hunt/roll', async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const body = await c.req.json<{ page_ref?: string }>().catch(() => ({} as { page_ref?: string }));

  const result = await rollHunt(c.env, {
    user_id: Number(user.sub),
    tenant_id: tenant.id,
    source_app: 'passport',
    page_ref: typeof body.page_ref === 'string' ? body.page_ref.slice(0, 200) : undefined,
  });

  return c.json({ data: result ?? { eligible: false, won: false } });
});

// Cron backstop for deal-claim expiry (X-Internal-Secret protected)
app.post('/api/internal/deals/sweep', internalSweep);
app.post('/api/internal/members/provision', provisionMember);
// Cron backstop for KrowdKwest lifecycle + retention (X-Internal-Secret protected)
app.post('/api/internal/kwest/lifecycle', internalKwestLifecycle);
app.post('/api/internal/kwest/retention', internalKwestRetention);
// Support inbox forwarding (kk-business) + retention sweep (X-Internal-Secret protected)
app.post('/api/internal/support', internalSubmitSupport);
app.post('/api/internal/support/retention', internalSupportRetention);
// Social Splash Bridge C - kk-business's merchant inbox (X-Internal-Secret +
// re-verified merchant Bearer, checked per-handler - see requireMerchantBridge
// in splash-internal.ts)
app.get('/api/internal/splash/inbox', getSplashInbox);
app.put('/api/internal/splash/settings', putSplashSettings);
app.post('/api/internal/splash/:id/accept', acceptSplash);
app.post('/api/internal/splash/:id/decline', declineSplash);
app.get('/api/internal/splash/:id/media/view', getSplashInboxMediaView);
app.post('/api/internal/splash/:id/offer', createSplashOffer);
app.post('/api/internal/splash/offers/:offerId/withdraw', withdrawSplashOffer);
app.get('/api/internal/splash/:id/media/download', getSplashMediaDownload);
app.post('/api/internal/splash/:id/original-unlocked', markSplashOriginalUnlocked);
// Cron backstop for Social Splash lifecycle sweep (X-Internal-Secret protected)
app.post('/api/internal/splash/sweep', internalSplashSweep);

// Public Passport Scan & Claims APIs (Tenant-scoped, Guest-friendly)
app.post('/api/t/:tenant/passport/scan', resolveTenant, scanPlaque);
app.get('/api/t/:tenant/deals', resolveTenant, listDeals);
app.get('/api/t/:tenant/exchange/offers', resolveTenant, listExchangeOffers);
app.get('/api/t/:tenant/happenings', resolveTenant, listHappenings);
app.get('/api/t/:tenant/fresh', resolveTenant, listFresh);
app.get('/api/t/:tenant/fresh/stands', resolveTenant, listFreshStands);
app.get('/api/t/:tenant/fresh/stands/:id', resolveTenant, getFreshStand);
app.get('/api/t/:tenant/fresh/seasons', resolveTenant, listFreshSeasons);
app.get('/api/t/:tenant/sales', resolveTenant, listSales);
// Registered BEFORE /sales/:id below - Hono matches overlapping patterns by
// registration order, not static-over-dynamic priority, so :id would
// otherwise swallow these as a sale id and 404.
app.get('/api/t/:tenant/sales/pins', resolveTenant, listSalePins);
app.get('/api/t/:tenant/sales/events', resolveTenant, listSaleEvents);
// Also registered BEFORE /sales/:id, and on the root app rather than
// tenantApp, for the same reason GET /kwest/mine is below: Hono resolves
// overlapping patterns by registration order, not static-over-dynamic
// priority, so "mine" would otherwise be swallowed as a sale id and 404 as
// "Sale not found." requireAuth is chained inline since this route isn't on
// tenantApp.
app.get('/api/t/:tenant/sales/mine', resolveTenant, requireAuth, listMySales);
app.get('/api/t/:tenant/sales/:id', resolveTenant, getSale);
// Pop-Ups - the feed, then the map pins (both static segments), then the
// vendor detail route. Registered in this order per the plan's own §1.2 note
// even though no actual collision exists here (/popups/pins is a distinct
// prefix from /popups/vendors/:id) - keeps the file's ordering convention
// consistent with every other board module.
app.get('/api/t/:tenant/popups', resolveTenant, listStops);
app.get('/api/t/:tenant/popups/pins', resolveTenant, listStopPins);
app.get('/api/t/:tenant/popups/events', resolveTenant, listPopupEvents);
app.get('/api/t/:tenant/popups/vendors/:id', resolveTenant, getVendor);
// Community Table - the feed, then the map pins (static segment), then the
// kitchen detail route, then the meal detail route. Registered in this order
// per the plan's own note even where no actual collision exists (each
// segment after /meals/ is a distinct literal - "pins" vs "kitchens" vs
// "meals" - same as Pop-Ups' equivalent note) - keeps the file's ordering
// convention consistent with every other board module.
app.get('/api/t/:tenant/meals', resolveTenant, listMeals);
app.get('/api/t/:tenant/meals/pins', resolveTenant, listMealPins);
app.get('/api/t/:tenant/meals/kitchens/:id', resolveTenant, getKitchen);
app.get('/api/t/:tenant/meals/meals/:id', resolveTenant, getMeal);
// Home Safe - the feed, then the map pins (static segment), then the post
// detail route. /pets/pins registered BEFORE /pets/:id - Hono matches
// overlapping patterns by registration order, not static-over-dynamic
// priority, so :id would otherwise swallow "pins" as a post id and 404
// (same lesson as Sale Day's /sales/pins note above).
app.get('/api/t/:tenant/pets', resolveTenant, listPetPosts);
app.get('/api/t/:tenant/pets/pins', resolveTenant, listPetPins);
// Also registered BEFORE /pets/:id, and on the root app rather than
// tenantApp, for the same reason GET /sales/mine is above: Hono resolves
// overlapping patterns by registration order, not static-over-dynamic
// priority, so "mine" would otherwise be swallowed as a post id and 404 as
// "Post not found." requireAuth is chained inline since this route isn't on
// tenantApp.
app.get('/api/t/:tenant/pets/mine', resolveTenant, requireAuth, listMyPetPosts);
app.get('/api/t/:tenant/pets/:id', resolveTenant, getPetPost);
app.post('/api/t/:tenant/support', resolveTenant, submitSupport);
// Sponsor Drawer public reads - optional auth (frictionless-reads standing
// order), read inline inside the handlers rather than via requireAuth.
app.get('/api/t/:tenant/sponsor-drawer/resolve', resolveTenant, resolveSponsorDrawer);
app.post('/api/t/:tenant/sponsor-drawer/beacon', resolveTenant, sponsorBeacon);
app.post('/api/t/:tenant/passport/claims/register', resolveTenant, registerClaim);
app.get('/api/t/:tenant/network-members', resolveTenant, getNetworkMembers);
app.get('/api/t/:tenant/members/:id', resolveTenant, getMember);
// KrowdKwest - real-world GPS clue hunt. Guest-friendly (no account
// required to play); a finish requires signing in (see attach, above).
app.get('/api/t/:tenant/kwest', resolveTenant, listKwestHunts);
// Registered BEFORE the guest-friendly GET /kwest/:slug pattern below -
// Hono resolves overlapping patterns by registration order, not
// static-over-dynamic priority, so "mine" would otherwise be swallowed as a
// slug and 404. requireAuth chained inline since this route isn't on tenantApp.
app.get('/api/t/:tenant/kwest/mine', resolveTenant, requireAuth, getMyKwestProgress);
app.get('/api/t/:tenant/kwest/:slug', resolveTenant, getKwestHunt);
app.get('/api/t/:tenant/kwest/:slug/rules', resolveTenant, getKwestRules);
app.post('/api/t/:tenant/kwest/:slug/start', resolveTenant, startKwest);
app.post('/api/t/:tenant/kwest/:slug/ack', resolveTenant, ackKwest);
app.get('/api/t/:tenant/kwest/:slug/state', resolveTenant, getKwestState);
app.post('/api/t/:tenant/kwest/:slug/reveal', resolveTenant, revealKwest);
app.get('/api/t/:tenant/kwest/:slug/retro', resolveTenant, getKwestRetro);
app.post('/api/t/:tenant/kwest/minigame/:offerId', resolveTenant, playKwestMinigame);

app.get('/api/t/:tenant/passport/members', resolveTenant, async (c) => {
  const tenant = c.get('tenant');
  // kkauth_uid is the public user id across all KrowdKraft apps — never expose
  // the local AUTOINCREMENT row id.
  const members = await c.env.DB.prepare(`
    SELECT kkauth_uid as id, display_name, location, bio, avatar_url, bd_member_since, created_at
    FROM users
    WHERE tenant_id = ? AND is_active = 1 AND bd_uid IS NOT NULL
    ORDER BY created_at DESC
  `).bind(tenant.id).all<any>();
  return c.json({ data: members.results || [] });
});

// Social Splash's signed media-view raw route - public (no Bearer possible
// from an <img src>), gated entirely by the HMAC token minted by the authed
// GET .../splash/media/:id/view above.
app.get('/api/t/:tenant/splash/media/:id/raw', resolveTenant, getSplashMediaRaw);

app.route('/api/t/:tenant', tenantApp);

app.onError((err, c) => {
  logger.error(err.message ?? 'Internal server error', {
    path: c.req.path,
    error_code: (err as { status?: number }).status ?? 500,
  });
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status }, err.status as any);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message, status: 500 }, 500);
});

// The Pages EventContext must ride along as Hono's ExecutionContext - without
// it, any handler touching c.executionCtx throws after its work committed.
export const onRequest: PagesFunction<Env> = (context) =>
  app.fetch(context.request, context.env, {
    waitUntil: (p) => context.waitUntil(p),
    passThroughOnException: () => context.passThroughOnException(),
  } as ExecutionContext);
