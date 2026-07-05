export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  credits_balance: number;
  rating_avg: number;
  rating_count: number;
  trade_count: number;
  location: string | null;
  bio: string | null;
  bd_member_since: number | null;
  home_zip_location: string | null;
  home_zip_lat: number | null;
  home_zip_lon: number | null;
  home_distance_preference: number | null;
  business_id?: number | null;
  business_status?: 'pending' | 'verified' | 'rejected' | null;
  business_name?: string | null;
  is_admin?: boolean;
  active_persona?: 'anonymous' | 'personal' | 'business';
}

export interface Tenant {
  id: string;
  name: string;
  config: {
    brand_name: string;
    brand_color_primary: string;
    brand_color_accent: string;
    credits_name: string;
    active_niches: string[];
    member_login_url?: string;
  };
}

export interface Niche {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  accent_color: string;
  categories: Category[];
  config: {
    require_reciprocal: boolean;
    show_duration_field: boolean;
  };
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
}

export interface Offer {
  id: string;
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
  display_name: string;
  rating_avg: number;
  rating_count: number;
  category_name: string | null;
  category_icon: string | null;
}

export interface Interest {
  id: string;
  offer_id: string;
  from_user_id: string;
  message: string | null;
  counter_offer: string | null;
  status: string;
  created_at: number;
  display_name?: string;
}

export interface Trade {
  id: string;
  offer_id: string;
  offer_owner_id: string;
  trade_partner_id: string;
  agreed_terms: string | null;
  owner_confirmed: number;
  partner_confirmed: number;
  status: string;
  completed_at: number | null;
  created_at: number;
  offer_title?: string;
  partner_name?: string;
  owner_name?: string;
}

export interface Message {
  id: string;
  from_user_id: string;
  body: string;
  created_at: number;
  display_name: string;
}

export interface CreditEntry {
  id: string;
  amount: number;
  balance_after: number;
  reason: string;
  created_at: number;
}

export interface MyTrade {
  id: string;
  status: string;
  created_at: number;
  completed_at: number | null;
  offer_owner_id: string;
  trade_partner_id: string;
  owner_confirmed: number;
  partner_confirmed: number;
  niche_name: string;
  niche_slug: string;
  offer_title: string;
  owner_display_name: string;
  partner_display_name: string;
}

export interface ApiResponse<T> {
  data: T;
  meta?: { page: number; limit: number; total: number };
}
