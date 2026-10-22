import { useEffect, useState } from 'react';
import { api } from '../api/admin';
import type { Requisites, TariffAdmin } from '../api/types';
import { Modal } from '../components/Modal';
import { NeedFunnel } from '../components/NeedFunnel';
import { SaveBar } from '../components/SaveBar';
import { MoneyInput, NumberInput, StringListEditor } from '../components/fields';
import { Badge, Card, Empty, ErrorBox, Loading, PageHead, Warnings } from '../components/ui';
import { useUser } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { money } from '../lib/format';
import { useSettingsForm } from '../lib/useSettings';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

type TariffDraft = Omit<TariffAdmin, 'id'> & { id?: number };

const EMPTY_TARIFF: TariffDraft = { name: '', description: '', special_price: 0, regular_price: 0, deposit_enabled: false, deposit_amount: 100000, sort: 0 };

function TariffModal({ draft, onClose, onSave }: { draft: TariffDraft | null; onClose: () => void; onSave: (t: TariffDraft) => Promise<void> }) {
  const [t, setT] = useState<TariffDraft>(EMPTY_TARIFF);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (draft) setT(draft); }, [draft]);
  const errs: string[] = [];
  if (!t.name.trim()) errs.push('Tarif nomini kiriting.');
  if (t.special_price <= 0) errs.push('Maxsus narxni kiriting.');
  if (t.regular_price <= 0) errs.push('Oddiy narxni kiriting.');
  if (t.special_price > t.regular_price) errs.push("Maxsus narx oddiy narxdan katta bo'lmasin.");
  if (t.deposit_enabled && (t.deposit_amount <= 0 || t.deposit_amount >= t.special_price)) errs.push("Boshlang'ich to'lov 0 dan katta va maxsus narxdan kichik bo'lsin.");
  const submit = async () => {
    if (errs.length) return;
    setBusy(true);
    try {
      await onSave({ ...t, name: t.name.trim(), description: t.description.trim() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={t.id ? `Tarif: ${draft?.name}` : 'Yangi tarif'}
      footer={<><button type="button" className="btn" onClick={onClose}>Bekor qilish</button><button type="button" className="btn btn-accent" onClick={() => void submit()} disabled={busy || errs.length > 0}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></>}
    >
      <label className="field"><span>Nomi</span><input className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Standart" /></label>
      <label className="field"><span>Tavsif</span><input className="input" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} placeholder="Darslar + uy vazifasi tekshiruvi" /></label>
      <div className="grid-2">
        <label className="field"><span>Maxsus narx (deadline ichida)</span><MoneyInput value={t.special_price || null} onChange={(n) => setT({ ...t, special_price: n ?? 0 })} /></label>
        <label className="field"><span>Oddiy narx</span><MoneyInput value={t.regular_price || null} onChange={(n) => setT({ ...t, regular_price: n ?? 0 })} /></label>
      </div>
      <label className="check">
        <input type="checkbox" checked={t.deposit_enabled} onChange={(e) => setT({ ...t, deposit_enabled: e.target.checked })} />
        Boshlang'ich to'lov yoqilgan
      </label>
      {t.deposit_enabled && (
        <label className="field"><span>Boshlang'ich to'lov summasi</span><MoneyInput value={t.deposit_amount || null} onChange={(n) => setT({ ...t, deposit_amount: n ?? 0 })} /></label>
      )}
      <label className="field" style={{ maxWidth: 160 }}><span>Tartib</span><NumberInput value={t.sort} min={0} onChange={(n) => setT({ ...t, sort: Math.round(n) })} /></label>
      {errs.length > 0 && <div className="small text-danger">{errs[0]}</div>}
    </Modal>
  );
}

function Tariffs({ fid }: { fid: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const st = useLoad(() => api.tariffs(fid), [fid]);
  const [edit, setEdit] = useState<TariffDraft | null>(null);

  const save = async (t: TariffDraft) => {
    try {
      if (t.id) {
        const saved = await api.updateTariff(t as TariffAdmin);
        st.setData((l) => (l ?? []).map((x) => (x.id === saved.id ? saved : x)));
      } else {
        const { id: _omit, ...body } = t;
        void _omit;
        const saved = await api.createTariff(fid, body);
        st.setData((l) => [...(l ?? []), saved]);
      }
      toast.success('Tarif saqlandi');
      setEdit(null);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (t: TariffAdmin) => {
    const ok = await confirm({ title: "Tarifni o'chirish", message: `«${t.name}» tarifi o'chiriladi. Avvalgi to'lovlar tarixda qoladi.`, confirmText: "O'chirish", danger: true });
    if (!ok) return;
    try {
      await api.deleteTariff(t.id);
      st.setData((l) => (l ?? []).filter((x) => x.id !== t.id));
      toast.success("O'chirildi");
    } catch (e) {
      toast.error(e);
    }
  };

  const list = [...(st.data ?? [])].sort((a, b) => a.sort - b.sort);
  return (
    <Card title="Tariflar" actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEdit({ ...EMPTY_TARIFF, sort: list.length + 1 })}>+ Tarif</button>}>
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : list.length === 0 ? (
        <Empty title="Tarif yo'q">Kamida bitta tarif kerak — aks holda sotuv bloki chiqmaydi.</Empty>
      ) : (
        <div className="table-wrap flat">
          <table className="table">
            <thead><tr><th>Tarif</th><th className="num">Maxsus narx</th><th className="num">Oddiy narx</th><th>Boshlang'ich</th><th></th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td><div className="cell-strong">{t.name}</div><div className="muted small">{t.description}</div></td>
                  <td className="num cell-strong">{money(t.special_price)}</td>
                  <td className="num">{money(t.regular_price)}</td>
                  <td>{t.deposit_enabled ? <Badge tone="warn">{money(t.deposit_amount)}</Badge> : <span className="muted">o'chiq</span>}</td>
                  <td>
                    <div className="row-end">
                      <button type="button" className="btn btn-sm" onClick={() => setEdit(t)}>Tahrirlash</button>
                      <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => void remove(t)}>O'chirish</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TariffModal draft={edit} onClose={() => setEdit(null)} onSave={save} />
    </Card>
  );
}

function OfferSettings({ fid }: { fid: number }) {
  const form = useSettingsForm(fid);
  const d = form.draft;
  if (form.state.error && !d) return <ErrorBox error={form.state.error} onRetry={form.state.reload} />;
  if (!d) return <Loading />;
  return (
    <Card title="Oferta va deadline">
      <label className="field"><span>Kurs nomi (sotuv blokida)</span><input className="input" value={d.offer_course_title} onChange={(e) => form.patch({ offer_course_title: e.target.value })} placeholder="Arab tili: 3 oylik kurs" /></label>
      <div className="field"><span>Bonuslar</span></div>
      <StringListEditor label="Bonus" value={d.bonuses} onChange={(v) => form.patch({ bonuses: v })} placeholder="Tajvid bo'yicha qo'shimcha dars" addLabel="+ Bonus" />
      <div className="grid-2">
        <label className="field">
          <span>Deadline — 2-kun tugaganidan keyin (D)</span>
          <NumberInput value={d.deadline_hours} min={1} max={720} onChange={(n) => form.patch({ deadline_hours: Math.round(n) })} suffix="soat" />
        </label>
        <label className="field">
          <span>Muddat tugagach</span>
          <select className="select" value={d.after_deadline} onChange={(e) => form.patch({ after_deadline: e.target.value as 'regular_price' | 'closed' })}>
            <option value="regular_price">Oddiy narxga o'tadi</option>
            <option value="closed">Taklif yopiladi</option>
          </select>
        </label>
        <label className="field">
          <span>Yopiq kurs kanali ID</span>
          <input className="input mono" inputMode="numeric" value={d.channel_id ?? ''} placeholder="-1001234567890" onChange={(e) => {
            const v = e.target.value.trim();
            form.patch({ channel_id: v === '' || v === '-' ? null : Number.isFinite(Number(v)) ? Number(v) : d.channel_id });
          }} />
          <span className="field-hint">Bot kanalda admin bo'lishi kerak — to'liq to'lovdan keyin bir martalik havola yuboriladi.</span>
        </label>
      </div>
      <div className="muted small">Deadline haqiqiy: muddat tugagach maxsus narx qaytmaydi, faqat lid kartasidan qo'lda uzaytiriladi.</div>
      <Warnings items={form.warnings} />
      <SaveBar dirty={form.dirty} saving={form.saving} onReset={form.reset} onSave={() => void form.save({ ...d, bonuses: d.bonuses.map((b) => b.trim()).filter(Boolean) })} />
    </Card>
  );
}

function RequisitesCard({ fid }: { fid: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const st = useLoad(() => api.requisites(fid), [fid]);
  const [r, setR] = useState<Requisites | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setR(st.data ?? null), [st.data]);
  if (st.error && !st.data) return <ErrorBox error={st.error} onRetry={st.reload} />;
  if (!r) return <Loading />;
  const dirty = JSON.stringify(r) !== JSON.stringify(st.data);
  const digits = r.card_number.replace(/\D/g, '');
  const errs: string[] = [];
  if (digits && digits.length !== 16) errs.push("Karta raqami 16 ta raqam bo'lishi kerak.");
  for (const [k, v] of [['Payme', r.payme_url], ['Click', r.click_url]] as const) {
    if (v && !/^https:\/\/\S+$/.test(v)) errs.push(`${k} havolasi https:// bilan boshlanishi kerak.`);
  }
  const save = async () => {
    const ok = await confirm({
      title: "Rekvizitlarni o'zgartirish",
      message: "O'zgarish audit logga yoziladi va boshqa super adminlarga Telegram orqali xabar boradi. Davom etasizmi?",
      confirmText: 'Saqlash',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const saved = await api.saveRequisites(fid, { ...r, card_number: digits.replace(/(\d{4})(?=\d)/g, '$1 ') });
      st.setData(saved);
      toast.success('Rekvizitlar saqlandi');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="To'lov rekvizitlari" actions={<Badge tone="ink">faqat super admin</Badge>}>
      <div className="box box-warn">Har bir o'zgarish loglanadi va boshqa super adminlarga Telegram orqali xabar boradi.</div>
      <div className="grid-2">
        <label className="field"><span>Karta raqami</span><input className="input mono" inputMode="numeric" value={r.card_number} onChange={(e) => setR({ ...r, card_number: e.target.value })} placeholder="8600 0000 0000 0000" /></label>
        <label className="field"><span>Karta egasi</span><input className="input" value={r.card_holder} onChange={(e) => setR({ ...r, card_holder: e.target.value })} placeholder="ISM FAMILIYA" /></label>
      </div>
      <label className="field"><span>Payme to'lov havolasi</span><input className="input mono" type="url" value={r.payme_url} onChange={(e) => setR({ ...r, payme_url: e.target.value.trim() })} placeholder="https://payme.uz/…" /></label>
      <label className="field"><span>Click to'lov havolasi</span><input className="input mono" type="url" value={r.click_url} onChange={(e) => setR({ ...r, click_url: e.target.value.trim() })} placeholder="https://my.click.uz/…" /></label>
      {errs.length > 0 && <div className="small text-danger">{errs[0]}</div>}
      <SaveBar dirty={dirty} saving={busy} onReset={() => setR(st.data ?? null)} onSave={() => void save()} disabled={errs.length > 0} />
    </Card>
  );
}

function SalesBody({ fid }: { fid: number }) {
  const user = useUser();
  return (
    <div className="cols">
      <div className="col-3 stack">
        <Tariffs fid={fid} />
        <OfferSettings fid={fid} />
      </div>
      <div className="col-2 stack">
        {user.role === 'super_admin' ? <RequisitesCard fid={fid} /> : (
          <Card title="To'lov rekvizitlari"><div className="muted">Karta rekvizitlari va Payme/Click havolalarini faqat super admin o'zgartiradi.</div></Card>
        )}
      </div>
    </div>
  );
}

export default function Sales() {
  return (
    <>
      <PageHead title="Sotuv bloki" sub="Tariflar, narxlar, bonuslar va shaxsiy deadline. Sotuv tugmasi 2-kun oferta timecode'ida chiqadi." />
      <NeedFunnel>{(f) => <SalesBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
