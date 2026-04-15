import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  children: ReactNode;
}

export function Button({ variant = 'secondary', className = '', children, ...rest }: ButtonProps) {
  const base = 'px-3 py-1.5 rounded-md text-sm font-medium transition-colors';
  const styles = {
    primary: 'bg-brand text-bg hover:bg-brand-dim',
    secondary: 'bg-bg-elev text-ink border border-line hover:bg-bg-hover',
    ghost: 'text-ink-muted hover:text-ink hover:bg-bg-hover',
  }[variant];
  return (
    <button className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}
