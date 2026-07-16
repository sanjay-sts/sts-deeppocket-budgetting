import type { ReactNode } from 'react';

export function Card({
  children,
  title,
  subtitle,
  action,
  className = '',
}: {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-bg-card border border-line rounded-xl p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-4">
          <div>
            {title && <h3 className="text-ink font-semibold">{title}</h3>}
            {subtitle && <p className="text-ink-muted text-sm mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
