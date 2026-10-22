import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/admin';
import { getToken, setToken, setUnauthorizedHandler } from '../api/client';
import { resetManagersCache } from './managers';
import type { AdminUser } from '../api/types';

interface AuthCtx {
  user: AdminUser | null;
  /** Token bor, lekin /me hali javob bermagan. */
  checking: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState<boolean>(() => !!getToken());

  const logout = useCallback(() => {
    setToken(null);
    resetManagersCache();
    setUser(null);
    setChecking(false);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setChecking(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    api.me()
      .then((u) => alive && setUser(u))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (login: string, password: string) => {
    const res = await api.login(login, password);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo(() => ({ user, checking, login, logout }), [user, checking, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth: AuthProvider yo\'q');
  return c;
}

/** Faqat himoyalangan sahifalar ichida: foydalanuvchi albatta bor. */
export function useUser(): AdminUser {
  const { user } = useAuth();
  if (!user) throw new Error('useUser: foydalanuvchi yo\'q');
  return user;
}
