import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../components/Modal';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        title={opts?.title ?? ''}
        onClose={() => close(false)}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={() => close(false)}>{opts?.cancelText ?? 'Bekor qilish'}</button>
            <button type="button" className={opts?.danger ? 'btn btn-danger' : 'btn btn-accent'} onClick={() => close(true)} autoFocus>
              {opts?.confirmText ?? 'Tasdiqlash'}
            </button>
          </>
        }
      >
        {opts?.message && <div className="confirm-text">{opts.message}</div>}
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConfirm: ConfirmProvider yo\'q');
  return c;
}
