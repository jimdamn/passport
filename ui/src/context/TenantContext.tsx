import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import type { Tenant, Niche, ApiResponse } from '../types';

// ─── Default brand shown before any tenant data loads ─────────────────────────
const DEFAULT_TENANT: Tenant = {
  id: '',
  name: 'Lake & Locals',
  config: {
    brand_name: 'Lake & Locals',
    brand_color_primary: '#1e3320',
    brand_color_accent: '#c8860a',
    credits_name: 'KrowdKredits',
    active_niches: [],
  },
};

// ─── Hostname classification ──────────────────────────────────────────────────

// Hostnames where parent/platform branding is displayed.
// Add new KrowdKraft-owned domains here as they launch.
const PARENT_DOMAINS = new Set([
  'passport.krowdkraft.com',
  'krowdkraft.com',
  'www.krowdkraft.com',
  'localhost',
  '127.0.0.1',
]);

// Known regional hostname → data tenant slug.
// Add each new regional network here when it launches.
const REGIONAL_DOMAINS: Record<string, string> = {
  'passport.lakeandlocals.com': 'lake-locals',
  'lakeandlocals.com':          'lake-locals',
  // 'exchange.thesanjuanmtns.com': 'san-juan-mountains',
};

interface HostnameInfo {
  tenantSlug: string;
  useParentBranding: boolean;
}

function resolveHostnameInfo(hostname: string): HostnameInfo {
  // Parent domains → platform branding, primary tenant data
  if (PARENT_DOMAINS.has(hostname)) {
    return { tenantSlug: 'lake-locals', useParentBranding: true };
  }

  // Known regional domains → tenant branding, tenant data
  const regional = REGIONAL_DOMAINS[hostname];
  if (regional) {
    return { tenantSlug: regional, useParentBranding: false };
  }

  // Future-proof: exchange.newregion.com → try second hostname segment
  // Will gracefully fall back to DEFAULT_TENANT if the slug isn't in the DB.
  const parts = hostname.replace(/^www\./, '').split('.');
  if (parts.length >= 3) {
    return { tenantSlug: parts[1], useParentBranding: false };
  }

  // Last resort: treat as parent domain
  return { tenantSlug: 'lake-locals', useParentBranding: true };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface TenantContextValue {
  /** Display tenant - brand_name may be overridden on parent/platform domains */
  tenant: Tenant;
  /** Data tenant slug - use this for all API calls and auth requests */
  tenantSlug: string;
  /** True when on a KrowdKraft platform domain or localhost */
  isParentDomain: boolean;
  niches: Niche[];
  currentNiche: Niche | null;
  setCurrentNiche: (slug: string) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

interface TenantApiData {
  tenant: Tenant;
  niches: Niche[];
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const hostname = window.location.hostname;
  const { tenantSlug, useParentBranding } = resolveHostnameInfo(hostname);

  const [tenant, setTenant] = useState<Tenant>(DEFAULT_TENANT);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [currentNiche, setCurrentNicheState] = useState<Niche | null>(null);

  useEffect(() => {
    api.get<ApiResponse<TenantApiData>>(`/t/${tenantSlug}`)
      .then(res => {
        const apiTenant = res.data.tenant;

        if (useParentBranding) {
          // On parent domain: use tenant's operational data but preserve the
          // tenant's brand. KrowdKraft is credited in the topbar 'Powered by' line.
          setTenant(apiTenant);
        } else {
          // On a regional domain: show the tenant's own brand.
          setTenant(apiTenant);
        }

        const nicheList = res.data.niches || [];
        setNiches(nicheList);
        if (nicheList.length > 0) setCurrentNicheState(nicheList[0]);
      })
      .catch(() => {
        // DEFAULT_TENANT (Lake & Locals branding) stays - correct fallback for
        // any load failure or unrecognised hostname.
      });
  }, [tenantSlug, useParentBranding]);

  const setCurrentNiche = useCallback((slug: string) => {
    setCurrentNicheState(prev => {
      if (prev?.slug === slug) return prev;
      const found = niches.find(n => n.slug === slug);
      return found || prev;
    });
  }, [niches]);

  const contextValue = useMemo(() => ({
    tenant,
    tenantSlug,
    isParentDomain: useParentBranding,
    niches,
    currentNiche,
    setCurrentNiche,
  }), [tenant, tenantSlug, useParentBranding, niches, currentNiche, setCurrentNiche]);

  return (
    <TenantContext.Provider value={contextValue}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used within TenantProvider');
  return ctx;
}

