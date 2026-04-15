import type { ReactNode } from 'react';

export interface Tab {
  id: string;
  label: ReactNode;
}

export function Tabs({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex p-1 rounded-lg bg-bg-elev border border-line ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            active === t.id ? 'bg-bg-card text-ink shadow' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
