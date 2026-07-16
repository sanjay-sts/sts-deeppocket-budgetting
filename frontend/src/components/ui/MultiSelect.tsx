import { useEffect, useRef, useState } from 'react';

interface MultiSelectProps {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function MultiSelect({ options, selected, onChange, placeholder = 'Select…', disabled }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  // Sorted alphabetically so the trigger label matches the computed account name's order.
  const label = options.filter((o) => selected.includes(o.id)).map((o) => o.label).sort().join(', ');

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="w-full text-left bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand disabled:opacity-50"
      >
        {label || <span className="text-ink-dim">{placeholder}</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 min-w-full max-h-48 overflow-y-auto bg-bg-card border border-line rounded-md p-1 shadow-lg">
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5 text-xs text-ink-muted px-2 py-1 rounded hover:bg-bg-hover cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                className="accent-brand"
                checked={selected.includes(o.id)}
                onChange={() => toggle(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
