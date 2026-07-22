import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import {
  listFresh, listFreshStands, listFreshSeasons, categoryLabel, FRESH_CATEGORIES, REGION_CENTER,
  type FreshFeedPost, type FreshStandPin,
} from '../api/fresh';
import { Sprout, List, Map as MapIcon, Phone } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui';

// Fresh Today's public browse board. Follows the Happenings design language
// exactly: serif header with an inline icon, calm chip rows for filters,
// white cards with a 4px green left accent, centered spinner, calm empty
// state, 800px column. See kk-shared-ui/DESIGN-LANGUAGE.md.

function postedAt(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

export default function FreshToday() {
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<FreshFeedPost[]>([]);
  const [stands, setStands] = useState<FreshStandPin[]>([]);
  const [seasonLine, setSeasonLine] = useState<string>('');
  const [filter, setFilter] = useState<string>('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Seasons and stand pins don't depend on the category filter - load once
  // per tenant, independent of the feed refetch below.
  useEffect(() => {
    if (!tenant) return;
    listFreshSeasons(tenant.id)
      .then(res => {
        const inSeason = (res.data || []).filter(s => s.in_season_now).map(s => s.item_name);
        setSeasonLine(inSeason.length ? `In season now: ${inSeason.join(', ')}` : '');
      })
      .catch(() => setSeasonLine(''));
    listFreshStands(tenant.id)
      .then(res => setStands(res.data || []))
      .catch(() => setStands([]));
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await listFresh(tenant.id, filter === 'all' ? undefined : filter);
        setPosts(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Fresh Today.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, filter]);

  const pins: RegionPin[] = useMemo(() => stands.map(s => ({
    id: s.id,
    lat: s.lat,
    lon: s.lon,
    label: s.name,
    sublabel: s.latest_body ? truncate(s.latest_body, 60) : 'Nothing posted today',
    href: `/fresh/stand/${s.id}`,
    kind: s.has_live_post ? 'amber' : 'green',
  })), [stands]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sprout size={22} style={{ color: 'var(--amber)' }} /> Fresh Today
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        What's out right now - farm stands, u-pick, eggs, and more.
      </p>

      {seasonLine && (
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>{seasonLine}</p>
      )}

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Category filter - calm chips, no counts or badges */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...FRESH_CATEGORIES].map(c => (
          <button key={c.key} onClick={() => setFilter(c.key)}
            className={`btn btn-sm ${filter === c.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setView('list')}
          className={`btn btn-sm ${view === 'list' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <List size={14} /> List
        </button>
        <button onClick={() => setView('map')}
          className={`btn btn-sm ${view === 'map' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <MapIcon size={14} /> Map
        </button>
      </div>

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : view === 'map' ? (
        <RegionMap pins={pins} center={REGION_CENTER} height="60vh" />
      ) : posts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Sprout size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nothing posted yet today.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Stands post in the morning as things come out of the field. Have something to sell?
            Set up your stand in a minute.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/fresh/mine')}>
            Set up your stand
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {posts.map(p => (
            <div key={p.id} className="card" role="button" tabIndex={0}
              onClick={() => navigate(`/fresh/stand/${p.stand.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/fresh/stand/${p.stand.id}`); }}
              style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{p.stand.name}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {p.stand.categories.map(cat => (
                    <span key={cat} style={{
                      fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                      borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                      whiteSpace: 'nowrap',
                    }}>
                      {categoryLabel(cat)}
                    </span>
                  ))}
                </div>
              </div>

              <p style={{ margin: '0 0 8px', fontSize: '1rem', color: 'var(--text)', lineHeight: 1.45 }}>{p.body}</p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                  Posted {postedAt(p.created_at)}
                  {p.stand.address_hint ? ` · ${p.stand.address_hint}` : ''}
                </span>
                {p.stand.phone && (
                  <a href={`tel:${p.stand.phone.replace(/[^0-9+]/g, '')}`}
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
                    <Phone size={12} style={{ color: 'var(--amber)' }} /> {p.stand.phone}
                  </a>
                )}
              </div>

              {p.sold_out && (
                <div style={{ marginTop: 8 }}>
                  <Badge variant="amber">Sold out for today</Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
