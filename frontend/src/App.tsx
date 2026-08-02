import { Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { useSession } from './lib/session';
import { Documentation } from './pages/Documentation';
import { MyStore } from './pages/MyStore';
import { SelectMerchant } from './pages/SelectMerchant';
import { Settings } from './pages/Settings';
import { Tokens } from './pages/Tokens';
import { TransactionDetail } from './pages/TransactionDetail';
import { Transactions } from './pages/Transactions';
import { Webhooks } from './pages/Webhooks';

export function App() {
  const { merchant, loading } = useSession();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink">
        <p className="font-mono text-[11px] tracking-[0.14em] text-white/50 uppercase">
          carregando…
        </p>
      </div>
    );
  }

  // No store selected yet: the panel is a store picker, not a login form (specs.md:54).
  if (!merchant) return <SelectMerchant />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/transacoes" replace />} />
        <Route path="/transacoes" element={<Transactions />} />
        <Route path="/transacoes/:id" element={<TransactionDetail />} />
        <Route path="/minha-loja" element={<MyStore />} />
        <Route path="/tokens" element={<Tokens />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/documentacao" element={<Documentation />} />
        <Route path="/configuracoes" element={<Settings />} />
        <Route path="*" element={<Navigate to="/transacoes" replace />} />
      </Route>
    </Routes>
  );
}
