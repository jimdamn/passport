import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '../../context/TenantContext';
import { getMember } from '../../api/profile';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import BadgeStrip from '../../components/ui/BadgeStrip';

// Exchange is a separate Pages app on the shared domain; offer detail lives at /offers/:id.
const EXCHANGE_BASE_URL = 'https://exchange.lakeandlocals.com';

const OFFER_TYPE_LABELS: Record<string, string> = {
  have:  'Offering',
  want:  'Looking for',
  trade: 'Trade',
  free:  'Free',
};

interface ActiveOffer {
  id: string;
  title: string;
  offer_type: string;
  location: string | null;
  created_at: number;
  category_name: string | null;
  category_icon: string | null;
}

function Avatar({ name, size = 64 }: { name: string; size?: number }) {
  const parts = name.trim().split(' ');
  const letters = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : name.slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--green)', color: 'var(--cream)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 'bold', flexShrink: 0,
    }}>
      {letters.toUpperCase()}
    </div>
  );
}

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['member', tenant?.id, id],
    queryFn: () => getMember(tenant!.id, id!),
    enabled: !!tenant && !!id,
  });

  if (isLoading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="main-content" style={{ paddingTop: 32 }}>
        <Alert type="error">Member not found.</Alert>
      </div>
    );
  }

  const { member, badges = [], active_offers = [], business_links = null } = data.data as {
    member: any; badges?: any[]; active_offers?: ActiveOffer[];
    business_links?: { business_name: string; booking_url: string | null; endorse_url: string | null } | null;
  };

  return (
    <div className="main-content" style={{ paddingTop: 24, paddingBottom: 80 }}>

      {/* Identity */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 12 }}>
          <Avatar name={member.display_name} />
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>{member.display_name}</h2>
            {member.location && (
              <p style={{ margin: '0 0 6px', fontSize: '0.85rem', color: 'var(--sage)' }}>
                {member.location}
              </p>
            )}
          </div>
        </div>

        {badges.length > 0 && (
          <BadgeStrip badges={badges} style={{ marginTop: 12 }} />
        )}

        {member.bio && (
          <p style={{
            margin: '12px 0 0', fontSize: '0.9rem',
            borderLeft: '3px solid var(--border)', paddingLeft: 12,
          }}>
            {member.bio}
          </p>
        )}
      </div>

      {business_links && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>
            {business_links.business_name}
          </h3>
          <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--sage)' }}>
            A verified member business on the Lake &amp; Locals network
          </p>
          {/* Mobile-first: full-width stacked buttons on phones, side by side
              once there's room. */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {business_links.booking_url && (
              <a href={business_links.booking_url} className="btn btn-amber"
                 style={{ flex: '1 1 200px', textAlign: 'center' }}>
                Book an appointment
              </a>
            )}
            {business_links.endorse_url && (
              <a href={business_links.endorse_url} className="btn btn-secondary"
                 style={{ flex: '1 1 200px', textAlign: 'center' }}>
                Share your experience
              </a>
            )}
          </div>
        </div>
      )}

      {active_offers.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>
            On the Exchange
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active_offers.map(offer => (
              <a
                key={offer.id}
                href={`${EXCHANGE_BASE_URL}/offers/${offer.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border)', textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: '0.9rem', fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {offer.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sage)' }}>
                    {OFFER_TYPE_LABELS[offer.offer_type] || offer.offer_type}
                    {offer.location ? ` · ${offer.location}` : ''}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
