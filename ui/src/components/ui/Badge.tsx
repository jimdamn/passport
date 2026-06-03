interface BadgeProps {
  children: React.ReactNode;
  variant?: 'amber' | 'sage' | 'green' | 'gray' | 'red';
}

export function Badge({ children, variant = 'gray' }: BadgeProps) {
  return (
    <span className={`badge badge-${variant}`}>{children}</span>
  );
}
