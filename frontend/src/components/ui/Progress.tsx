export function Progress({ value, over = false }: { value: number; over?: boolean }) {
  const clamped = Math.max(0, Math.min(1, value));
  const barColor = over ? 'bg-rose-500' : value > 0.85 ? 'bg-amber-400' : 'bg-brand';
  return (
    <div className="w-full h-2 rounded-full bg-bg-elev overflow-hidden">
      <div className={`h-full ${barColor}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}
