import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/admin';
import type { AdminUser, GlobalSettings, Role, UserInput } from '../api/types';
import { Modal } from '../components/Modal';
import { Badge, Card, Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { useUser } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { ROLE_LABEL, options } from '../lib/labels';
import { resetManagersCache } from '../lib/managers';
import { fmtDateTime } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

type UserDraft = { id?: number; name: string; login: string; role: Role; tg_user_id: string; active: boolean; password: string };

function UserModal({ draft, onClose, onSaved }: { draft: UserDraft | null; onClose: () => void; onSaved: (u: AdminUser) => void }) {
  const toast = useToast();
  const [u, setU] = useState<UserDraft | null>(draft);
  const [busy, setBusy] = useState(false);
  useEffect(() => setU(draft), [draft]);
  if (!u) return <Modal open={false} title="" onClose={onClose} />;
  const isNew = !u.id;
  const errs: string[] = [];
  if (!u.name.trim()) errs.push('Ismni kiriting.');
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u.login)) errs.push("Login: 3–32 belgi, lotin harf, raqam, «_ . -».");
  if (u.tg_user_id && !/^\d{4,15}$/.test(u.tg_user_id)) errs.push('Telegram ID faqat raqamlardan iborat.');
  if (isNew && u.password.length < 8) errs.push("Parol kamida 8 belgi bo'lsin.");
  const save = async () => {
    if (errs.length) return;
    setBusy(true);
    const body: UserInput = { name: u.name.trim(), login: u.login, role: u.role, tg_user_id: u.tg_user_id ? Number(u.tg_user_id) : null, active: u.active };
    if (isNew) body.password = u.password;
    try {
      const saved = isNew ? await api.createUser(body) : await api.updateUser(u.id!, body);
      onSaved(saved);
      toast.success(isNew ? "Foydalanuvchi qo'shildi" : 'Saqlandi');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!draft} onClose={onClose} title={isNew ? 'Yangi foydalanuvchi' : `Tahrirlash: ${draft?.name}`}
      footer={<><button type="button" className="btn" onClick={onClose}>Bekor qilish</button><button type="button" className="btn btn-accent" disabled={busy || errs.length > 0} onClick={() => void save()}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></>}>
      <div className="grid-2">
        <label className="field"><span>Ism</span><input className="input" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></label>
        <label className="field"><span>Login</span><input className="input mono" autoComplete="off" value={u.login} onChange={(e) => setU({ ...u, login: e.target.value.trim() })} /></label>
        <label className="field">
          <span>Rol</span>
          <select className="select" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
            {options(ROLE_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Telegram ID</span>
          <input className="input mono" inputMode="numeric" value={u.tg_user_id} onChange={(e) => setU({ ...u, tg_user_id: e.target.value.replace(/\D/g, '') })} placeholder="123456789" />
        </label>
        {isNew && <label className="field" style={{ gridColumn: '1 / -1' }}><span>Parol</span><input className="input" type="password" autoComplete="new-password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></label>}
      </div>
      <div className="muted small">Telegram ID guruhdagi «Tasdiqlash / Rad etish» tugmalari va test xabarlar uchun kerak. ID ni @userinfobot dan bilish mumkin.</div>
      <label className="check"><input type="checkbox" checked={u.active} onChange={(e) => setU({ ...u, active: e.target.checked })} /> Faol</label>
      {errs.length > 0 && <div className="small text-danger">{errs[0]}</div>}
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPw(''), [user]);
  const gen = () => {
    const a = new Uint32Array(3);
    crypto.getRandomValues(a);
    setPw(Array.from(a, (n) => n.toString(36)).join('').slice(0, 14));
  };
  const save = async () => {
    if (!user || pw.length < 8) return;
    setBusy(true);
    try {
      await api.updateUser(user.id, { password: pw });
      toast.success('Yangi parol saqlandi — foydalanuvchiga xavfsiz yo\'l bilan yetkazing');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!user} onClose={onClose} size="sm" title={`Parolni tiklash: ${user?.name ?? ''}`}
      footer={<><button type="button" className="btn" onClick={onClose}>Bekor qilish</button><button type="button" className="btn btn-accent" disabled={busy || pw.length < 8} onClick={() => void save()}>Saqlash</button></>}>
      <label className="field"><span>Yangi parol (kamida 8 belgi)</span><input className="input mono" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <button type="button" className="btn btn-sm" onClick={gen}>Tasodifiy parol yaratish</button>
    </Modal>
  );
}

function Users() {
  const me = useUser();
  const confirm = useConfirm();
  const toast = useToast();
  const st = useLoad(() => api.users(), []);
  const [edit, setEdit] = useState<UserDraft | null>(null);
  const [pwUser, setPwUser] = useState<AdminUser | null>(null);
  const upsert = (u: AdminUser) => {
    resetManagersCache();
    st.setData((l) => (l ?? []).some((x) => x.id === u.id) ? (l ?? []).map((x) => (x.id === u.id ? u : x)) : [...(l ?? []), u]);
  };
  const toggleActive = async (u: AdminUser) => {
    if (u.id === me.id) return;
    if (u.active) {
      const ok = await confirm({ title: "Foydalanuvchini o'chirish", message: `${u.name} panelga kira olmaydi va guruhdagi tugmalarni bosa olmaydi.`, confirmText: "O'chirish", danger: true });
      if (!ok) return;
    }
    try {
      upsert(await api.updateUser(u.id, { active: !u.active }));
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card title="Foydalanuvchilar va rollar" actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEdit({ name: '', login: '', role: 'sales', tg_user_id: '', active: true, password: '' })}>+ Foydalanuvchi</button>}>
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : (
        <div className="table-wrap flat">
          <table className="table">
            <thead><tr><th>Ism</th><th>Login</th><th>Rol</th><th>Telegram ID</th><th>Holat</th><th></th></tr></thead>
            <tbody>
              {st.data.map((u) => (
                <tr key={u.id}>
                  <td className="cell-strong">{u.name}{u.id === me.id && <span className="muted"> (siz)</span>}</td>
                  <td className="mono">{u.login}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td className="mono">{u.tg_user_id ?? <span className="muted">—</span>}</td>
                  <td>
                    <label className="check" style={{ minHeight: 0 }}>
                      <input type="checkbox" checked={u.active} disabled={u.id === me.id} onChange={() => void toggleActive(u)} aria-label={`${u.name} faol`} />
                      {u.active ? <Badge tone="success">faol</Badge> : <Badge>o'chirilgan</Badge>}
                    </label>
                  </td>
                  <td>
                    <div className="row-end">
                      <button type="button" className="btn btn-sm" onClick={() => setEdit({ id: u.id, name: u.name, login: u.login, role: u.role, tg_user_id: u.tg_user_id ? String(u.tg_user_id) : '', active: u.active, password: '' })}>Tahrirlash</button>
                      <button type="button" className="btn btn-sm" onClick={() => setPwUser(u)}>Parolni tiklash</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small">Kontent menejer lid telefonlari va cheklarni ko'rmaydi. Sotuv menejeri kontent va rekvizitlarni o'zgartira olmaydi.</div>
      <UserModal draft={edit} onClose={() => setEdit(null)} onSaved={upsert} />
      <PasswordModal user={pwUser} onClose={() => setPwUser(null)} />
    </Card>
  );
}

function Global() {
  const toast = useToast();
  const st = useLoad(() => api.globalSettings(), []);
  const [g, setG] = useState<GlobalSettings | null>(null);
  const [chat, setChat] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!st.data) return;
    setG(st.data);
    setChat(st.data.admin_group_chat_id === null ? '' : String(st.data.admin_group_chat_id));
  }, [st.data]);
  if (st.error && !st.data) return <ErrorBox error={st.error} onRetry={st.reload} />;
  if (!g) return <Loading />;
  const chatOk = chat === '' || /^-?\d{5,20}$/.test(chat);
  const dirty = chat !== (st.data?.admin_group_chat_id === null ? '' : String(st.data?.admin_group_chat_id)) || g.bot_username !== st.data?.bot_username;
  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.saveGlobalSettings({ admin_group_chat_id: chat === '' ? null : Number(chat) });
      st.setData(saved);
      toast.success('Saqlandi');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Bot va admin guruhi">
      <label className="field">
        <span>Cheklar uchun admin Telegram guruhi (chat ID)</span>
        <input className="input mono" value={chat} onChange={(e) => setChat(e.target.value.trim())} placeholder="-1001234567890" aria-invalid={!chatOk} />
        <span className="field-hint">Botni guruhga qo'shing va admin qiling. Guruh ID odatda «-100» bilan boshlanadi.</span>
      </label>
      <label className="field">
        <span>Bot username</span>
        <input className="input mono" value={g.bot_username} onChange={(e) => setG({ ...g, bot_username: e.target.value.replace(/^@/, '').trim() })} />
      </label>
      <div className="muted small">Tungi tinchlik oralig'i har bir voronkaning «Slotlar» bo'limida sozlanadi.</div>
      <div className="form-actions"><button type="button" className="btn btn-accent" disabled={!dirty || !chatOk || busy} onClick={() => void save()}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></div>
    </Card>
  );
}

/** Test xabarlari uchun guruh: saqlashda bot unga yozib ko'radi. */
function TestChat() {
  const toast = useToast();
  const st = useLoad(() => api.globalSettings(), []);
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data) setV(st.data.test_chat_id === null ? '' : String(st.data.test_chat_id)); }, [st.data]);
  if (st.error && !st.data) return <ErrorBox error={st.error} onRetry={st.reload} />;
  if (!st.data) return <Loading />;
  const ok = v === '' || /^-?\d{5,20}$/.test(v);
  const saved = st.data.test_chat_id === null ? '' : String(st.data.test_chat_id);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.saveGlobalSettings({ test_chat_id: v === '' ? null : Number(v) });
      st.setData(r);
      toast.success(r.test_chat_id ? `Test chati ulandi: ${r.test_chat_title ?? r.test_chat_id}` : "Test chati o'chirildi");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="🧪 Test chati">
      <div className="small muted">
        Xabarlarni lidlarga ketishidan oldin tekshirish uchun alohida Telegram guruh. Botni guruhga qo'shing va guruh ID sini kiriting —
        saqlashda bot guruhga «✅ Test chati ulandi» deb yozadi. Lidlar bu guruhga hech qachon qo'shilmaydi.
        Har bir admin o'z Telegramiga ham test yuborishi mumkin (Foydalanuvchilar bo'limidagi Telegram ID orqali).
      </div>
      <label className="field">
        <span>Test guruhi (chat ID)</span>
        <input className="input mono" value={v} onChange={(e) => setV(e.target.value.trim())} placeholder="-1001234567890" aria-invalid={!ok} />
        {st.data.test_chat_id ? <span className="field-hint">Ulangan: <b>{st.data.test_chat_title ?? st.data.test_chat_id}</b></span> : <span className="field-hint">Ulanmagan</span>}
      </label>
      <div className="form-actions"><button type="button" className="btn btn-accent" disabled={v === saved || !ok || busy} onClick={() => void save()}>{busy ? 'Tekshirilmoqda…' : 'Saqlash va tekshirish'}</button></div>
    </Card>
  );
}

function Audit() {
  const st = useLoad(() => api.audit(), []);
  const [q, setQ] = useState('');
  const list = (st.data ?? []).filter((r) => !q || `${r.user} ${r.action} ${r.details}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card title="Audit log" actions={<input className="input" style={{ width: 220 }} type="search" aria-label="Audit logdan qidirish" placeholder="Qidirish" value={q} onChange={(e) => setQ(e.target.value)} />}>
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : list.length === 0 ? <Empty title="Yozuv yo'q" /> : (
        <div className="table-wrap flat" style={{ maxHeight: 480, overflowY: 'auto' }}>
          <table className="table table-compact">
            <thead><tr><th>Vaqt</th><th>Kim</th><th>Amal</th><th>Tafsilot</th></tr></thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap muted tnum">{fmtDateTime(r.at)}</td>
                  <td className="nowrap cell-strong">{r.user}</td>
                  <td className="nowrap">{r.action}</td>
                  <td>{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Failed() {
  const st = useLoad(() => api.failedMessages(), []);
  return (
    <section id="failed" style={{ scrollMarginTop: 72 }}>
      <Card title={`Yuborilmagan xabarlar${st.data ? ` · ${st.data.length}` : ''}`} actions={<button type="button" className="btn btn-sm" onClick={() => void st.reload()}>Yangilash</button>}>
        {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : st.data.length === 0 ? (
          <div className="box box-success">Hamma xabarlar yetkazilgan.</div>
        ) : (
          <div className="table-wrap flat">
            <table className="table table-compact">
              <thead><tr><th>Vaqt</th><th>Lid</th><th>Xabar</th><th>Xato</th></tr></thead>
              <tbody>
                {st.data.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap muted tnum">{fmtDateTime(r.at)}</td>
                    <td className="cell-strong">{r.lead_name}</td>
                    <td>{r.title}</td>
                    <td className="text-danger">{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

export default function Settings() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash === '#failed') setTimeout(() => document.getElementById('failed')?.scrollIntoView({ behavior: 'smooth' }), 300);
  }, [location.hash]);
  return (
    <>
      <PageHead title="Sozlamalar" sub="Foydalanuvchilar, rollar, admin guruhi va tizim jurnallari." />
      <Users />
      <div className="cols">
        <div className="col-2 stack">
          <Global />
          <TestChat />
        </div>
        <div className="col-3"><Failed /></div>
      </div>
      <Audit />
    </>
  );
}
