import type {
  FlowAction, FlowAnchor, FlowCheck, FlowConfig, FlowEdge, FlowMessage, FlowNode, FlowNodeStats, FlowNodeType,
  FlowStartEvent, FlowTarget, FlowWaitEvent,
} from '../api/types';
import { offsetLabel } from './format';
import { offsetWords } from './chain';

// ─────────────────────────── nomlar ───────────────────────────

export const NODE_LABEL: Record<FlowNodeType, string> = {
  start: 'Boshlanish', message: 'Xabar', wait: 'Kutish', condition: 'Shart', action: 'Amal',
  goto: "O'tish", chain: 'Zanjir', stop: "To'xtatish", note: 'Izoh',
};

export const NODE_HINT: Record<FlowNodeType, string> = {
  start: 'Qaysi hodisada lid shu bo\'limga kiradi',
  message: 'Xabar va tugmalar — har bir tugmadan alohida yo\'l',
  wait: 'Vaqt yoki webinar vaqtiga bog\'lab kutish',
  condition: 'Video ko\'rish, to\'lov, adminga yozish… bo\'yicha ajratish',
  action: 'Yangi vaqt taklifi, teg, menejerga vazifa',
  goto: 'Boshqa bo\'limning istalgan blokiga yoki zanjirning N-xabariga',
  chain: 'O\'z vaqtiga bog\'langan xabarlar ketma-ketligi',
  stop: 'Yo\'l shu yerda tugaydi',
  note: 'Sxemaga izoh (bajarilmaydi)',
};

/** Chap paneldagi tartib. */
export const PALETTE: FlowNodeType[] = ['start', 'message', 'wait', 'condition', 'action', 'goto', 'chain', 'stop', 'note'];

export const START_EVENT_LABEL: Record<FlowStartEvent, string> = {
  start: 'Botga /start bosdi',
  phone: 'Telefon raqam berdi',
  session_chosen: 'Efir vaqtini tanladi',
  joined: 'Efirga kirdi',
  left_live: 'Efirdan chiqib ketdi',
  day_end: 'Efir kuni tugadi',
  reached_offer: "Ofertagacha ko'rdi",
  clicked_buy: '«Kursga yozilish»ni bosdi',
  receipt: 'Chek yubordi',
  payment_approved: "To'lov tasdiqlandi",
  payment_rejected: 'Chek rad etildi',
  question: 'Adminga yozdi',
};
export const DAY_EVENTS: ReadonlySet<string> = new Set(['joined', 'left_live', 'day_end']);

export const WAIT_EVENT_LABEL: Record<FlowWaitEvent, string> = {
  joined: 'Efirga kirguncha',
  question: 'Adminga yozguncha',
  receipt: 'Chek yuborguncha',
  clicked_buy: '«Kursga yozilish»ni bosguncha',
  payment_approved: "To'lov tasdiqlanguncha",
};

export const ANCHOR_LABEL: Record<FlowAnchor, string> = {
  day1_start: '1-kun boshlanishi',
  day1_end: '1-kun tugashi',
  day2_start: '2-kun boshlanishi',
  day2_end: '2-kun tugashi',
  offer: 'Oferta payti (2-kun)',
  deadline: 'Shaxsiy deadline',
};

export const CHECK_LABEL: Record<FlowCheck, string> = {
  watch: "Videoni qancha ko'rdi",
  joined: 'Efirga kirdimi',
  reached_offer: "Ofertagacha ko'rdimi",
  wrote_admin: 'Adminga yozdimi',
  clicked_buy: '«Kursga yozilish»ni bosdimi',
  receipt: 'Chek yubordimi',
  payment: "To'lov holati",
  tag: 'Tegi bormi',
  source: 'Reklama manbai',
};

export const ACTION_LABEL: Record<FlowAction, string> = {
  reschedule: 'Yangi efir vaqtini taklif qilish',
  ask: "Savolini so'rash",
  tag_add: "Teg qo'shish",
  tag_remove: 'Tegni olib tashlash',
  cold: "Sovuq lidlarga o'tkazish",
  manager_task: 'Menejerga vazifa',
};

const PAYMENT_PORT_LABEL: Record<string, string> = { none: "To'lamagan", deposit: "Boshlang'ich to'lagan", full: "To'liq to'lagan" };

// ─────────────────────────── tavsiflar ───────────────────────────

export function startLabel(c: FlowConfig): string {
  const ev = c.event as FlowStartEvent | undefined;
  if (!ev) return 'Hodisa tanlanmagan';
  return START_EVENT_LABEL[ev] + (DAY_EVENTS.has(ev) && c.day ? ` · ${c.day}-kun` : '');
}

export function waitLabel(c: FlowConfig): string {
  const m = c.minutes ?? 0;
  switch (c.mode) {
    case 'duration': return `${offsetWords(m)} kutadi`;
    case 'anchor': {
      const a = c.anchor ? ANCHOR_LABEL[c.anchor] : '—';
      if (!m) return `${a} vaqtigacha`;
      return `${a}dan ${offsetWords(m)} ${c.direction === 'before' ? 'oldin' : 'keyin'}`;
    }
    case 'clock': return `Soat ${c.clock ?? '—'} gacha`;
    case 'event': return `${c.event ? WAIT_EVENT_LABEL[c.event as FlowWaitEvent] : '—'}, ko'pi bilan ${offsetWords(c.max_minutes ?? 0)}`;
    default: return '—';
  }
}

export function conditionLabel(c: FlowConfig): string {
  switch (c.check) {
    case 'watch': return `${c.day ?? 1}-kun videosi`;
    case 'joined': return `${c.day ?? 1}-kun efiri`;
    case 'wrote_admin': return `oxirgi ${offsetWords(c.minutes ?? 120)} ichida`;
    case 'tag': return `teg: ${c.value || '—'}`;
    case 'source': return `manba: ${c.value || '—'}`;
    default: return '';
  }
}

export function actionLabel(c: FlowConfig): string {
  if (!c.action) return '—';
  if (c.action === 'tag_add' || c.action === 'tag_remove') return `${ACTION_LABEL[c.action]}: ${c.value || '—'}`;
  return ACTION_LABEL[c.action];
}

export function gotoLabel(c: FlowConfig, targets: Map<number, FlowTarget>): string {
  const t = c.target_node_id ? targets.get(c.target_node_id) : undefined;
  if (!t) return 'Qayerga — tanlanmagan';
  const item = t.type === 'chain' && (c.item ?? 0) > 0 ? `, ${(c.item ?? 0) + 1}-xabardan` : '';
  return `→ ${t.flow_name}: ${t.title}${item}`;
}

/** Zanjirdagi xabar vaqti (qisqa). "Ro'yxatdan keyin" turi zanjirda — "zanjirga kirgach". */
export function chainItemWhen(m: Pick<FlowMessage, 'trigger_type' | 'trigger_day' | 'offset_minutes'>): string {
  const o = m.offset_minutes;
  const d = m.trigger_day ?? 1;
  switch (m.trigger_type) {
    case 'after_registration': return o === 0 ? 'darhol' : `kirgach +${offsetLabel(o)}`;
    case 'before_day': return `${d}-kundan ${offsetLabel(o)} oldin`;
    case 'at_day_start': return o === 0 ? `${d}-kun boshida` : `${d}-kun +${offsetLabel(o)}`;
    case 'after_day_end': return o === 0 ? `${d}-kun tugagach` : `${d}-kun tugagach +${offsetLabel(o)}`;
    case 'before_deadline': return `deadline −${offsetLabel(o)}`;
    default: return '—';
  }
}

export function nodeSub(n: FlowNode, targets: Map<number, FlowTarget>): string {
  const c = n.config;
  switch (n.type) {
    case 'start': return startLabel(c);
    case 'wait': return waitLabel(c);
    case 'condition': return conditionLabel(c);
    case 'action': return actionLabel(c);
    case 'goto': return gotoLabel(c, targets);
    case 'chain': return `${n.messages.length} ta xabar · istalganiga ulash mumkin`;
    case 'stop': return c.tag ? `teg: ${c.tag}` : "Yo'l shu yerda tugaydi";
    default: return '';
  }
}

/** Xabar matnidan HTML teglarini olib, qisqa ko'rinish. */
export function plain(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

// ─────────────────────────── geometriya ───────────────────────────

export const NODE_W: Record<FlowNodeType, number> = {
  start: 220, message: 260, wait: 240, condition: 260, action: 240, goto: 250, chain: 280, stop: 220, note: 240,
};
const HEAD = 52;       // tur yorlig'i + nom
const SUB_TOP = 78;    // bir qatorli izohdan keyin qatorlar shu yerdan
export const INPUT_Y = 26;

export type RowTone = 'button' | 'link' | 'timeout' | 'branch' | 'yes' | 'no' | 'next' | 'item' | 'empty';
export interface Row { port: string | null; label: string; right?: string; tone: RowTone; y: number; h: number; item?: number }
export interface NodeLayout {
  w: number; h: number;
  rows: Row[];
  /** qatorga bog'lanmagan chiqish (blokning o'rtasida) */
  single: string | null;
  /** zanjir: har bir xabarga kirish nuqtasi */
  inputs: { item: number; y: number }[];
  hasInput: boolean;
}

function stack(rows: Omit<Row, 'y'>[], top: number, gap: number): { rows: Row[]; bottom: number } {
  let y = top;
  const out: Row[] = [];
  for (const r of rows) {
    out.push({ ...r, y });
    y += r.h + gap;
  }
  return { rows: out, bottom: rows.length ? y - gap : top };
}

export function layout(n: FlowNode): NodeLayout {
  const w = NODE_W[n.type];
  const c = n.config;
  const base: NodeLayout = { w, h: 80, rows: [], single: null, inputs: [], hasInput: n.type !== 'start' && n.type !== 'note' };
  switch (n.type) {
    case 'start':
    case 'action':
      return { ...base, single: 'next' };
    case 'goto':
    case 'stop':
      return base;
    case 'note':
      return { ...base, h: 120 };
    case 'wait': {
      if (c.mode !== 'event') return { ...base, single: 'next' };
      const s = stack([
        { port: 'done', label: "Bo'ldi", tone: 'yes', h: 28 },
        { port: 'expired', label: 'Vaqt tugadi', tone: 'timeout', h: 28 },
      ], SUB_TOP, 6);
      return { ...base, rows: s.rows, h: s.bottom + 12 };
    }
    case 'condition': {
      let rows: Omit<Row, 'y'>[];
      if (c.check === 'watch') {
        rows = (c.branches ?? []).map((b) => ({
          port: b.id, label: b.label, tone: 'branch' as const, h: 32,
          right: b.kind === 'not_joined' ? 'kirmagan' : `${b.from_min ?? 0}–${b.to_min ?? '…'} daq`,
        }));
        rows.push({ port: 'else', label: 'Boshqa holat', tone: 'branch', h: 28 });
      } else if (c.check === 'payment') {
        rows = ['none', 'deposit', 'full'].map((p) => ({ port: p, label: PAYMENT_PORT_LABEL[p], tone: 'branch' as const, h: 32 }));
      } else {
        rows = [{ port: 'yes', label: 'Ha', tone: 'yes', h: 32 }, { port: 'no', label: "Yo'q", tone: 'no', h: 32 }];
      }
      const s = stack(rows, SUB_TOP, 6);
      return { ...base, rows: s.rows, h: s.bottom + 12 };
    }
    case 'message': {
      const m = n.messages[0];
      const rows: Omit<Row, 'y'>[] = [];
      let hasNext = false;
      for (const row of m?.buttons ?? []) {
        for (const b of row) {
          if (b.type === 'next' && b.id) {
            hasNext = true;
            rows.push({ port: `b:${b.id}`, label: b.text, tone: 'button', h: 30 });
          } else {
            rows.push({ port: null, label: b.text, tone: 'link', h: 30, right: '↗' });
          }
        }
      }
      if (hasNext && c.timeout_minutes) rows.push({ port: 'timeout', label: `Bosmasa · ${offsetLabel(c.timeout_minutes)}`, tone: 'timeout', h: 26 });
      const s = stack(rows, HEAD + 44, 6);
      const h = rows.length ? s.bottom + 12 : HEAD + 52;
      return { ...base, rows: s.rows, h, single: hasNext ? null : 'next' };
    }
    case 'chain': {
      const items: Omit<Row, 'y'>[] = n.messages.map((m, i) => ({
        port: null, label: `${i + 1} · ${m.title}`, right: chainItemWhen(m), tone: 'item' as const, h: 28, item: i,
      }));
      if (!items.length) items.push({ port: null, label: "Xabar qo'shing", tone: 'empty', h: 28 });
      items.push({ port: 'next', label: 'Zanjir tugagach', tone: 'next', h: 26 });
      const s = stack(items, SUB_TOP, 4);
      return {
        ...base, rows: s.rows, h: s.bottom + 12,
        inputs: s.rows.filter((r) => r.item !== undefined).map((r) => ({ item: r.item!, y: r.y + r.h / 2 })),
      };
    }
  }
}

export function outPoint(n: FlowNode, l: NodeLayout, port: string): { x: number; y: number } | null {
  if (l.single === port) return { x: n.x + l.w, y: n.y + l.h / 2 };
  const r = l.rows.find((x) => x.port === port);
  return r ? { x: n.x + l.w, y: n.y + r.y + r.h / 2 } : null;
}

export function inPoint(n: FlowNode, l: NodeLayout, item: number): { x: number; y: number } {
  if (n.type === 'chain') {
    const i = l.inputs.find((x) => x.item === item) ?? l.inputs[0];
    if (i) return { x: n.x, y: n.y + i.y };
  }
  return { x: n.x, y: n.y + INPUT_Y };
}

/** Egri chiziq: chiqishdan o'ngga, kirishga chapdan. Orqaga qaytgan chiziq kengroq aylanadi. */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const forward = b.x - a.x;
  const dx = forward > 40 ? Math.max(40, forward / 2) : 90 + Math.min(200, Math.abs(forward) / 3);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function edgeTone(port: string): 'branch' | 'timeout' | 'plain' {
  if (port === 'timeout' || port === 'expired') return 'timeout';
  if (port.startsWith('b:') || port === 'next' || port === 'done') return 'plain';
  return 'branch';
}

/** Chiqish nomi (inspektor va ro'yxatlar uchun). */
export function portLabel(n: FlowNode, port: string): string {
  const l = layout(n);
  if (l.single === port) return n.type === 'chain' ? 'Zanjir tugagach' : 'Keyin';
  return l.rows.find((r) => r.port === port)?.label ?? port;
}

export function percent(stats: FlowNodeStats | undefined, port: string): string | null {
  if (!stats || !stats.entered) return null;
  const n = stats.ports[port] ?? 0;
  return `${Math.round((n * 100) / stats.entered)}%`;
}

/** Bloklar chegarasi (hammasini ko'rsatish uchun). */
export function bounds(nodes: FlowNode[]): { x: number; y: number; w: number; h: number } | null {
  if (!nodes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of nodes) {
    const l = layout(n);
    x1 = Math.min(x1, n.x);
    y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + l.w);
    y2 = Math.max(y2, n.y + l.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function edgeFrom(edges: FlowEdge[], nodeId: number, port: string): FlowEdge | undefined {
  return edges.find((e) => e.from_node_id === nodeId && e.from_port === port);
}

/** Boshqa blok tomonidan ulanishi mumkin bo'lgan bloklar (chiziq oxiri). */
export function canReceive(t: FlowNodeType): boolean {
  return t !== 'start' && t !== 'note';
}

/** Blok chiqishlari (backend flow_rules.ports bilan bir xil) — demo rejim uchun. */
export function portsOf(type: FlowNodeType, c: FlowConfig, buttons: { type: string; id?: string }[][] = []): string[] {
  switch (type) {
    case 'start': case 'action': case 'chain': return ['next'];
    case 'message': {
      const nb = buttons.flat().filter((b) => b.type === 'next' && b.id);
      return nb.length ? [...nb.map((b) => `b:${b.id}`), ...(c.timeout_minutes ? ['timeout'] : [])] : ['next'];
    }
    case 'wait': return c.mode === 'event' ? ['done', 'expired'] : ['next'];
    case 'condition':
      if (c.check === 'watch') return [...(c.branches ?? []).map((b) => b.id), 'else'];
      if (c.check === 'payment') return ['none', 'deposit', 'full'];
      return ['yes', 'no'];
    default: return [];
  }
}
