import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { getDeals, claimWindowLabel, type Deal } from '../api/deals';
import { Map, Tag, Award, Flame, Store } from 'lucide-react';

export default function Home() {
  const { user } = useAuth();
  const { tenant, tenantSlug, isParentDomain } = useTenant();
  const navigate = useNavigate();

  // Member login URL -- use tenant config override if set, otherwise derive
  // from hostname: passport.lakeandlocals.com --> https://www.lakeandlocals.com/login
  const hostname = window.location.hostname;
  const mainSiteUrl = !isParentDomain
    ? (tenant.config.member_login_url ?? `https://www.${hostname.replace(/^passport\./, '')}/login`)
    : null;

  const [deals, setDeals] = useState<Deal[]>([]);

  useEffect(() => {
    getDeals(tenantSlug)
      .then(res => setDeals(res.data || []))
      .catch(() => { /* home still renders without deals */ });
  }, [tenantSlug]);

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

  const hotDeals = deals.filter(d => d.is_hot_deal === 1);
  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  const actionCards = [
    {
      icon: <Map size={28} style={{ color: 'var(--amber)' }} />,
      title: 'Explore',
      blurb: `Find places to scan, check in, and earn ${creditsName}.`,
      to: '/explore',
    },
    {
      icon: <Tag size={28} style={{ color: 'var(--amber)' }} />,
      title: 'Deals',
      blurb: deals.length > 0
        ? `${deals.length} live deal${deals.length === 1 ? '' : 's'} — spend your kredits at local businesses.`
        : 'Spend your kredits on real deals at local businesses.',
      to: '/deals',
    },
    {
      icon: <Award size={28} style={{ color: 'var(--amber)' }} />,
      title: 'My Stamps',
      blurb: 'Your collection, wins, and prize claims.',
      to: '/my-stamps',
    },
  ];

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
            Earn {creditsName} when you scan and use them to unlock rewards.
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

      {hotDeals.length > 0 && (
        <>
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--error, #c0392b)' }}>
            <Flame size={16} /> Hot deals — going fast
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {hotDeals.map(deal => (
              <button
                key={deal.id}
                onClick={() => navigate('/deals')}
                className="card"
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                  background: 'var(--white)', padding: '14px 16px', width: '100%',
                  border: '1px solid var(--border)', borderLeft: '4px solid var(--error, #c0392b)',
                  borderRadius: 'var(--r-md)', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: '0.95rem', marginBottom: 2 }}>
                    {deal.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <Store size={11} /> {deal.merchant_name ?? 'Local merchant'}
                    {' · '}{deal.quantity_left === -1 ? 'Unlimited' : `${deal.quantity_left} left`}
                    {' · '}Use within {claimWindowLabel(deal.claim_window_minutes)}
                  </div>
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--amber)', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>
                  {deal.kredit_price} <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--muted)' }}>kredits</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="section-title">Your Passport</p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12,
      }}>
        {actionCards.map(card => (
          <button
            key={card.to}
            onClick={() => navigate(card.to)}
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
            <span style={{ lineHeight: 1 }}>{card.icon}</span>
            <div>
              <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 'bold', color: 'var(--green)', fontSize: '1rem' }}>
                {card.title}
              </div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.78rem', color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
                {card.blurb}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
