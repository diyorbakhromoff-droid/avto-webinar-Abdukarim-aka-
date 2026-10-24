import { useState } from 'react';
import { api } from '../api/admin';
import type { Broadcast, ChainButton, MediaInfo, Segment } from '../api/types';
import { ButtonsEditor, cleanButtons, validateButtons } from '../components/ButtonsEditor';
import { NeedFunnel } from '../components/NeedFunnel';
import { TelegramPreview } from '../components/TelegramPreview';
import { TextEditor } from '../components/TextEditor';
import { Badge, Card, Empty, ErrorBox, Loading, PageHead, Segmented, type Tone } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { fileSize, num } from '../lib/format';
import { honestyHits } from '../lib/honesty';
import { SEGMENT_LABEL, isWatchSegment, options } from '../lib/labels';
import { visibleLength } from '../lib/telegramHtml';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

const STATUS: Record<Broadcast['status'], [string, Tone]> = {
  scheduled: ['rejada', 'info'],
  sending: ['yuborilmoqda', 'warn'],
  done: ['yuborildi', 'success'],
};

function BroadcastsBody({ fid }: { fid: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useLoad(() => api.broadcasts(fid), [fid]);
  const [segment, setSegment] = useState<Segment | 'cold'>('all');
  const [text, setText] = useState('');
  const [buttons, setButtons] = useState<ChainButton[][]>([]);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [sendAt, setSendAt] = useState(() => toLocalInput(Math.ceil((Date.now() + 3600_000) / 900_000) * 900_000));
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const limit = media ? 1024 : 4096;
  const btnErr = validateButtons(buttons);
  const sendIso = mode === 'later' ? fromLocalInput(sendAt) : null;
  const errs: string[] = [];
  if (!text.trim()) errs.push('Matn kiriting.');
  if (visibleLength(text) > limit) errs.push(`Matn ${limit} belgidan oshmasin.`);
  if (btnErr) errs.push(btnErr);
  if (mode === 'later' && (!sendIso || Date.parse(sendIso) < Date.now())) errs.push('Rejali vaqt kelajakda bo\'lishi kerak.');

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const m = await api.uploadMedia(f);
      setMedia(m);
      if (m.warnings.length) toast.info(m.warnings.join('; '));
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  const payload = () => ({ text, buttons: cleanButtons(buttons), media_id: media?.id ?? null });

  const test = async () => {
    setBusy('test');
    try {
      await api.testBroadcast(payload());
      toast.success('Test xabar Telegramingizga yuborildi');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (errs.length) {
      toast.error(errs[0]);
      return;
    }
    const hits = honestyHits(text);
    const ok = await confirm({
      title: mode === 'now' ? 'Darhol yuborish' : 'Rejaga qo\'yish',
      message: (
        <>
          «{SEGMENT_LABEL[segment]}» segmentiga {mode === 'now' ? 'hozir yuboriladi' : `${fmtDateTime(sendIso)} da yuboriladi`}. «Xabarlarni to'xtatish» bosgan va bloklagan lidlarga bormaydi.
          {hits.length > 0 && <div className="box box-danger" style={{ marginTop: 10 }}>Matnda {hits.map((h) => `«${h}»`).join(', ')} bor — halollik qoidasini tekshiring.</div>}
        </>
      ),
      confirmText: mode === 'now' ? 'Yuborish' : 'Rejaga qo\'yish',
    });
    if (!ok) return;
    setBusy('send');
    try {
      const b = await api.createBroadcast(fid, { segment, ...payload(), send_at: sendIso });
      list.setData((l) => [b, ...(l ?? [])]);
      toast.success(mode === 'now' ? `Yuborish boshlandi · ${num(b.recipients)} ta lid` : 'Rejaga qo\'yildi');
      setText('');
      setButtons([]);
      setMedia(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const past = [...(list.data ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return (
    <>
      <div className="cols">
        <Card className="col-3" title="Yangi xabar">
          <label className="field">
            <span>Segment</span>
            <select className="select" value={segment} onChange={(e) => setSegment(e.target.value as Segment | 'cold')}>
              {/* Video segmentlari kun/daqiqa talab qiladi — ommaviy xabarda ishlatilmaydi */}
              {options(SEGMENT_LABEL).filter((o) => !isWatchSegment(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <TextEditor id="bc-text" label="Matn" value={text} onChange={setText} limit={limit} limitHint={media ? 'media izohi' : undefined} rows={6} />
          <div className="stack-sm">
            <div className="field"><span>Media (ixtiyoriy)</span></div>
            {media ? (
              <div className="media-item">
                {media.kind === 'photo' && media.url ? <img src={media.url} alt="" className="media-thumb" /> : <span className="media-thumb media-thumb-ph">{media.kind}</span>}
                <span className="media-name">{media.filename} · {fileSize(media.size)}</span>
                <button type="button" className="icon-btn" aria-label="Mediani olib tashlash" onClick={() => setMedia(null)}>×</button>
              </div>
            ) : (
              <label className="btn btn-sm file-btn" htmlFor="bc-file">
                {uploading ? 'Yuklanmoqda…' : '+ Media yuklash'}
                <input id="bc-file" type="file" className="visually-hidden" disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} />
              </label>
            )}
          </div>
          <div className="stack-sm">
            <div className="field"><span>Tugmalar</span></div>
            <ButtonsEditor value={buttons} onChange={setButtons} idPrefix="bc-btn" />
          </div>
          <div className="stack-sm">
            <div className="field"><span>Qachon</span></div>
            <Segmented label="Yuborish vaqti" value={mode} onChange={setMode} options={[{ value: 'now', label: 'Darhol' }, { value: 'later', label: 'Rejali' }]} />
            {mode === 'later' && (
              <label className="field" style={{ maxWidth: 280 }}><span>Yuborish vaqti (Toshkent)</span><input className="input" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} /></label>
            )}
          </div>
          {errs.length > 0 && text && <div className="small text-danger">{errs[0]}</div>}
          <div className="form-actions">
            <button type="button" className="btn" disabled={!!busy || !text.trim() || !!btnErr} onClick={() => void test()}>{busy === 'test' ? 'Yuborilmoqda…' : 'Test yuborish'}</button>
            <button type="button" className="btn btn-accent" disabled={!!busy || errs.length > 0} onClick={() => void send()}>{busy === 'send' ? 'Kuting…' : mode === 'now' ? 'Yuborish' : "Rejaga qo'yish"}</button>
          </div>
        </Card>
        <div className="col-2 stack-sm" style={{ position: 'sticky', top: 16 }}>
          <div className="field"><span>Telegram'dagi ko'rinishi</span></div>
          <TelegramPreview kind={media ? (media.kind === 'video_note' ? 'video' : media.kind) : 'text'} text={text} buttons={buttons} media={media ? [media] : []} />
        </div>
      </div>

      <Card title="Yuborilgan va rejadagi xabarlar">
        {list.error && !list.data ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : past.length === 0 ? (
          <Empty title="Hali ommaviy xabar yuborilmagan" />
        ) : (
          <div className="table-wrap flat">
            <table className="table">
              <thead><tr><th>Yaratilgan</th><th>Segment</th><th>Matn</th><th>Yuborish</th><th className="num">Qabul qiluvchi</th><th>Holat</th></tr></thead>
              <tbody>
                {past.map((b) => (
                  <tr key={b.id}>
                    <td className="nowrap muted">{fmtDateTime(b.created_at)}</td>
                    <td className="nowrap">{SEGMENT_LABEL[b.segment]}</td>
                    <td style={{ minWidth: 220 }}><span className="clamp-2">{b.text.replace(/<[^>]+>/g, '')}</span></td>
                    <td className="nowrap">{b.send_at ? fmtDateTime(b.send_at) : 'darhol'}</td>
                    <td className="num">{num(b.recipients)}</td>
                    <td><Badge tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function Broadcasts() {
  return (
    <>
      <PageHead title="Ommaviy xabar" sub="Segmentga bir martalik xabar: darhol yoki belgilangan vaqtda. Sovuq lidlar faqat shu orqali xabar oladi." />
      <NeedFunnel>{(f) => <BroadcastsBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
