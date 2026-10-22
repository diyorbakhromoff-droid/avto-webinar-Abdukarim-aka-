import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../api/errors';

export interface LoadState<T> {
  data: T | undefined;
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Ma'lumot yuklash: deps o'zgarsa qayta yuklaydi, eski javoblarni tashlab yuboradi. */
export function useLoad<T>(fn: (() => Promise<T>) | null, deps: unknown[]): LoadState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(!!fn);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (silent: boolean) => {
    const f = fnRef.current;
    if (!f) {
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const res = await f();
      if (my === seq.current) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(errorText(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(undefined);
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(true), [run]);
  return { data, setData, loading, error, reload };
}
