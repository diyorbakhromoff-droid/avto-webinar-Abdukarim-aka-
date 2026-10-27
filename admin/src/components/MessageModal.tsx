import { useState } from 'react';
import { api } from '../api/admin';
import type { ChainButton, MediaInfo } from '../api/types';
import { useFunnel } from '../lib/funnel';
import { useToast } from '../lib/toast';
import { visibleLength } from '../lib/telegramHtml';
import { ButtonsEditor, cleanButtons, validateButtons } from './ButtonsEditor';
import { Modal } from './Modal';
import { TelegramPreview } from './TelegramPreview';
import { TestSendModal } from './TestSendModal';
import { TextEditor } from './TextEditor';
import { fileSize } from '../lib/format';

/** Tanlangan lidlarga bot orqali xabar (POST /api/admin/leads/message). */
export function MessageModal({ open, leadIds, onClose, onSent }: { open: boolean; leadIds: number[]; onClose: () => void; onSent?: (queued: number) => void }) {
  const toast = useToast();
  const { funnel } = useFunnel();
  const [testOpen, setTestOpen] = useState(false);
  const [text, setText] = useState('');
  const [buttons, setButtons] = useState<ChainButton[][]>([]);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const limit = media ? 1024 : 4096;
  const btnErr = validateButtons(buttons);
  const tooLong = visibleLength(text) > limit;
  const canSend = !busy && text.trim().length > 0 && !btnErr && !tooLong && leadIds.length > 0;

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

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.messageLeads({ lead_ids: leadIds, text, buttons: cleanButtons(buttons), media_id: media?.id ?? null });
      toast.success(`${r.queued} ta xabar navbatga qo'yildi`);
      onSent?.(r.queued);
      setText('');
      setButtons([]);
      setMedia(null);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const kind = media ? (media.kind === 'video_note' ? 'video' : media.kind) : 'text';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Bot orqali xabar · ${leadIds.length} ta lid`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Bekor qilish</button>
          <button type="button" className="btn" disabled={!canSend} onClick={() => setTestOpen(true)}>🧪 Test</button>
          <button type="button" className="btn btn-accent" disabled={!canSend} onClick={() => void send()}>{busy ? 'Yuborilmoqda…' : 'Yuborish'}</button>
        </>
      }
    >
      <div className="split">
        <div className="stack">
          <TextEditor id="lead-msg" label="Matn" value={text} onChange={setText} limit={limit} limitHint={media ? 'media izohi' : undefined} rows={6} />
          <div className="stack-sm">
            <div className="field"><span>Media (ixtiyoriy)</span></div>
            {media ? (
              <div className="media-item">
                <span className="media-name">{media.filename} · {fileSize(media.size)}</span>
                <button type="button" className="icon-btn" aria-label="Mediani olib tashlash" onClick={() => setMedia(null)}>×</button>
              </div>
            ) : (
              <label className="btn btn-sm file-btn" htmlFor="lead-msg-file">
                {uploading ? 'Yuklanmoqda…' : '+ Media yuklash'}
                <input id="lead-msg-file" type="file" className="visually-hidden" disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} />
              </label>
            )}
          </div>
          <div className="stack-sm">
            <div className="field"><span>Tugmalar</span></div>
            <ButtonsEditor value={buttons} onChange={setButtons} idPrefix="lead-msg-btn" />
            {btnErr && buttons.length > 0 && <div className="small text-danger">{btnErr}</div>}
          </div>
          <div className="muted small">«Xabarlarni to'xtatish» bosgan va botni bloklagan lidlarga xabar yuborilmaydi.</div>
        </div>
        <div className="stack-sm">
          <div className="field"><span>Telegram'dagi ko'rinishi</span></div>
          <TelegramPreview kind={kind} text={text} buttons={buttons} media={media ? [media] : []} />
        </div>
      </div>
      <TestSendModal open={testOpen} title="Lidga xabar" onClose={() => setTestOpen(false)}
        send={(r) => api.testBroadcast({ text, buttons: cleanButtons(buttons), media_id: media?.id ?? null, funnel_id: funnel?.id, ...r, lead_id: r.lead_id ?? (leadIds.length === 1 ? leadIds[0] : null) })} />
    </Modal>
  );
}
