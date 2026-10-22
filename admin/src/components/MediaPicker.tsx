import { useEffect, useRef, useState } from 'react';
import { api } from '../api/admin';
import type { ChainKind, MediaInfo } from '../api/types';
import { fileSize } from '../lib/format';
import { useToast } from '../lib/toast';

const ACCEPT: Partial<Record<ChainKind, string>> = {
  photo: 'image/*',
  video: 'video/*',
  video_note: 'video/*',
  voice: 'audio/ogg,audio/*',
  audio: 'audio/*',
  document: '*/*',
  album: 'image/*,video/*',
};

export const KIND_HINT: Partial<Record<ChainKind, string>> = {
  photo: 'Rasm: 10 MB gacha.',
  video: "Video: 50 MB gacha (bot orqali yuborish chegarasi).",
  video_note: "Video-doira: kvadrat (1:1) va 60 soniyagacha bo'lishi shart.",
  voice: 'Ovozli xabar: OGG/Opus formatida.',
  audio: 'Audio: MP3/M4A, 50 MB gacha.',
  document: 'Fayl: 50 MB gacha (PDF, DOCX…).',
  album: 'Albom: 2 tadan 10 tagacha rasm/video.',
};

interface Props {
  kind: ChainKind;
  mediaIds: number[];
  onChange: (ids: number[]) => void;
  /** Yuklangan media ma'lumotlari (oldindan ko'rish uchun). */
  known: Record<number, MediaInfo>;
  onUploaded: (m: MediaInfo) => void;
  id?: string;
}

export function MediaPicker({ kind, mediaIds, onChange, known, onUploaded, id = 'media' }: Props) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const multi = kind === 'album';
  const max = multi ? 10 : 1;

  // saqlangan xabardagi media: nomi va turini serverdan olamiz
  useEffect(() => {
    for (const mid of mediaIds) {
      if (!known[mid]) void api.media(mid).then(onUploaded).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaIds.join(',')]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const ws: string[] = [];
    let ids = multi ? [...mediaIds] : [];
    try {
      for (const f of Array.from(files).slice(0, max - (multi ? ids.length : 0) || 1)) {
        const m = await api.uploadMedia(f);
        onUploaded(m);
        ws.push(...m.warnings.map((w) => `${m.filename}: ${w}`));
        ids = multi ? [...ids, m.id] : [m.id];
      }
      onChange(ids.slice(0, max));
      setWarnings(ws);
      toast.success('Media yuklandi');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="media-picker">
      <div className="field"><span>Media</span></div>
      {KIND_HINT[kind] && <div className="muted small">{KIND_HINT[kind]}</div>}
      {mediaIds.length > 0 && (
        <ul className="media-list">
          {mediaIds.map((mid) => {
            const m = known[mid];
            return (
              <li key={mid} className="media-item">
                {m?.kind === 'photo' && m.url ? <img src={m.url} alt="" className="media-thumb" /> : <span className="media-thumb media-thumb-ph">{m?.kind ?? 'media'}</span>}
                <span className="media-name">{m ? `${m.filename} · ${fileSize(m.size)}` : `Media #${mid}`}</span>
                <button type="button" className="icon-btn" aria-label="Mediani olib tashlash" onClick={() => onChange(mediaIds.filter((x) => x !== mid))}>×</button>
              </li>
            );
          })}
        </ul>
      )}
      {(multi ? mediaIds.length < max : true) && (
        <label className="btn btn-sm file-btn" htmlFor={`${id}-file`} aria-disabled={busy}>
          {busy ? 'Yuklanmoqda…' : mediaIds.length && !multi ? 'Almashtirish' : '+ Media yuklash'}
          <input id={`${id}-file`} ref={input} type="file" className="visually-hidden" accept={ACCEPT[kind]} multiple={multi} disabled={busy} onChange={(e) => void onFiles(e.target.files)} />
        </label>
      )}
      {multi && mediaIds.length > 0 && mediaIds.length < 2 && <div className="small text-danger">Albomda kamida 2 ta media bo'lishi kerak.</div>}
      {warnings.length > 0 && (
        <div className="box box-warn" role="alert">
          <ul className="plain-list">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
