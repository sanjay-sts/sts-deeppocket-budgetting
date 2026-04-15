import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAppStore } from '../../store/useAppStore';

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/transactions': 'Transactions',
  '/budgets': 'Budgets',
  '/networth': 'Net Worth',
  '/investments': 'Investments',
  '/reports': 'Reports',
  '/insights': 'Insights',
  '/accounts': 'Accounts',
  '/import': 'Import',
  '/settings': 'Settings',
};

export function Shell() {
  const { loaded, init } = useAppStore();
  const location = useLocation();

  useEffect(() => {
    void init();
  }, [init]);

  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center text-ink-muted">
        Loading fixtures…
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={titles[location.pathname] ?? 'DeepPocket'} />
        <main className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
