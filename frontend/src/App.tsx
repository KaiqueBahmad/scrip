import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

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
import { Withdrawals } from './pages/Withdrawals';

export function App() {
  const { merchant, loading } = useSession();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink">
        <p className="font-mono text-[11px] tracking-[0.14em] text-white/50 uppercase">
          {t('common.loading')}
        </p>
      </div>
    );
  }

  // No store selected yet: the panel is a store picker, not a login form.
  if (!merchant) return <SelectMerchant />;

  return (
    <Routes>
      <Route path="/documentation" element={<Documentation />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/transactions" replace />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/transactions/:id" element={<TransactionDetail />} />
        <Route path="/my-store" element={<MyStore />} />
        <Route path="/withdrawals" element={<Withdrawals />} />
        <Route path="/tokens" element={<Tokens />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/transactions" replace />} />
      </Route>
    </Routes>
  );
}
