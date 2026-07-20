import { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/layout/Shell';

// Route-level code splitting: each page (and its heavy chart deps) loads on demand,
// so the initial bundle stays small. Pages are named exports, hence the `.then` map.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })));
const Budgets = lazy(() => import('./pages/Budgets').then((m) => ({ default: m.Budgets })));
const NetWorth = lazy(() => import('./pages/NetWorth').then((m) => ({ default: m.NetWorth })));
const Investments = lazy(() => import('./pages/Investments').then((m) => ({ default: m.Investments })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const Insights = lazy(() => import('./pages/Insights').then((m) => ({ default: m.Insights })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const Import = lazy(() => import('./pages/Import').then((m) => ({ default: m.Import })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

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
