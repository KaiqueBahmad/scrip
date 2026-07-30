import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, setActingUser, type ApiUser } from './api';

const STORAGE_KEY = 'pseudopay.acting-user';

interface SessionValue {
  user: ApiUser | null;
  users: ApiUser[];
  loading: boolean;
  error: string | null;
  /** Selecting a user *is* the login (specs.md:54). */
  selectUser: (user: ApiUser) => void;
  signOut: () => void;
  refreshUsers: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.sessionUsers();
      setUsers(response.data);
      setError(null);
      return response.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os usuários');
      return [];
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await load();

      // Restore the previous selection, but only if that user still exists.
      const storedId = localStorage.getItem(STORAGE_KEY);
      const restored = storedId ? list.find((candidate) => candidate.id === storedId) : undefined;

      if (restored) {
        setActingUser(restored.id);
        setUser(restored);
      } else if (storedId) {
        localStorage.removeItem(STORAGE_KEY);
      }

      setLoading(false);
    })();
  }, [load]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      users,
      loading,
      error,
      selectUser: (next) => {
        localStorage.setItem(STORAGE_KEY, next.id);
        setActingUser(next.id);
        setUser(next);
      },
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY);
        setActingUser(null);
        setUser(null);
      },
      refreshUsers: async () => {
        await load();
      },
    }),
    [user, users, loading, error, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

/** The acting user, once one is selected. */
export function useActingUser(): ApiUser {
  const { user } = useSession();
  if (!user) throw new Error('No acting user selected');
  return user;
}
