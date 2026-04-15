import type { ReactNode } from 'react';

type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-bg-elev text-ink-muted border border-line',
  positive: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
  negative: 'bg-rose-500/10 text-rose-400 border border-rose-500/30',
  warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
  info: 'bg-sky-500/10 text-sky-400 border border-sky-500/30',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
