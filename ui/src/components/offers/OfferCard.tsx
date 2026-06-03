import { Link } from 'react-router-dom';
import { Badge } from '../ui/Badge';
import { timeAgo } from '../../utils/dates';
import type { Offer } from '../../types';

interface OfferCardProps {
  offer: Offer;
  tenantSlug: string;
  nicheSlug: string;
  onInterest?: (offer: Offer) => void;
}

const TYPE_BADGE: Record<string, 'amber' | 'sage' | 'green' | 'gray'> = {
  have: 'amber',
  want: 'sage',
  trade: 'green',
  free: 'gray',
};

function Stars({ avg, count }: { avg: number; count: number }) {
  if (count === 0) return null;
  const full = Math.round(avg);
  return (
    <span className="stars" title={`${avg.toFixed(1)} / 5`}>
      {'★'.repeat(full)}{'☆'.repeat(5 - full)}
    </span>
  );
}

export default function OfferCard({ offer, tenantSlug: _tenantSlug, nicheSlug, onInterest }: OfferCardProps) {
  const detailPath = `/${nicheSlug}/offers/${offer.id}`;

  return (
    <div className={`offer-card ${offer.is_boosted ? 'offer-card--boosted' : ''}`}>
      {/* Boost pill */}
      {!!offer.is_boosted && (
        <div>
          <span className="offer-boost-pill">⚡ Featured</span>
        </div>
      )}

      {/* Header: type badge + category */}
      <div className="offer-card__header">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge variant={TYPE_BADGE[offer.offer_type] || 'gray'}>
            {offer.offer_type.toUpperCase()}
          </Badge>
          {offer.category_name && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.78rem', color: 'var(--muted)' }}>
              {offer.category_icon} {offer.category_name}
            </span>
          )}
        </div>
        {offer.rating_count > 0 && (
          <Stars avg={offer.rating_avg} count={offer.rating_count} />
        )}
      </div>

      {/* Title */}
      <h2 className="offer-card__title">
        <Link to={detailPath}>{offer.title}</Link>
      </h2>

      {/* Description */}
      <p className="offer-card__desc">{offer.description}</p>

      {/* Want description */}
      {offer.want_description && (
        <div className="offer-card__want">
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--amber)', marginRight: 4 }}>
            LOOKING FOR
          </span>
          {offer.want_description}
        </div>
      )}

      {/* Footer */}
      <div className="offer-card__footer">
        <div className="offer-card__meta-row">
          {offer.location && <span>📍 {offer.location}</span>}
          <span>{timeAgo(offer.created_at)}</span>
          <span style={{ color: 'var(--green)', fontWeight: 500 }}>
            {offer.display_name}
          </span>
          {offer.credits_attached > 0 && (
            <span className="credits-pill" style={{ fontSize: '0.72rem' }}>
              💰 +{offer.credits_attached}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {offer.interest_count > 0 && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              {offer.interest_count} interested
            </span>
          )}
          {onInterest ? (
            <button
              onClick={() => onInterest(offer)}
              className="btn btn-amber btn-sm"
              style={{ whiteSpace: 'nowrap' }}
            >
              I'm Interested →
            </button>
          ) : (
            <Link to={detailPath} className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
              View →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
