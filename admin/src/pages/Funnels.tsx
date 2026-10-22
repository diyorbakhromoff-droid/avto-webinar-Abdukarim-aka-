import { useState, type FormEvent } from 'react';
import { api } from '../api/admin';
import type { Funnel, FunnelSettings, MediaInfo } from '../api/types';
import { Modal } from '../components/Modal';
import { SaveBar } from '../components/SaveBar';
import { TextEditor } from '../components/TextEditor';
import { Card, Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { useFunnel } from '../lib/funnel';
import { useSettingsForm } from '../lib/useSettings';
import { useToast } from '../lib/toast';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const START_RE = /^[A-Za-z0-9_-]+$/;

function slugError(slug: string): string | null {
  if (!slug) return 'Slug kiriting';
  if (!SLUG_RE.test(slug)) return "Faqat kichik lotin harf, raqam va «-», 32 belgigacha (masalan: arab)";
  return null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function FunnelForm({ initial, submitText, onSubmit, onCancel }: {
  initial: { slug: string; name: string };
  submitText: string;
  onSubmit: (v: { slug: string; name: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const err = slugError(v.slug) ?? (!v.name.trim() ? 'Nomini kiriting' : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (err) return;
    setBusy(true);
    try {
      await onSubmit({ slug: v.slug, name: v.name.trim() });
      setV(initial);
      setTouched(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack-sm" onSubmit={submit} noValidate>
      <div className="inline-form">
        <label className="field">
          <span>Nomi</span>
          <input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Arab tili voronkasi" />
        </label>
        <label className="field">
          <span>Slug (deep link uchun)</span>
          <input className="input mono" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} placeholder="arab" aria-invalid={touched && !!slugError(v.slug)} />
        </label>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Bekor qilish</button>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Kuting…' : submitText}</button>
      </div>
      {touched && err && <div className="small text-danger">{err}</div>}
    </form>
  );
}

function DeeplinkGenerator({ funnel }: { funnel: Funnel }) {
  const toast = useToast();
  const [source, setSource] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const param = `${funnel.slug}_${source}`;
  const err = !source
    ? null
    : !START_RE.test(source)
      ? "Manbada faqat lotin harf, raqam, «_» va «-» bo'lishi mumkin"
      : param.length > 64
        ? `Parametr ${param.length} belgi — 64 dan oshmasligi kerak (voronka slug'i bilan birga)`
        : null;

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    if (!source || err) return;
    setBusy(true);
    try {
      const r = await api.deeplink(funnel.id, source);
      setUrl(r.url);
    } catch (e2) {
      toast.error(e2);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Deep link generatori">
      <div className="muted">Har bir reklama manbasi (kampaniya, kreativ) uchun alohida havola — lid kartasida va statistikada manba shu bo'yicha ko'rinadi.</div>
      <form className="inline-form" onSubmit={generate} noValidate>
        <label className="field">
          <span>Manba</span>
          <input className="input mono" value={source} placeholder="ig_reels3" maxLength={64} onChange={(e) => { setSource(e.target.value.trim()); setUrl(null); }} aria-invalid={!!err} aria-describedby="dl-hint" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!source || !!err || busy}>{busy ? 'Kuting…' : 'Havola yaratish'}</button>
      </form>
      <div id="dl-hint" className={err ? 'small text-danger' : 'small muted'}>
        {err ?? <>start parametri: <span className="mono">{param}</span> · {param.length}/64 belgi</>}
      </div>
      {url && (
        <div className="deeplink-out">
          <span className="deeplink-url">{url}</span>
          <button type="button" className="btn btn-sm" onClick={async () => (await copyText(url)) ? toast.success('Nusxalandi') : toast.error('Nusxalab bo\'lmadi')}>Nusxalash</button>
        </div>
      )}
    </Card>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="color-input">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${label} — rang tanlash`} />
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

function UploadUrl({ label, value, onChange, accept = 'image/*' }: { label: string; value: string | null; onChange: (url: string | null, m?: MediaInfo) => void; accept?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const id = `up-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row">
        {value ? <img src={value} alt="" className="media-thumb" /> : <span className="media-thumb media-thumb-ph">yo'q</span>}
        <label className="btn btn-sm file-btn" htmlFor={id}>
          {busy ? 'Yuklanmoqda…' : value ? 'Almashtirish' : 'Yuklash'}
          <input id={id} type="file" accept={accept} className="visually-hidden" disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              const m = await api.uploadMedia(f);
              onChange(m.url, m);
              if (m.warnings.length) toast.info(m.warnings.join('; '));
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }} />
        </label>
        {value && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>Olib tashlash</button>}
      </div>
    </div>
  );
}

function BrandSettings({ funnel }: { funnel: Funnel }) {
  const form = useSettingsForm(funnel.id);
  const { draft, patch } = form;
  const [magnet, setMagnet] = useState<MediaInfo | null>(null);
  const toast = useToast();
  if (form.state.error && !draft) return <ErrorBox error={form.state.error} onRetry={form.state.reload} />;
  if (!draft) return <Loading />;
  const set = <K extends keyof FunnelSettings>(k: K) => (v: FunnelSettings[K]) => patch({ [k]: v } as Partial<FunnelSettings>);
  return (
    <Card title={`Brend va salomlashish · ${funnel.name}`}>
      <div className="grid-form">
        <label className="field"><span>Kurs nomi</span><input className="input" value={draft.course_title} onChange={(e) => set('course_title')(e.target.value)} /></label>
        <label className="field"><span>Webinar sarlavhasi</span><input className="input" value={draft.webinar_title} onChange={(e) => set('webinar_title')(e.target.value)} placeholder="Bepul webinar · 2 kun" /></label>
        <label className="field"><span>Efir mavzusi</span><input className="input" value={draft.topic} onChange={(e) => set('topic')(e.target.value)} /></label>
        <label className="field"><span>Spiker ismi</span><input className="input" value={draft.speaker_name} onChange={(e) => set('speaker_name')(e.target.value)} /></label>
        <label className="field"><span>Spiker haqida (qisqa)</span><input className="input" value={draft.speaker_title} onChange={(e) => set('speaker_title')(e.target.value)} /></label>
        <ColorField label="Asosiy rang" value={draft.theme_primary} onChange={set('theme_primary')} />
        <ColorField label="Fon rangi" value={draft.theme_background} onChange={set('theme_background')} />
      </div>
      <div className="grid-form">
        <UploadUrl label="Spiker rasmi" value={draft.speaker_photo_url} onChange={(u) => set('speaker_photo_url')(u)} />
        <UploadUrl label="Logotip" value={draft.logo_url} onChange={(u) => set('logo_url')(u)} />
        <UploadUrl label="Fon rasmi" value={draft.bg_image_url} onChange={(u) => set('bg_image_url')(u)} />
      </div>
      <hr className="sep" />
      <TextEditor id="welcome" label="Salom matni (/start dan keyin)" value={draft.welcome_text} onChange={set('welcome_text')} rows={4} />
      <div className="grid-form">
        <div className="field">
          <span>Lid magnit (PDF yoki qisqa video)</span>
          <div className="row">
            <span className="muted">{magnet ? magnet.filename : draft.lead_magnet_media_id ? `Media #${draft.lead_magnet_media_id}` : 'yuklanmagan'}</span>
            <label className="btn btn-sm file-btn" htmlFor="magnet-file">
              {draft.lead_magnet_media_id ? 'Almashtirish' : 'Yuklash'}
              <input id="magnet-file" type="file" className="visually-hidden" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const m = await api.uploadMedia(f);
                  setMagnet(m);
                  set('lead_magnet_media_id')(m.id);
                  if (m.warnings.length) toast.info(m.warnings.join('; '));
                } catch (err) {
                  toast.error(err);
                } finally {
                  e.target.value = '';
                }
              }} />
            </label>
            {draft.lead_magnet_media_id && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setMagnet(null); set('lead_magnet_media_id')(null); }}>Olib tashlash</button>}
          </div>
        </div>
        <label className="field"><span>Lid magnit izohi</span><input className="input" value={draft.lead_magnet_caption} maxLength={1024} onChange={(e) => set('lead_magnet_caption')(e.target.value)} /></label>
      </div>
      {form.warnings.length > 0 && <div className="box box-warn" role="alert"><ul className="plain-list">{form.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      <SaveBar dirty={form.dirty} saving={form.saving} onSave={() => void form.save()} onReset={form.reset} />
    </Card>
  );
}

export default function Funnels() {
  const { funnels, funnel, loading, error, reload, addFunnel, setFunnelId } = useFunnel();
  const toast = useToast();
  const [copyOf, setCopyOf] = useState<Funnel | null>(null);

  const create = async (v: { slug: string; name: string }) => {
    try {
      const f = await api.createFunnel(v);
      addFunnel(f);
      toast.success(`«${f.name}» voronkasi yaratildi`);
    } catch (e) {
      toast.error(e);
      throw e;
    }
  };
  const copy = async (v: { slug: string; name: string }) => {
    if (!copyOf) return;
    try {
      const f = await api.copyFunnel(copyOf.id, v);
      addFunnel(f);
      setCopyOf(null);
      toast.success(`«${copyOf.name}» nusxalandi: «${f.name}»`);
    } catch (e) {
      toast.error(e);
      throw e;
    }
  };

  return (
    <>
      <PageHead title="Voronkalar" sub="Har bir kurs uchun alohida voronka: video, slotlar, progrev zanjiri va oferta." />
      {error && <ErrorBox error={error} onRetry={() => void reload()} />}
      <div className="cols">
        <div className="col-3 stack">
          <Card title="Voronkalar ro'yxati">
            {loading ? <Loading /> : funnels.length === 0 ? (
              <Empty title="Hali voronka yo'q">Quyidagi forma orqali birinchisini yarating.</Empty>
            ) : (
              <div className="table-wrap flat">
                <table className="table">
                  <thead><tr><th>Nomi</th><th>Slug</th><th>Bot</th><th></th></tr></thead>
                  <tbody>
                    {funnels.map((f) => (
                      <tr key={f.id} className={f.id === funnel?.id ? 'row-selected' : undefined}>
                        <td className="cell-strong">{f.name}{f.id === funnel?.id && <span className="badge badge-warn" style={{ marginLeft: 8 }}>tanlangan</span>}</td>
                        <td className="mono">{f.slug}</td>
                        <td className="muted">@{f.bot_username}</td>
                        <td>
                          <div className="row-end">
                            {f.id !== funnel?.id && <button type="button" className="btn btn-sm" onClick={() => setFunnelId(f.id)}>Tanlash</button>}
                            <button type="button" className="btn btn-sm" onClick={() => setCopyOf(f)}>Nusxalash</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Yangi voronka">
            <FunnelForm initial={{ slug: '', name: '' }} submitText="Yaratish" onSubmit={create} />
          </Card>
        </div>
        <div className="col-2 stack">
          {funnel && <DeeplinkGenerator funnel={funnel} />}
        </div>
      </div>
      {funnel && <BrandSettings key={funnel.id} funnel={funnel} />}

      <Modal open={!!copyOf} title={`Nusxalash: ${copyOf?.name ?? ''}`} onClose={() => setCopyOf(null)}>
        <div className="muted">Voronka sozlamalari va kontenti (video, slotlar, progrev zanjiri, tariflar) yangi voronkaga nusxalanadi; lidlar va to'lovlar ko'chmaydi.</div>
        {copyOf && <FunnelForm initial={{ slug: `${copyOf.slug}-2`, name: `${copyOf.name} (nusxa)` }} submitText="Nusxalash" onSubmit={copy} onCancel={() => setCopyOf(null)} />}
      </Modal>
    </>
  );
}
