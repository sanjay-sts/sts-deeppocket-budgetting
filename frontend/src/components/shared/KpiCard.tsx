import type { ReactNode } from 'react';
import { deltaPct } from '../../lib/format';
import { Card } from '../ui/Card';
import { Sparkline } from './Sparkline';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  deltaPctValue?: number; // -0.05 = -5%
  spark?: number[];
  hint?: ReactNode;
  positiveIsGood?: boolean; // default true; set false for expenses
}

export function KpiCard({
  label,
  value,
  deltaPctValue,
  spark,
  hint,
  positiveIsGood = true,
}: KpiCardProps) {
  const hasDelta = typeof deltaPctValue === 'number' && Number.isFinite(deltaPctValue);
  const deltaGood = hasDelta
    ? positiveIsGood
      ? deltaPctValue! >= 0
      : deltaPctValue! <= 0
    : false;
  const deltaClass = hasDelta ? (deltaGood ? 'text-up' : 'text-down') : 'text-ink-muted';

  return (
    <Card className="relative">
      <div className="text-ink-muted text-xs uppercase tracking-wider">{label}</div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="num text-2xl font-semibold text-ink">{value}</div>
        {hasDelta && <div className={`num text-sm ${deltaClass}`}>{deltaPct(deltaPctValue!)}</div>}
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-3 h-10">
          <Sparkline data={spark} color={deltaGood ? '#34d399' : '#f87171'} />
        </div>
      )}
      {hint && <div className="mt-2 text-xs text-ink-dim">{hint}</div>}
    </Card>
  );
}
