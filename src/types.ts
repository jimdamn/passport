export interface Env {
  DB: D1Database;
  PASSPORT_CONFIG: KVNamespace;
  KKAUTH: Fetcher;           // Service Binding to KKAuth Worker
  SITE_ASSETS: R2Bucket;     // R2 bucket for site images, favicons, and badges
  KKCREDITS: Fetcher;        // Service Binding to KKCredits Worker
  KKGAME: Fetcher;           // Service Binding to KKGAME Worker
  KKAUTH_APP_KEY: string;     // app_key for KKAuth (apps table)
  KKCREDITS_APP_KEY: string;  // X-App-Key for KKCredits API calls
  KKGAME_APP_KEY: string;     // X-App-Key for KKGame API calls
  INTERNAL_SECRET: string;   // Shared secret for KKAuth internal calls
  HUB_URL?: string;          // Business Hub origin (member business links)
  COOKIE_DOMAIN: string;     // e.g. .lakeandlocals.com — shared across all KrowdKraft apps
  ENVIRONMENT: string;
  ADMIN_EMAILS?: string;
  QR_SIGNING_SECRET: string;
  RESEND_API_KEY?: string;   // Resend API key for guest claim emails (optional — emails skip silently if unset)
  EXCHANGE_BASE_URL?: string; // Override for Exchange HTTPS origin (Pages project, not a service binding); defaults to prod
}


// KKAuth JWT payload — what we get back from /internal/verify-token
export interface KKAuthPayload {
  sub: string;           // KKAuth user_id as string (e.g. "1")
  email: string;
  name: string | null;
  bd_member: boolean;
  app: string | null;
  iat: number;
  exp: number;
}

// Shared profile fields returned alongside verify-token
export interface KKAuthProfile {
  avatar_url: string | null;
  home_zip_location: string | null;
  home_zip_lat: number | null;
  home_zip_lon: number | null;
  home_distance_preference: number | null;
  business_id?: number | null;
  business_status?: 'pending' | 'verified' | 'rejected' | null;
  business_name?: string | null;
  is_admin?: boolean;
  // Shared identity fields — included if KKAuth returns them alongside the token verify.
  // Used to keep Exchange D1 in sync with KKAuth when fields were updated in another app.
  display_name?: string | null;
  location?: string | null;
  bio?: string | null;
  active_persona?: 'anonymous' | 'personal' | 'business';
  personal_persona?: {
    facebook_url: string | null;
    x_handle: string | null;
    linkedin_url: string | null;
    website_url: string | null;
  } | null;
}

export interface Tenant {
  id: string;
  hostname: string;
  name: string;
  region: string;
  config: TenantConfig;
  is_active: number;
}

export interface TenantConfig {
  bd_domain: string;
  brand_name: string;
  brand_color_primary: string;
  brand_color_accent: string;
  credits_name: string;
  welcome_credits: number;
  upgrade_credits: number;
  trade_complete_credits: number;
  five_star_bonus_credits: number;
  boost_cost_credits: number;
  active_niches: string[];
  bd_signing_secret?: string;
}

export interface Niche {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  accent_color: string;
  config: NicheConfig;
  categories: Category[];
}

export interface NicheConfig {
  require_reciprocal: boolean;
  show_duration_field: boolean;
  credits_per_hour?: number;
  time_units?: string[];
}

export interface Category {
  id: string;
  niche_id: string;
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
}

export interface User {
  id: number;          // local auto-increment PK
  kkauth_uid: number;  // KKAuth user_id as integer
  tenant_id: string;
  bd_uid: string | null;
  email: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  is_active: number;
  bd_member_since: number | null;
}

export interface Offer {
  id: string;
  tenant_id: string;
  niche_id: string;
  category_id: string | null;
  user_id: string;
  title: string;
  description: string;
  offer_type: 'have' | 'want' | 'trade' | 'free';
  have_description: string | null;
  want_description: string | null;
  credits_attached: number;
  location: string | null;
  zip_code: string | null;
  zip_lat: number | null;
  zip_lon: number | null;
  is_boosted: number;
  status: string;
  view_count: number;
  interest_count: number;
  created_at: number;
  // joined fields
  display_name?: string;
  rating_avg?: number;
  rating_count?: number;
  category_name?: string;
  category_icon?: string;
}

export interface Interest {
  id: string;
  offer_id: string;
  from_user_id: string;
  message: string | null;
  counter_offer: string | null;
  status: string;
  created_at: number;
}

export interface Trade {
  id: string;
  tenant_id: string;
  niche_id: string;
  offer_id: string;
  interest_id: string;
  offer_owner_id: string;
  trade_partner_id: string;
  agreed_terms: string | null;
  owner_confirmed: number;
  partner_confirmed: number;
  status: string;
  completed_at: number | null;
  created_at: number;
}

// Hono context variable types
declare module 'hono' {
  interface ContextVariableMap {
    tenant: Tenant;
    niche: Niche;
    user: {
      sub: string;
      email: string;
      name: string | null;
      bd_member: boolean;
      tenant_id: string;
      avatar_url: string | null;
      home_zip_location: string | null;
      home_zip_lat: number | null;
      home_zip_lon: number | null;
      home_distance_preference: number | null;
      business_id: number | null;
      business_status: 'pending' | 'verified' | 'rejected' | null;
      business_name: string | null;
      is_admin?: boolean;
      active_persona: 'anonymous' | 'personal' | 'business';
      personal_persona: {
        facebook_url: string | null;
        x_handle: string | null;
        linkedin_url: string | null;
        website_url: string | null;
      } | null;
    };
  }
}
