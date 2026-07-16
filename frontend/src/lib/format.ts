// CAD, dates, and percentage formatters. Locked to en-CA.

const cadFull = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 2,
});

const cadWhole = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

const cadCompact = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function cad(amount: number, whole = false): string {
  return (whole ? cadWhole : cadFull).format(amount);
}

export function cadK(amount: number): string {
  return cadCompact.format(amount);
}

export function signed(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${cad(Math.abs(amount), true)}`;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function deltaPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso + 'T00:00:00'));
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

export function monthLabel(ym: string): string {
  // "2026-04" -> "Apr 2026"
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString('en-CA', { month: 'short', year: 'numeric' });
}

export function monthLabelShort(ym: string): string {
  // "2026-04" -> "Apr"
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-CA', { month: 'short' });
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
