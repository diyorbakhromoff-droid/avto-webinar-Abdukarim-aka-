import { NeedFunnel } from '../components/NeedFunnel';
import { SaveBar } from '../components/SaveBar';
import { StringListEditor, TimecodeInput } from '../components/fields';
import { Card, ErrorBox, Loading, PageHead, Warnings } from '../components/ui';
import { timecode } from '../lib/format';
import { useSettingsForm } from '../lib/useSettings';

function VideoBody({ fid }: { fid: number }) {
  const form = useSettingsForm(fid);
  const d = form.draft;
  if (form.state.error && !d) return <ErrorBox error={form.state.error} onRetry={form.state.reload} />;
  if (!d) return <Loading />;

  const local: string[] = [];
  if (!d.day1_video_id.trim()) local.push('1-kun video ID kiritilmagan.');
  if (!d.day2_video_id.trim()) local.push('2-kun video ID kiritilmagan.');
  if (d.day2_offer_sec >= d.day2_duration_sec && d.day2_duration_sec > 0) local.push('2-kun oferta timecode video davomiyligidan katta.');
  if (d.day1_soft_offer_sec !== null && d.day1_soft_offer_sec >= d.day1_duration_sec && d.day1_duration_sec > 0) local.push('1-kun yumshoq taklif vaqti video davomiyligidan katta.');
  if (d.day1_duration_sec > 0 && d.late_entry_minutes * 60 > d.day1_duration_sec * 0.25) {
    local.push(`Kech kirish (L = ${d.late_entry_minutes} daq) 1-kun videosining 25% idan (${Math.floor((d.day1_duration_sec * 0.25) / 60)} daq) oshib ketgan — kech kirgan lid 75% ga yeta olmaydi.`);
  }
  const invalid = d.day1_duration_sec <= 0 || d.day2_duration_sec <= 0;

  return (
    <>
      <div className="cols">
        <div className="col-1">
          <Card title="1-kun videosi">
            <label className="field">
              <span>Video ID (Bunny Stream)</span>
              <input className="input mono" value={d.day1_video_id} onChange={(e) => form.patch({ day1_video_id: e.target.value.trim() })} placeholder="a1b2c3d4-…" />
            </label>
            <label className="field">
              <span>Davomiylik <span className="field-hint">— mm:ss yoki daqiqa</span></span>
              <TimecodeInput value={d.day1_duration_sec} required onChange={(s) => form.patch({ day1_duration_sec: s ?? 0 })} placeholder="74:30" />
            </label>
            <label className="check">
              <input type="checkbox" checked={d.day1_soft_offer_sec !== null} onChange={(e) => form.patch({ day1_soft_offer_sec: e.target.checked ? Math.min(3600, Math.max(0, d.day1_duration_sec - 600)) : null })} />
              1-kunda yumshoq taklif (masalan, erta yozilish bonusi)
            </label>
            {d.day1_soft_offer_sec !== null && (
              <label className="field">
                <span>Yumshoq taklif timecode <span className="field-hint">— mm:ss</span></span>
                <TimecodeInput value={d.day1_soft_offer_sec} onChange={(s) => form.patch({ day1_soft_offer_sec: s })} />
              </label>
            )}
          </Card>
        </div>
        <div className="col-1">
          <Card title="2-kun videosi">
            <label className="field">
              <span>Video ID (Bunny Stream)</span>
              <input className="input mono" value={d.day2_video_id} onChange={(e) => form.patch({ day2_video_id: e.target.value.trim() })} placeholder="e5f6g7h8-…" />
            </label>
            <label className="field">
              <span>Davomiylik <span className="field-hint">— mm:ss yoki daqiqa</span></span>
              <TimecodeInput value={d.day2_duration_sec} required onChange={(s) => form.patch({ day2_duration_sec: s ?? 0 })} placeholder="82:00" />
            </label>
            <label className="field">
              <span>Oferta timecode <span className="field-hint">— shu soniyada sotuv tugmasi chiqadi</span></span>
              <TimecodeInput value={d.day2_offer_sec} required onChange={(s) => form.patch({ day2_offer_sec: s ?? 0 })} placeholder="58:00" />
            </label>
            {d.day2_duration_sec > 0 && (
              <div className="watch">
                <div className="watch-track" aria-hidden="true">
                  <div className="watch-bar" style={{ width: '100%', background: 'var(--track)' }} />
                  <div className="watch-marker" style={{ left: `${Math.min(100, (d.day2_offer_sec / d.day2_duration_sec) * 100)}%` }} />
                </div>
                <div className="small muted">Oferta {timecode(d.day2_offer_sec)} da — videoning {Math.round((d.day2_offer_sec / d.day2_duration_sec) * 100)}% i</div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title="Kunlar orasidagi xulosa">
        <div className="muted">Mini App'da «1-kun yakunlandi» ekranida ko'rinadi (faqat 1-kunni ≥{Math.round(d.day1_watch_threshold * 100)}% ko'rganlarga).</div>
        <StringListEditor label="Xulosa" value={d.between_summary} onChange={(v) => form.patch({ between_summary: v })} placeholder="Arab alifbosining 28 harfi bilan tanishdik" addLabel="+ Band qo'shish" />
      </Card>

      {/* Tahrir paytida — mahalliy tekshiruv; saqlangandan keyin — server ogohlantirishlari */}
      <Warnings items={form.dirty || !form.warnings.length ? local : []} />
      <Warnings items={form.dirty ? [] : form.warnings} />
      <SaveBar dirty={form.dirty} saving={form.saving} disabled={invalid} onReset={form.reset} onSave={() => void form.save({ ...d, between_summary: d.between_summary.map((s) => s.trim()).filter(Boolean) })} />
    </>
  );
}

export default function Video() {
  return (
    <>
      <PageHead title="Webinar videosi" sub="1-kun va 2-kun videolari, davomiylik va oferta vaqti. Video Bunny Stream'ga yuklanadi, bu yerga uning ID si kiritiladi." />
      <NeedFunnel>{(f) => <VideoBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
