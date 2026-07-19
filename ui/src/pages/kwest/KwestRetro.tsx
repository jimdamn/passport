import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTenant } from '../../context/TenantContext';
import { getKwestRetro, type KwestRetroResult, type KwestRetroWinner } from '../../api/kwest';
import { Trophy, Award, Medal, Heart } from 'lucide-react';
import { Spinner } from '../../components/ui/Spinner';

export default function KwestRetro() {
  const { slug } = useParams<{ slug: string }>();
  const { tenant } = useTenant();
  const [retro, setRetro] = useState<KwestRetroResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug || !tenant.id) return;
    getKwestRetro(tenant.id, slug)
      .then(res => setRetro(res.data))
      .catch(err => setError(err.message || 'Could not load this hunt\'s winners.'))
      .finally(() => setLoading(false));
  }, [slug, tenant.id]);

  if (loading) {
    return <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}><Spinner size="lg" /></div>;
  }

  if (error || !retro) {
    return (
      <div className="main-content" style={{ paddingTop: 24 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/kwest" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to KrowdKwest
          </Link>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{error || 'This hunt could not be found.'}</p>
      </div>
    );
  }

  if (!retro.published) {
    return (
      <div className="main-content" style={{ paddingTop: 24, textAlign: 'center' }}>
        <div style={{ marginBottom: 8, textAlign: 'left' }}>
          <Link to="/kwest" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to KrowdKwest
          </Link>
        </div>
        <Trophy size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>This hunt hasn't wrapped up yet - the winners page appears once it officially closes.</p>
      </div>
    );
  }

  const winners = retro.winners ?? [];
  const grand = winners.find(w => w.prize_kind === 'grand');
  const midTier = winners.filter(w => w.prize_kind === 'kk_rank');
  const consolation = winners.filter(w => w.prize_kind === 'kk_consolation');

  return (
    <div className="main-content" style={{ maxWidth: 640, paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/kwest" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to KrowdKwest
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {retro.hunt_name}
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.55 }}>
        {retro.narrative}
      </p>

      {grand && (
        <div className="card" style={{ background: 'var(--green)', padding: 28, textAlign: 'center', marginBottom: 20 }}>
          <Trophy size={36} style={{ color: 'var(--amber)', marginBottom: 10 }} />
          <p style={{ margin: '0 0 4px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(244,241,234,0.7)', fontWeight: 700 }}>
            Grand Prize Winner
          </p>
          <p style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'var(--font-serif)', fontWeight: 'bold', color: 'var(--cream)' }}>
            {grand.display_name}
          </p>
        </div>
      )}

      {midTier.length > 0 && (
        <>
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Award size={16} style={{ color: 'var(--amber)' }} /> Ranks 2-10
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
            {midTier.map((w: KwestRetroWinner) => (
              <div key={w.rank} className="card" style={{ background: 'var(--white)', padding: '14px 12px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 4px', fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 700 }}>#{w.rank}</p>
                <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: 'var(--green)' }}>{w.display_name}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {consolation.length > 0 && (
        <>
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Medal size={16} style={{ color: 'var(--amber)' }} /> Ranks 11-20
          </p>
          <div className="card" style={{ background: 'var(--white)', overflow: 'hidden', marginBottom: 24 }}>
            {consolation.map((w: KwestRetroWinner, i) => (
              <div
                key={w.rank}
                style={{
                  display: 'flex', justifyContent: 'space-between', padding: '10px 16px',
                  borderBottom: i < consolation.length - 1 ? '1px solid var(--border)' : 'none',
                  fontSize: '0.85rem',
                }}
              >
                <span style={{ color: 'var(--muted)' }}>#{w.rank}</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{w.display_name}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card" style={{ background: 'var(--white)', padding: 24, textAlign: 'center' }}>
        <Heart size={22} style={{ color: 'var(--amber)', marginBottom: 8 }} />
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.55 }}>
          Thank you to everyone who joined this hunt{retro.total_finishers ? ` - ${retro.total_finishers} of you made it all the way to the end` : ''}.
          See you on the next one.
        </p>
      </div>
    </div>
  );
}
