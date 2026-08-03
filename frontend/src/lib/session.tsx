import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { api, setActingMerchant, type ApiMerchant } from './api';

const STORAGE_KEY = 'scrip.acting-merchant';

interface SessionValue {
  merchant: ApiMerchant | null;
  merchants: ApiMerchant[];
  loading: boolean;
  error: string | null;
  /** Selecting a store *is* the login. */
  selectMerchant: (merchant: ApiMerchant) => void;
  signOut: () => void;
  refreshMerchants: () => Promise<void>;
  /** Re-reads the acting store, so a balance or KYC change shows up in the chrome. */
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [merchants, setMerchants] = useState<ApiMerchant[]>([]);
  const [merchant, setMerchant] = useState<ApiMerchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.sessionMerchants();
      setMerchants(response.data);
      setError(null);
      return response.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('session.loadFailed'));
      return [];
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      const list = await load();

      // Restore the previous selection, but only if that store still exists.
      const storedId = localStorage.getItem(STORAGE_KEY);
      const restored = storedId ? list.find((candidate) => candidate.id === storedId) : undefined;

      if (restored) {
        setActingMerchant(restored.id);
        setMerchant(restored);
      } else if (storedId) {
        localStorage.removeItem(STORAGE_KEY);
      }

      setLoading(false);
    })();
  }, [load]);

  const value = useMemo<SessionValue>(
    () => ({
      merchant,
      merchants,
      loading,
      error,
      selectMerchant: (next) => {
        localStorage.setItem(STORAGE_KEY, next.id);
        setActingMerchant(next.id);
        setMerchant(next);
      },
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY);
        setActingMerchant(null);
        setMerchant(null);
      },
      refreshMerchants: async () => {
        await load();
      },
      refreshSession: async () => {
        try {
          const { merchant: fresh } = await api.me();
          setMerchant(fresh);
        } catch {
          // A deleted store leaves the session dangling; drop it and go back to the picker.
          localStorage.removeItem(STORAGE_KEY);
          setActingMerchant(null);
          setMerchant(null);
        }
      },
    }),
    [merchant, merchants, loading, error, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

/** The acting store, once one is selected. */
export function useMerchant(): ApiMerchant {
  const { merchant } = useSession();
  if (!merchant) throw new Error('No acting merchant selected');
  return merchant;
}
