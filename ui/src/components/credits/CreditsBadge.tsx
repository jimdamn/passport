interface CreditsBadgeProps {
  amount: number;
  prefix?: string;
  label?: string;
}

export function CreditsBadge({ amount, prefix = '', label = 'KrowdKredits' }: CreditsBadgeProps) {
  return (
    <span className="credits-pill">
      💰 {prefix}{amount} {label}
    </span>
  );
}
