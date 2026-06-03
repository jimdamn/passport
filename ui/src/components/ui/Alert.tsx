import type { HTMLAttributes } from 'react';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  type: 'success' | 'error' | 'info';
  children: React.ReactNode;
}

export function Alert({ type, children, className = '', ...rest }: AlertProps) {
  return (
    <div className={`alert alert-${type} ${className}`} role="alert" {...rest}>
      {children}
    </div>
  );
}
