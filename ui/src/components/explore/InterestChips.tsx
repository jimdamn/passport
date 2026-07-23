import { PICKABLE_SLUGS, PICKER_LABELS } from '../../api/around';

// The single-select chip list shared by the first-visit picker card
// (Explore.tsx) and the profile "Where Around Town opens" edit drawer - same
// picker labels (warmer than the lens-row chip labels). Tapping a chip
// selects exactly that one; tapping the selected chip deselects it. A pure
// controlled component: the parent owns the array (`[slug]` or `[]`) via
// api/around.ts's toggleInterest().

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
