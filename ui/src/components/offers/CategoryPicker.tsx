import type { Category } from '../../types';

interface CategoryPickerProps {
  categories: Category[];
  selected: string | null;
  onChange: (slug: string | null) => void;
  compact?: boolean;
}

export default function CategoryPicker({ categories, selected, onChange, compact = false }: CategoryPickerProps) {
  if (compact) {
    // Horizontal scroll pill buttons for filter bar
    return (
      <div className="niche-nav">
        <button
          className={`niche-nav-btn ${selected === null ? 'active' : ''}`}
          onClick={() => onChange(null)}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`niche-nav-btn ${selected === cat.slug ? 'active' : ''}`}
            onClick={() => onChange(cat.slug)}
          >
            {cat.icon} {cat.name}
          </button>
        ))}
      </div>
    );
  }

  // Grid picker for the create form
  return (
    <div className="category-grid">
      <button
        type="button"
        className={`category-btn ${selected === null ? 'active' : ''}`}
        onClick={() => onChange(null)}
      >
        <span style={{ fontSize: '1.2rem' }}>✦</span>
        <span>All</span>
      </button>
      {categories.map(cat => (
        <button
          key={cat.id}
          type="button"
          className={`category-btn ${selected === cat.slug ? 'active' : ''}`}
          onClick={() => onChange(cat.slug)}
        >
          <span style={{ fontSize: '1.2rem' }}>{cat.icon}</span>
          <span>{cat.name}</span>
        </button>
      ))}
    </div>
  );
}
