import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '../../context/TenantContext';
import { getKwestHunts, type KwestHuntSummary } from '../../api/kwest';
import { Compass, HelpCircle, ChevronRight, ScrollText } from 'lucide-react';
import { Spinner } from '../../components/ui/Spinner';

export default function KwestHome() {
  const { tenant } = useTenant();
  const [hunts, setHunts] = useState<KwestHuntSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tenant.id) return;
    getKwestHunts(tenant.id)
      .then(res => setHunts(res.data || []))
      .catch(err => setError(err.message || 'Could not load KrowdKwest right now.'))
      .finally(() => setLoading(false));
  }, [tenant.id]);

  const live = hunts.filter(h => h.status === 'live');
  const past = hunts.filter(h => h.status !== 'live' && h.retro_published === 1);

  return (
    <div className="main-content" style={{ maxWidth: 680, paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Home
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Compass size={22} style={{ color: 'var(--amber)' }} /> KrowdKwest
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Real-world clue hunts across the region. Solve the clues, travel to the spot, and confirm you made it.
      </p>

      <Link
        to="/kwest/help"
        className="btn btn-secondary btn-sm"
        style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 24 }}
      >
        <HelpCircle size={14} /> How it works
      </Link>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>
      ) : error ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', background: 'var(--white)' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      ) : (
        <>
          <p className="section-title">Live now</p>
          {live.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: 'center', background: 'var(--white)', marginBottom: 24 }}>
              <Compass size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
                No hunt is live right now - check back soon.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {live.map(hunt => (
                <Link
                  key={hunt.slug}
                  to={`/kwest/${hunt.slug}`}
                  className="card"
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    background: 'var(--white)', padding: 16, textDecoration: 'none',
                    borderLeft: '4px solid var(--green)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: 'var(--green)', fontWeight: 600, fontFamily: 'var(--font-serif)' }}>
                      {hunt.name}
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {hunt.location_label ?? 'Region-wide'} - {hunt.grand_prize_description}
                    </p>
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                </Link>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <p className="section-title">Past hunts</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {past.map(hunt => (
                  <Link
                    key={hunt.slug}
                    to={`/kwest/${hunt.slug}/retro`}
                    className="card"
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                      background: 'var(--white)', padding: '12px 16px', textDecoration: 'none',
                    }}
                  >
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{hunt.name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 600 }}>
                      <ScrollText size={12} /> Winners
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
