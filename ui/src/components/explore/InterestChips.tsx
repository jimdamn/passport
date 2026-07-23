import { PICKABLE_SLUGS, PICKER_LABELS } from '../../api/around';

// The multi-select chip list shared by the first-visit picker card
// (Explore.tsx) and the profile "What you keep an eye on" edit drawer -
// same picker labels (warmer than the lens-row chip labels), same toggle
// behavior. A pure controlled component: the parent owns the pick-order-
// preserving array via api/around.ts's toggleInterest().

interface Props {
  value: string[];
  onToggle: (slug: string) => void;
}

export default function InterestChips({ value, onToggle }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {PICKABLE_SLUGS.map(slug => (
        <button
          key={slug}
          type="button"
          onClick={() => onToggle(slug)}
          className={`btn btn-sm ${value.includes(slug) ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 44 }}
        >
          {PICKER_LABELS[slug]}
        </button>
      ))}
    </div>
  );
}
