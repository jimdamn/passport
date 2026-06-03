import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';

import NicheIcon from '../components/ui/NicheIcon';

export default function Home() {
  const { user } = useAuth();
  const { tenant, niches, isParentDomain } = useTenant();

  // Member login URL -- use tenant config override if set, otherwise derive
  // from hostname: passport.lakeandlocals.com --> https://www.lakeandlocals.com/login
  const hostname = window.location.hostname;
  const mainSiteUrl = !isParentDomain
    ? (tenant.config.member_login_url ?? `https://www.${hostname.replace(/^passport\./, '')}/login`)
    : null;
  const navigate = useNavigate();

  useEffect(() => {
    // Load and init Passport SDK dynamically
    const scriptId = 'passport-sdk-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    
    const initSDK = () => {
      const win = window as any;
      if (win.PassportSDK) {
        win.PassportSDK.init({
          baseUrl: window.location.origin
        });
      }
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = '/passport-sdk.js';
      script.onload = initSDK;
      document.body.appendChild(script);
    } else {
      initSDK();
    }

    // Cleanup launcher and drawer elements on unmount to prevent double renders
    return () => {
      const win = window as any;
      if (win.PassportSDK) {
        win.PassportSDK.close();
        // Remove elements
        const launcher = document.querySelector('.passport-launcher');
        const container = document.querySelector('.passport-drawer-container');
        if (launcher) launcher.remove();
        if (container) container.remove();
        win.PassportSDK.isOpen = false;
        win.PassportSDK.elements = {};
      }
    };
  }, []);

  return (
    <div>
      <h1 className="page-title">
        {user ? `Welcome back, ${user.display_name.split(' ')[0]}.` : `${tenant?.config.brand_name ?? 'Lake & Locals'} Passport`}
      </h1>

      {!user && (
        <div className="card" style={{ marginBottom: 24 }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.95rem', marginBottom: 16, lineHeight: 1.6 }}>
            The Passport is an exploration platform for your region — a place to discover scenic spots, boutiques,
            and dining destinations, check in with neighbors, and support regional businesses.
            Earn {tenant?.config.credits_name ?? 'KrowdKredits'} when you scan and use them to unlock rewards.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a href="/auth/login" className="btn btn-primary btn-block">
              Join the Passport
            </a>
            {!isParentDomain && mainSiteUrl && (
              <a
                href={mainSiteUrl}
                className="btn btn-secondary btn-block"
                target="_blank"
                rel="noreferrer"
              >
                I'm a {tenant.config.brand_name} member &rarr;
              </a>
            )}
          </div>
        </div>
      )}

      {niches.length === 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
          minHeight: '260px'
        }}>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              style={{
                height: '110px',
                background: 'var(--white)',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--r-md)',
                opacity: 0.5,
              }}
            />
          ))}
        </div>
      ) : (
        <>
          <p className="section-title">Browse by category</p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}>
            {niches.map(niche => (
              <button
                key={niche.id}
                onClick={() => navigate(`/${niche.slug}`)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '20px 16px',
                  background: 'var(--white)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  minHeight: 44,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--amber)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(200,134,10,0.12)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                }}
              >
                <span style={{ lineHeight: 1 }}>
                  <NicheIcon name={niche.icon} size={28} />
                </span>
                <div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 'bold', color: 'var(--green)', fontSize: '1rem' }}>
                    {niche.name}
                  </div>
                  {niche.description && (
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.78rem', color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
                      {niche.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
