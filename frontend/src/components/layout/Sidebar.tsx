import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', icon: '◐' },
  { to: '/transactions', label: 'Transactions', icon: '≡' },
  { to: '/budgets', label: 'Budgets', icon: '◫' },
  { to: '/networth', label: 'Net Worth', icon: '△' },
  { to: '/investments', label: 'Investments', icon: '◉' },
  { to: '/reports', label: 'Reports', icon: '▥' },
  { to: '/insights', label: 'Insights', icon: '✦' },
  { to: '/accounts', label: 'Accounts', icon: '□' },
  { to: '/import', label: 'Import', icon: '↓' },
  { to: '/settings', label: 'Settings', icon: '✦' },
];

export function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-line bg-bg-elev p-4">
      <div className="flex items-center gap-2 mb-6 px-2">
        <div className="w-7 h-7 rounded-lg bg-brand text-bg flex items-center justify-center font-bold">D</div>
        <div>
          <div className="font-semibold text-ink leading-tight">DeepPocket</div>
          <div className="text-[10px] text-ink-dim uppercase tracking-wider">Canadian · CAD</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand/10 text-brand'
                  : 'text-ink-muted hover:text-ink hover:bg-bg-hover'
              }`
            }
          >
            <span className="w-4 text-center text-base">{l.icon}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="pt-4 text-[10px] text-ink-dim px-2 border-t border-line">
        M1 · Mock Data · 2026
      </div>
    </aside>
  );
}
