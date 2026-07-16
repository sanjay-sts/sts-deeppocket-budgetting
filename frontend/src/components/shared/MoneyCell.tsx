import { cad, signed } from '../../lib/format';

export function MoneyCell({
  amount,
  signedDisplay = false,
  whole = true,
  className = '',
}: {
  amount: number;
  signedDisplay?: boolean;
  whole?: boolean;
  className?: string;
}) {
  const positive = amount > 0;
  const negative = amount < 0;
  const color = positive ? 'text-up' : negative ? 'text-down' : 'text-ink';
  return (
    <span className={`num ${signedDisplay ? color : 'text-ink'} ${className}`}>
      {signedDisplay ? signed(amount) : cad(amount, whole)}
    </span>
  );
}
