import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { IS_MOCK } from '../api/client';
import { errorText } from '../api/errors';
import { BrandMark } from '../components/BrandMark';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.login.trim() || !form.password) {
      setError('Login va parolni kiriting');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(form.login.trim(), form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <div className="brand-name">Avtowebinar</div>
            <div className="brand-sub">Admin panel</div>
          </div>
        </div>
        <h1 className="login-title">Kirish</h1>
        <label className="field">
          <span>Login</span>
          <input className="input" autoComplete="username" autoFocus value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </label>
        <label className="field">
          <span>Parol</span>
          <input className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && <div className="box box-danger" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Kirilmoqda…' : 'Kirish'}</button>
        {IS_MOCK && (
          <div className="box box-warn small">
            Demo rejim: istalgan login va parol. «kamola» — kontent menejer, «nodira» — sotuv menejeri, boshqasi — super admin.
          </div>
        )}
      </form>
    </div>
  );
}
