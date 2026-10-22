import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Funnel } from '../api/types';
import { useFunnel } from '../lib/funnel';
import { useUser } from '../lib/auth';
import { canAccess } from '../lib/roles';
import { Empty, ErrorBox, Loading } from './ui';

/** Sahifa voronka tanlanganidan keyin chiziladi. */
export function NeedFunnel({ children }: { children: (f: Funnel) => ReactNode }) {
  const { funnel, loading, error, reload } = useFunnel();
  const user = useUser();
  if (loading) return <Loading />;
  if (error && !funnel) return <ErrorBox error={error} onRetry={() => void reload()} />;
  if (!funnel) {
    return (
      <Empty title="Hali voronka yo'q">
        {canAccess(user.role, 'funnels') ? <Link to="/funnels">Voronkalar bo'limida birinchi voronkani yarating</Link> : 'Administrator voronka yaratishi kerak.'}
      </Empty>
    );
  }
  return <>{children(funnel)}</>;
}
