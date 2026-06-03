/**
 * BadgeStrip — renders a row of earned badges from the site-image-assets R2 bucket.
 *
 * Badge images live at /site-assets/badges/<id>.png
 * If an image fails to load (not yet uploaded), the component falls back to
 * a text-only pill so the page never breaks.
 */

import { useState } from 'react';

export interface Badge {
  id:          string;
  label:       string;
  description: string;
}

interface BadgePillProps {
  badge: Badge;
}

function BadgePill({ badge }: BadgePillProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = `/site-assets/badges/${badge.id}.svg`;

  return (
    <div
      title={badge.description}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px',
        background: 'var(--white)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-sans)', fontSize: '0.75rem',
        fontWeight: 700, color: 'var(--green)',
        whiteSpace: 'nowrap',
      }}
    >
      {!imgFailed && (
        <img
          src={src}
          alt={badge.label}
          onError={() => setImgFailed(true)}
          style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }}
        />
      )}
      {badge.label}
    </div>
  );
}

interface BadgeStripProps {
  badges: Badge[];
  style?: React.CSSProperties;
}

export default function BadgeStrip({ badges, style }: BadgeStripProps) {
  if (!badges || badges.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        ...style,
      }}
    >
      {badges.map(badge => (
        <BadgePill key={badge.id} badge={badge} />
      ))}
    </div>
  );
}
