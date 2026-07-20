import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';

// Global error-toast stack (bottom-right). Oldest toast auto-dismisses after 6s.
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => dismiss(toasts[0]!.id), 6000);
    return () => clearTimeout(timer);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-3 bg-bg-elev border border-down/60 text-ink text-sm rounded-lg px-4 py-2.5 shadow-lg"
        >
          <span>{t.message}</span>
          <button
            className="text-ink-dim hover:text-ink"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
