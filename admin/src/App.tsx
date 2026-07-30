import { Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { useSession } from './lib/session';
import { Docs } from './pages/Docs';
import { Kyc } from './pages/Kyc';
import { Merchants } from './pages/Merchants';
import { SelectUser } from './pages/SelectUser';
import { Settings } from './pages/Settings';
import { Tokens } from './pages/Tokens';
import { TransactionDetail } from './pages/TransactionDetail';
import { Transactions } from './pages/Transactions';
import { Users } from './pages/Users';
import { Webhooks } from './pages/Webhooks';

export function App() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink">
        <p className="font-mono text-[11px] tracking-[0.14em] text-white/50 uppercase">
          carregando…
        </p>
      </div>
    );
  }

  // No user selected yet: the panel is a user picker, not a login form (specs.md:54).
  if (!user) return <SelectUser />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/transacoes" replace />} />
        <Route path="/transacoes" element={<Transactions />} />
        <Route path="/transacoes/:id" element={<TransactionDetail />} />
        <Route path="/comerciantes" element={<Merchants />} />
        <Route path="/usuarios" element={<Users />} />
        <Route path="/tokens" element={<Tokens />} />
        <Route path="/kyc" element={<Kyc />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/configuracoes" element={<Settings />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="*" element={<Navigate to="/transacoes" replace />} />
      </Route>
    </Routes>
  );
}
