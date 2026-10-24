import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Empty, Loading } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { ConfirmProvider } from './lib/confirm';
import { FunnelProvider } from './lib/funnel';
import { canAccess, type SectionKey } from './lib/roles';
import { ToastProvider } from './lib/toast';
import LoginPage from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Funnels = lazy(() => import('./pages/Funnels'));
const Video = lazy(() => import('./pages/Video'));
const Slots = lazy(() => import('./pages/Slots'));
const Chain = lazy(() => import('./pages/Chain'));
const Sales = lazy(() => import('./pages/Sales'));
const Comments = lazy(() => import('./pages/Comments'));
const Leads = lazy(() => import('./pages/Leads'));
const LeadCardPage = lazy(() => import('./pages/LeadCard'));
const Questions = lazy(() => import('./pages/Questions'));
const Chat = lazy(() => import('./pages/Chat'));
const Payments = lazy(() => import('./pages/Payments'));
const Broadcasts = lazy(() => import('./pages/Broadcasts'));
const Stats = lazy(() => import('./pages/Stats'));
const Settings = lazy(() => import('./pages/Settings'));

function RequireAuth() {
  const { user, checking } = useAuth();
  const location = useLocation();
  if (checking) return <div className="fullpage"><Loading text="Tekshirilmoqda…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <FunnelProvider>
      <Outlet />
    </FunnelProvider>
  );
}

function Guard({ k, children }: { k: SectionKey; children: ReactNode }) {
  const { user } = useAuth();
  if (!canAccess(user?.role, k)) {
    return (
      <Empty title="Bu bo'limga ruxsat yo'q">
        Rolingiz bu bo'limni ko'rishga ruxsat bermaydi. <Link to="/">Dashboard'ga qaytish</Link>
      </Empty>
    );
  }
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function NotFound() {
  return (
    <Empty title="Sahifa topilmadi">
      <Link to="/">Dashboard'ga qaytish</Link>
    </Empty>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route index element={<Guard k="dashboard"><Dashboard /></Guard>} />
                  <Route path="funnels" element={<Guard k="funnels"><Funnels /></Guard>} />
                  <Route path="video" element={<Guard k="video"><Video /></Guard>} />
                  <Route path="slots" element={<Guard k="slots"><Slots /></Guard>} />
                  <Route path="chain" element={<Guard k="chain"><Chain /></Guard>} />
                  <Route path="sales" element={<Guard k="sales"><Sales /></Guard>} />
                  <Route path="comments" element={<Guard k="comments"><Comments /></Guard>} />
                  <Route path="leads" element={<Guard k="leads"><Leads /></Guard>} />
                  <Route path="leads/:id" element={<Guard k="leads"><LeadCardPage /></Guard>} />
                  <Route path="questions" element={<Guard k="questions"><Questions /></Guard>} />
                  <Route path="chat" element={<Guard k="chat"><Chat /></Guard>} />
                  <Route path="payments" element={<Guard k="payments"><Payments /></Guard>} />
                  <Route path="broadcasts" element={<Guard k="broadcasts"><Broadcasts /></Guard>} />
                  <Route path="stats" element={<Guard k="stats"><Stats /></Guard>} />
                  <Route path="settings" element={<Guard k="settings"><Settings /></Guard>} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
            </Routes>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
