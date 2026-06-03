interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  const cls = `spinner spinner--${size}`;
  return <span className={cls} role="status" aria-label="Loading" />;
}
