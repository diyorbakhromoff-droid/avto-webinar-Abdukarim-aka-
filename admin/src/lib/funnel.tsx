import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/admin';
import { errorText } from '../api/errors';
import type { Funnel } from '../api/types';

const KEY = 'aw_admin_funnel';

interface FunnelCtx {
  funnels: Funnel[];
  funnel: Funnel | null;
  loading: boolean;
  error: string | null;
  setFunnelId: (id: number) => void;
  reload: () => Promise<Funnel[]>;
  /** Yangi yaratilgan voronkani ro'yxatga qo'shib, tanlaydi. */
  addFunnel: (f: Funnel) => void;
}

const Ctx = createContext<FunnelCtx | null>(null);

function readSaved(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function save(id: number) {
  try {
    localStorage.setItem(KEY, String(id));
  } catch {
    /* ignore */
  }
}

export function FunnelProvider({ children }: { children: ReactNode }) {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [selected, setSelected] = useState<number | null>(readSaved);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await api.funnels();
      setFunnels(list);
      setError(null);
      return list;
    } catch (e) {
      setError(errorText(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const funnel = useMemo(() => {
    if (!funnels.length) return null;
    return funnels.find((f) => f.id === selected) ?? funnels[0];
  }, [funnels, selected]);

  const setFunnelId = useCallback((id: number) => {
    setSelected(id);
    save(id);
  }, []);

  const addFunnel = useCallback((f: Funnel) => {
    setFunnels((list) => (list.some((x) => x.id === f.id) ? list : [...list, f]));
    setSelected(f.id);
    save(f.id);
  }, []);

  const value = useMemo(
    () => ({ funnels, funnel, loading, error, setFunnelId, reload, addFunnel }),
    [funnels, funnel, loading, error, setFunnelId, reload, addFunnel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFunnel(): FunnelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFunnel: FunnelProvider yo\'q');
  return c;
}
