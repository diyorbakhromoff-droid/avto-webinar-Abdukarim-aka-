import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/admin';
import type { FunnelSettings } from '../api/types';
import { useToast } from './toast';
import { useLoad } from './useLoad';

/**
 * Voronka sozlamalari formasi: GET → qoralama → PUT (to'liq obyekt).
 * PUT javobidagi warnings ko'rsatish uchun saqlanadi.
 */
export function useSettingsForm(fid: number) {
  const toast = useToast();
  const state = useLoad(() => api.settings(fid), [fid]);
  const [draft, setDraft] = useState<FunnelSettings | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(state.data ?? null);
  }, [state.data]);
  useEffect(() => setWarnings([]), [fid]);

  const dirty = !!draft && !!state.data && JSON.stringify(draft) !== JSON.stringify(state.data);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const patch = useCallback((p: Partial<FunnelSettings>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);
  const reset = useCallback(() => setDraft(state.data ?? null), [state.data]);

  const save = useCallback(async (override?: FunnelSettings) => {
    const body = override ?? draft;
    if (!body) return false;
    setSaving(true);
    try {
      const res = await api.saveSettings(fid, body);
      const { warnings: w, ...rest } = res;
      state.setData(rest as FunnelSettings);
      setWarnings(w ?? []);
      toast.success(w?.length ? 'Saqlandi — ogohlantirishlarni ko\'ring' : 'Saqlandi');
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, fid, state, toast]);

  return { state, draft, patch, reset, save, saving, dirty, warnings };
}
