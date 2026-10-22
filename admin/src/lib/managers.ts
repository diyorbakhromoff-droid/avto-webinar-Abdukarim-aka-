import { useEffect, useState } from 'react';
import { api } from '../api/admin';
import { useUser } from './auth';

export interface Manager { id: number; name: string }

let cache: Promise<Manager[]> | null = null;

/**
 * Menejerlar ro'yxati (GET /api/admin/managers — barcha rollar uchun).
 */
export function useManagers(): Manager[] {
  const me = useUser();
  const self: Manager = { id: me.id, name: me.name };
  const [list, setList] = useState<Manager[]>([self]);
  useEffect(() => {
    let alive = true;
    cache ??= api.managers()
      .catch(() => {
        cache = null;
        return [];
      });
    void cache.then((l) => {
      if (!alive) return;
      const merged = l.some((m) => m.id === me.id) ? l : [{ id: me.id, name: me.name }, ...l];
      setList(merged);
    });
    return () => {
      alive = false;
    };
  }, [me.id, me.name]);
  return list;
}

export function resetManagersCache(): void {
  cache = null;
}
