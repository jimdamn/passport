import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { getPetPost, revealPetContact, speciesLabel, REGION_BOUNDS, type PetFeedRow } from '../api/pets';
import { PawPrint, Phone, Mail, MapPin, Share2 } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Alert } from '../components/ui/Alert';
import { RegionMap } from 'kk-shared-ui';

// Home Safe's public detail page - the shareable object. Donor: SaleDetail.tsx.
// Diff: a contact block that is the primary action on the page, since contact
// is masked by default here (§5.3 of the build plan).

function lastSeenLine(p: PetFeedRow): string {
  const place = p.location_hint || p.nearest_city;
  const verb = p.type === 'lost' ? 'Last seen' : 'Found';
  const base = place ? `${verb} near ${place}` : verb;
  return p.seen_date ? `${base} · ${p.seen_date}` : base;
}

function postedAt(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function ContactBlock({ tenantId, post, onRevealed }: {
  tenantId: string;
  post: PetFeedRow;
  onRevealed: (phone: string | null, email: string | null) => void;
}) {
  const { user } = useAuth();
  const [showInterstitial, setShowInterstitial] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  if (post.contact_public) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {post.phone && (
          <a href={`tel:${post.phone.replace(/[^0-9+]/g, '')}`} className="btn btn-amber"
            style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}>
            <Phone size={16} /> Call {post.phone}
          </a>
        )}
        {post.email && (
          <a href={`mailto:${post.email}`}
            style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.88rem', color: 'var(--text)' }}>
            <Mail size={14} style={{ color: 'var(--amber)' }} /> {post.email}
          </a>
        )}
      </div>
    );
  }

  if (!user) {
    const returnTo = encodeURIComponent(window.location.pathname);
    return (
      <div style={{ marginBottom: 20 }}>
        <a href={`/auth/login?return_to=${returnTo}`} className="btn btn-amber"
          style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', textDecoration: 'none' }}>
          Get in touch
        </a>
        <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'center' }}>
          Sign in to see their contact info - takes a minute, and the poster sees a name, not a stranger.
        </p>
      </div>
    );
  }

  async function handleReveal() {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const res = await revealPetContact(tenantId, post.id);
      onRevealed(res.data.phone, res.data.email);
      setShowInterstitial(false);
    } catch (err: any) {
      setError(err.message || "Couldn't get their contact info - try again in a moment.");
    } finally {
      setWorking(false);
    }
  }

  if (showInterstitial) {
    return (
      <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 20 }}>
        <p style={{ margin: '0 0 12px', fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.5 }}>
          The poster will see your name with this request - that's what keeps everyone honest.
        </p>
        {error && <Alert type="error" style={{ marginBottom: 12 }}>{error}</Alert>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 40 }}
            onClick={() => setShowInterstitial(false)}>
            Never mind
          </button>
          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 40, flex: 1 }}
            onClick={handleReveal}>
            {working ? 'Getting contact info...' : 'Show me their contact'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {error && <Alert type="error" style={{ marginBottom: 12 }}>{error}</Alert>}
      <button className="btn btn-amber" style={{ minHeight: 44, width: '100%' }}
        onClick={() => setShowInterstitial(true)}>
        Get in touch
      </button>
    </div>
  );
}

export default function PetPost() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();

  const [post, setPost] = useState<PetFeedRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [revealed, setRevealed] = useState<{ phone: string | null; email: string | null } | null>(null);

  useEffect(() => {
    if (!tenant || !id) return;
    setLoading(true);
    setNotFound(false);
    setRevealed(null);
    getPetPost(tenant.id, id)
      .then(res => setPost(res.data))
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

  if (notFound || !post) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <PawPrint size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 12px', color: 'var(--text)', fontSize: '0.9rem' }}>
            That post isn't on the board - often that's good news, it means they're home.
          </p>
          <Link to="/pets" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Back to Home Safe</Link>
        </div>
      </div>
    );
  }

  const title = post.pet_name || speciesLabel(post.species);

  function handleFacebookShare() {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  function handleTwitterShare() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(title);
    window.open(`https://x.com/intent/post?url=${url}&text=${text}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/pets" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Home Safe
        </Link>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <PawPrint size={22} style={{ color: 'var(--amber)' }} /> {title}
      </h1>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 'var(--r-sm)',
          background: post.type === 'lost' ? 'rgba(200,134,10,0.14)' : 'rgba(80,120,80,0.12)',
          color: post.type === 'lost' ? 'var(--amber)' : 'var(--green)',
        }}>
          {post.type === 'lost' ? 'Lost' : 'Found'}
        </span>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
        }}>
          {speciesLabel(post.species)}
        </span>
      </div>

      {post.status === 'home_safe' && (
        <div className="card" style={{ background: 'rgba(80,120,80,0.10)', border: '1px solid var(--green)', padding: 14, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--green)' }}>
            Home safe. Thanks to everyone who kept an eye out.
          </p>
        </div>
      )}

      {post.photo_url && (
        <img src={post.photo_url} alt="" style={{ width: '100%', maxWidth: '100%', borderRadius: 12, marginBottom: 16, display: 'block' }} />
      )}

      <p style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.45 }}>
        {post.body}
      </p>

      <p style={{ margin: '0 0 16px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <MapPin size={14} style={{ color: 'var(--amber)' }} /> {lastSeenLine(post)}
      </p>

      <div style={{ marginBottom: 16 }}>
        <RegionMap
          pins={[{
            id: post.id, lat: post.lat, lon: post.lon, label: title,
            kind: post.status === 'home_safe' ? 'green' : (post.type === 'lost' ? 'amber' : 'green'),
          }]}
          center={{ lat: post.lat, lon: post.lon }}
          maxBounds={REGION_BOUNDS}
          zoom={13}
          height="240px"
        />
      </div>

      {revealed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {revealed.phone && (
            <a href={`tel:${revealed.phone.replace(/[^0-9+]/g, '')}`} className="btn btn-amber"
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}>
              <Phone size={16} /> Call {revealed.phone}
            </a>
          )}
          {revealed.email && (
            <a href={`mailto:${revealed.email}`}
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.88rem', color: 'var(--text)' }}>
              <Mail size={14} style={{ color: 'var(--amber)' }} /> {revealed.email}
            </a>
          )}
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'center' }}>
            They'll see your name asked. Give them a call or a text - short and kind.
          </p>
        </div>
      ) : (
        <ContactBlock tenantId={tenant!.id} post={post} onRevealed={(phone, email) => setRevealed({ phone, email })} />
      )}

      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        Posted {postedAt(post.created_at)}
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
    </div>
  );
}
