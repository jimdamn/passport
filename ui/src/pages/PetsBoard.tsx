import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import {
  listPetPosts, listPetPins, speciesLabel, PET_TYPES, PET_SPECIES, REGION_CENTER, REGION_BOUNDS,
  type PetFeedRow, type PetPin,
} from '../api/pets';
import { PawPrint, List, Map as MapIcon, Phone, Mail } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap } from 'kk-shared-ui';

// Home Safe's public browse board. Follows Sale Day's design language
// exactly (SaleDay.tsx is the visual donor) - serif header, calm chip rows,
// white cards with a green left accent, centered spinner, calm empty state,
// 800px column. Diff vs Sale Day: two chip rows (type, then species) instead
// of one, and contact is masked by default - list cards show a "Get in
// touch" link instead of a bare phone number unless the poster opted into
// inline display.

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

function lastSeenLine(p: PetFeedRow): string {
  const place = p.location_hint || p.nearest_city;
  const verb = p.type === 'lost' ? 'Last seen' : 'Found';
  const base = place ? `${verb} near ${place}` : verb;
  return p.seen_date ? `${base} · ${p.seen_date}` : base;
}

export default function PetsBoard() {
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<PetFeedRow[]>([]);
  const [pins, setPins] = useState<PetPin[]>([]);
  const [type, setType] = useState<string>('all');
  const [species, setSpecies] = useState<string>('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tenant) return;
    listPetPins(tenant.id).then(res => setPins(res.data || [])).catch(() => setPins([]));
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await listPetPosts(tenant.id, type === 'all' ? undefined : type, species === 'all' ? undefined : species);
        setPosts(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Home Safe.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, type, species]);

  const mapPins = useMemo(() => pins.map(p => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    label: p.pet_name || speciesLabel(p.species),
    sublabel: p.status === 'home_safe' ? 'Home safe' : (p.type === 'lost' ? `Lost near ${p.location_hint || p.nearest_city || 'the area'}` : `Found near ${p.location_hint || p.nearest_city || 'the area'}`),
    href: `/pets/post/${p.id}`,
    kind: p.kind,
  })), [pins]);

  const unresolved = posts.filter(p => p.status !== 'home_safe');
  const resolved = posts.filter(p => p.status === 'home_safe');

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <PawPrint size={22} style={{ color: 'var(--amber)' }} /> Home Safe
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Lost and found pets across the Lakes Region - post it, share it, bring them home.
      </p>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Type chip row */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...PET_TYPES].map(t => (
          <button key={t.key} onClick={() => setType(t.key)}
            className={`btn btn-sm ${type === t.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Species chip row */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...PET_SPECIES].map(s => (
          <button key={s.key} onClick={() => setSpecies(s.key)}
            className={`btn btn-sm ${species === s.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {s.label}
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
        <>
          <RegionMap pins={mapPins} center={REGION_CENTER} maxBounds={REGION_BOUNDS} height="60vh" />
          <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
            Amber is missing - keep your eyes open. Green means found or home safe.
          </p>
        </>
      ) : posts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <PawPrint size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            No lost or found pets posted right now.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            That's a good day. If one goes missing, post it here in a minute - and share it anywhere you like, the link does the work.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/pets/mine')}>
            Report a pet
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {unresolved.map(p => <PetCard key={p.id} post={p} onOpen={() => navigate(`/pets/post/${p.id}`)} />)}
          {resolved.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Recently home safe</span>
                <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
              </div>
              {resolved.map(p => <PetCard key={p.id} post={p} onOpen={() => navigate(`/pets/post/${p.id}`)} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PetCard({ post, onOpen }: { post: PetFeedRow; onOpen: () => void }) {
  const title = post.pet_name || speciesLabel(post.species);
  return (
    <div role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      className="card"
      style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)', display: 'flex', gap: 12 }}>
      {post.photo_url && (
        <img src={post.photo_url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{title}</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
              borderRadius: 'var(--r-sm)',
              background: post.type === 'lost' ? 'rgba(200,134,10,0.14)' : 'rgba(80,120,80,0.12)',
              color: post.type === 'lost' ? 'var(--amber)' : 'var(--green)',
              whiteSpace: 'nowrap',
            }}>
              {post.type === 'lost' ? 'Lost' : 'Found'}
            </span>
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
              borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
              whiteSpace: 'nowrap',
            }}>
              {speciesLabel(post.species)}
            </span>
          </div>
        </div>

        <p style={{
          margin: '0 0 6px', fontSize: '0.85rem', color: 'var(--muted)',
        }}>
          {lastSeenLine(post)}
        </p>

        <p style={{
          margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {truncate(post.body, 140)}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {post.status === 'home_safe' ? (
            <Badge variant="green">Home safe</Badge>
          ) : post.contact_public && post.phone ? (
            <a href={`tel:${post.phone.replace(/[^0-9+]/g, '')}`}
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
              <Phone size={12} style={{ color: 'var(--amber)' }} /> {post.phone}
            </a>
          ) : post.contact_public && post.email ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)' }}>
              <Mail size={12} style={{ color: 'var(--amber)' }} /> {post.email}
            </span>
          ) : (
            <span style={{ fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 600 }}>Get in touch</span>
          )}
        </div>
      </div>
    </div>
  );
}
