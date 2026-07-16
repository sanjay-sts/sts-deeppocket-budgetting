import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Budgets } from './pages/Budgets';
import { NetWorth } from './pages/NetWorth';
import { Investments } from './pages/Investments';
import { Reports } from './pages/Reports';
import { Insights } from './pages/Insights';
import { Accounts } from './pages/Accounts';
import { Import } from './pages/Import';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="networth" element={<NetWorth />} />
        <Route path="investments" element={<Investments />} />
        <Route path="reports" element={<Reports />} />
        <Route path="insights" element={<Insights />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="import" element={<Import />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
