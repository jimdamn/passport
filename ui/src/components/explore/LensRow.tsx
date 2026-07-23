import { LENSES } from '../../api/around';

// The lens row: one calm chip row that re-aims the whole Around Town board
// (and, in the map room, the pins). Same chip language as every other filter
// row in the app (btn-amber active / btn-secondary idle) - shared verbatim
// between Explore.tsx (inline) and explore/MapRoom.tsx (floating overlay), so
// a tap in either place means the same thing and persists the same way.

const LENS_LABELS: Record<string, string> = Object.fromEntries(LENSES.map(l => [l.slug, l.label]));

interface Props {
  order: string[];
  activeLens: string;
  onSelect: (slug: string) => void;
}

export default function LensRow({ order, activeLens, onSelect }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {order.map(slug => (
        <button
          key={slug}
          onClick={() => onSelect(slug)}
          className={`btn btn-sm ${activeLens === slug ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 44, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {LENS_LABELS[slug] ?? slug}
        </button>
      ))}
    </div>
  );
}
