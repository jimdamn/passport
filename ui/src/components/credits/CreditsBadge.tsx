import { Coins } from 'lucide-react';

interface CreditsBadgeProps {
  amount: number;
  prefix?: string;
  label?: string;
}

export function CreditsBadge({ amount, prefix = '', label = 'KrowdKredits' }: CreditsBadgeProps) {
  return (
    <span className="credits-pill">
      <Coins size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} /> {prefix}{amount} {label}
    </span>
  );
}
