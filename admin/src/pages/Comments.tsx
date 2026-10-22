import { useState, type FormEvent } from 'react';
import { api } from '../api/admin';
import { NeedFunnel } from '../components/NeedFunnel';
import { TimecodeInput } from '../components/fields';
import { Card, Empty, ErrorBox, Loading, PageHead, Segmented } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { timecode } from '../lib/format';
import { honestyHits } from '../lib/honesty';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

function CommentsBody({ fid }: { fid: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [day, setDay] = useState<1 | 2>(1);
  const st = useLoad(() => api.comments(fid, day), [fid, day]);
  const [row, setRow] = useState<{ t: number | null; author: string; text: string }>({ t: null, author: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const list = [...(st.data ?? [])].sort((a, b) => a.t - b.t);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (row.t === null || !row.author.trim() || !row.text.trim()) {
      toast.error('Timecode, ism va matnni kiriting');
      return;
    }
    setBusy(true);
    try {
      const c = await api.addComment(fid, { day, t: row.t, author: row.author.trim(), text: row.text.trim() });
      st.setData((l) => [...(l ?? []), c]);
      setRow({ t: row.t, author: '', text: '' });
      toast.success("Izoh qo'shildi");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, author: string) => {
    const ok = await confirm({ title: "Izohni o'chirish", message: `${author} izohi o'chiriladi.`, confirmText: "O'chirish", danger: true });
    if (!ok) return;
    try {
      await api.deleteComment(id);
      st.setData((l) => (l ?? []).filter((c) => c.id !== id));
    } catch (err) {
      toast.error(err);
    }
  };

  const doImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const r = await api.importComments(fid, day, file);
      toast.success(`${r.imported} ta izoh import qilindi`);
      setFile(null);
      void st.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Segmented label="Kun" value={day} onChange={setDay} options={[{ value: 1, label: '1-kun' }, { value: 2, label: '2-kun' }]} />
      <div className="box box-info">Faqat asl jonli efirdagi haqiqiy izohlarni kiriting — Mini App'da «Asl efir ishtirokchilarining izohlari» deb ko'rsatiladi. Yangi izoh yozib bo'lmaydi.</div>
      <div className="cols">
        <div className="col-3 stack">
          <Card title={`${day}-kun izohlari${st.data ? ` · ${list.length}` : ''}`}>
            {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : list.length === 0 ? (
              <Empty title="Izoh yo'q">Qo'lda qo'shing yoki CSV dan import qiling.</Empty>
            ) : (
              <div className="table-wrap flat">
                <table className="table">
                  <thead><tr><th>Vaqt</th><th>Ism</th><th>Matn</th><th></th></tr></thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id}>
                        <td className="tnum mono">{timecode(c.t)}</td>
                        <td className="cell-strong nowrap">{c.author}</td>
                        <td>{c.text}{honestyHits(c.text).length > 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>tekshiring</span>}</td>
                        <td className="num"><button type="button" className="icon-btn" aria-label={`${c.author} izohini o'chirish`} onClick={() => void remove(c.id, c.author)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="col-2 stack">
          <Card title="Izoh qo'shish">
            <form className="stack-sm" onSubmit={add}>
              <div className="grid-2">
                <label className="field"><span>Timecode (mm:ss)</span><TimecodeInput value={row.t} onChange={(t) => setRow({ ...row, t })} placeholder="12:30" /></label>
                <label className="field"><span>Ism</span><input className="input" value={row.author} onChange={(e) => setRow({ ...row, author: e.target.value })} placeholder="Nilufar" /></label>
              </div>
              <label className="field"><span>Matn</span><textarea className="textarea" rows={3} value={row.text} onChange={(e) => setRow({ ...row, text: e.target.value })} style={{ minHeight: 80 }} /></label>
              <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Kuting…' : "Qo'shish"}</button></div>
            </form>
          </Card>
          <Card title="CSV dan import">
            <div className="muted small">Format: <span className="mono">timecode,ism,matn</span> — har qatorda bitta izoh, masalan <span className="mono">12:30,Nilufar,Rahmat ustoz!</span>. {day}-kunga import qilinadi.</div>
            <label className="btn btn-sm file-btn" htmlFor="csv-file">
              {file ? file.name : 'CSV faylni tanlash'}
              <input id="csv-file" type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <div className="form-actions"><button type="button" className="btn btn-accent" disabled={!file || importing} onClick={() => void doImport()}>{importing ? 'Import qilinmoqda…' : 'Import qilish'}</button></div>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function Comments() {
  return (
    <>
      <PageHead title="Izohlar" sub="Asl efir izohlari videoga sinxron chiqadi." />
      <NeedFunnel>{(f) => <CommentsBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
