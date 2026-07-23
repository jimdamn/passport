import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { getFreshStand, categoryLabel, standLocation, REGION_BOUNDS, type FreshStandDetail } from '../api/fresh';
import { Sprout, Phone, MapPin, Share2 } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap } from 'kk-shared-ui';

function postedAt(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function sinceMonthYear(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });
}

export default function FreshStand() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();

  const [stand, setStand] = useState<FreshStandDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tenant || !id) return;
    setLoading(true);
    setNotFound(false);
    getFreshStand(tenant.id, id)
      .then(res => setStand(res.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [tenant, id]);

  if (loading) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (notFound || !stand) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/fresh" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Fresh Today
          </Link>
        </div>
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Sprout size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            This stand isn't out right now.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            It may have been taken down or paused by its owner.
          </p>
        </div>
      </div>
    );
  }

  function handleFacebookShare() {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  function handleTwitterShare() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(stand!.name);
    window.open(`https://x.com/intent/post?url=${url}&text=${text}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/fresh" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Fresh Today
        </Link>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sprout size={22} style={{ color: 'var(--amber)' }} /> {stand.name}
      </h1>

      {standLocation(stand.nearest_city, stand.nearest_state) && (
        <p style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin size={16} style={{ color: 'var(--amber)' }} /> {standLocation(stand.nearest_city, stand.nearest_state)}
        </p>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {stand.categories.map(cat => (
          <span key={cat} style={{
            fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
            borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
          }}>
            {categoryLabel(cat)}
          </span>
        ))}
      </div>

      {stand.photo_url && (
        <img src={stand.photo_url} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8, marginBottom: 16, display: 'block' }} />
      )}

      {stand.description && (
        <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.45 }}>
          {stand.description}
        </p>
      )}

      <div style={{ marginBottom: 16 }}>
        <RegionMap
          pins={[{
            id: stand.id, lat: stand.lat, lon: stand.lon, label: stand.name,
            kind: 'green',
          }]}
          center={{ lat: stand.lat, lon: stand.lon }}
          maxBounds={REGION_BOUNDS}
          zoom={13}
          height="240px"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {stand.address_hint && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text)' }}>
            <MapPin size={14} style={{ color: 'var(--amber)' }} /> {stand.address_hint}
          </span>
        )}
        {stand.phone && (
          <a href={`tel:${stand.phone.replace(/[^0-9+]/g, '')}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text)', textDecoration: 'none' }}>
            <Phone size={14} style={{ color: 'var(--amber)' }} /> {stand.phone}
          </a>
        )}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        On Fresh Today since {sinceMonthYear(stand.created_at)}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          onClick={handleFacebookShare}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px',
            background: '#1877F2', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer', letterSpacing: '0.01em',
          }}
        >
          <Share2 size={15} /> Share on Facebook
        </button>
        <button
          onClick={handleTwitterShare}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px',
            background: '#000', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer', letterSpacing: '0.01em',
          }}
        >
          <Share2 size={15} /> Share on X
        </button>
      </div>

      {stand.posts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)', marginBottom: 16 }}>
          <Sprout size={26} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            Nothing posted here today.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {stand.posts.map(post => (
            <div key={post.id} className="card"
              style={{ background: 'var(--white)', padding: 16, borderLeft: '4px solid var(--green)' }}>
              <p style={{ margin: '0 0 8px', fontSize: '1rem', color: 'var(--text)', lineHeight: 1.45 }}>{post.body}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Posted {postedAt(post.created_at)}</span>
              </div>
              {!!post.sold_out && (
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
