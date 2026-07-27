import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ChevronDown } from 'lucide-react';

const STORE_KEY = 'kk_admin_portal_open';

function loadOpen(): boolean {
  try { return localStorage.getItem(STORE_KEY) === '1'; } catch { return false; }
}

function saveOpen(open: boolean) {
  try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch { /* private browsing etc. - state just won't persist */ }
}

interface AdminItem {
  label: string;
  to: string;
  badge?: number;
}

export default function AdminPortalCard({ newSupportCount }: { newSupportCount: number }) {
  const [open, setOpen] = useState(loadOpen);

  function toggle() {
    setOpen(prev => {
      const next = !prev;
      saveOpen(next);
      return next;
    });
  }

  const items: AdminItem[] = [
    { label: 'Review Merchant Applications', to: '/profile/admin/merchants' },
    { label: 'Users', to: '/profile/admin/users' },
    { label: 'Content', to: '/profile/admin/content' },
    { label: 'Plaques & Events', to: '/profile/admin/plaques' },
    { label: 'Prize Pools', to: '/profile/admin/prizes' },
    { label: 'Deal Review', to: '/profile/admin/deals' },
    { label: 'Support Inbox', to: '/profile/admin/support', badge: newSupportCount },
    { label: 'Volunteer Shift Review', to: '/profile/admin/volunteer' },
    { label: 'Community Meals', to: '/profile/admin/meals' },
    { label: 'Fresh Today', to: '/profile/admin/fresh' },
    { label: 'Happenings', to: '/profile/admin/happenings' },
    { label: 'Home Safe', to: '/profile/admin/pets' },
    { label: 'Pop-Ups', to: '/profile/admin/popups' },
    { label: 'Sale Day', to: '/profile/admin/sales' },
    { label: 'Social Splash', to: '/profile/admin/splash' },
    { label: 'Sponsor Messages', to: '/profile/admin/sponsors' },
    { label: 'Redeem a Claim', to: '/redeem' },
    { label: 'Test Plaque', to: '/profile/admin/test-plaque' },
    { label: 'KrowdKwest', to: '/profile/admin/kwest' },
  ];

  return (
    <div className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden', borderColor: 'rgba(30,51,32,0.18)' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44,
          padding: '12px 14px', background: open ? 'rgba(30,51,32,0.045)' : 'rgba(30,51,32,0.02)',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Shield size={18} strokeWidth={2} color="var(--green)" aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-serif)', fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--green)' }}>
            Network Administrator Portal
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: '0.62rem', fontWeight: 700, color: 'var(--muted)',
              background: 'rgba(0,0,0,0.05)', borderRadius: 'var(--r-pill)', padding: '1px 7px',
            }}>
              {items.length}
            </span>
          </span>
          <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: '0.72rem', color: 'var(--muted)', marginTop: 1 }}>
            Site tools - tap to {open ? 'collapse' : 'expand'}
          </span>
        </span>
        <ChevronDown
          size={16} color="var(--muted)" aria-hidden="true"
          style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0 0 10px', fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>
            You have administrator privileges. Manage local network configurations and review pending merchant applications.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
            {items.map(item => (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', minHeight: 56, padding: '6px 8px', borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--green)',
                  fontFamily: 'var(--font-sans)', fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.3,
                  textDecoration: 'none',
                }}
              >
                <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {item.label}
                </span>
                {!!item.badge && (
                  <span style={{
                    position: 'absolute', top: 5, right: 5,
                    background: 'var(--amber)', color: 'var(--white)',
                    fontFamily: 'var(--font-sans)', fontSize: '0.6rem', fontWeight: 700,
                    minWidth: 15, height: 15, borderRadius: 'var(--r-pill)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                  }}>
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
