import { downloadFile, http, requestBlob, type Query } from './client';
import type {
  AdSpendRow, AdminUser, AuditRow, Broadcast, BroadcastInput, CallList, CallListKey, ChainButton,
  ChainHistoryEntry, ChatRow, ChatSession, ChatStatusFilter, ChainMessage, ChainMessageInput, CommentInput, CommentRow, ContactInput,
  DashboardPeriod, DashboardResponse, DeeplinkResponse, FailedMessage, Funnel, FunnelSettings,
  GlobalSettings, LeadCard, LeadMessageInput, LeadStep, LeadsPage, LiveResults, LoginResponse,
  MediaInfo, PaymentKind, PaymentMethod, PaymentRow, PaymentsStatusFilter, QuestionRow, Requisites,
  SettingsSaveResponse, SimulationRow, StatsResponse, TariffAdmin, UserInput, WatchStats,
} from './types';

export interface LeadsFilter {
  list?: CallListKey | '';
  step?: LeadStep | '';
  source?: string;
  manager_id?: number | '';
  q?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export interface StatsFilter {
  date_from?: string;
  date_to?: string;
  source?: string;
  slot?: string;
  weekday?: number | '';
  method?: PaymentMethod | '';
  manager_id?: number | '';
}

/** GET /funnels/{id}/watch-stats filtrlari (Statistika sahifasidagi sana/manba/slot bilan bir xil). */
export interface WatchStatsFilter {
  day: 1 | 2;
  step: number;
  date_from?: string;
  date_to?: string;
  source?: string;
  slot?: string;
}

export interface ChatFilter {
  date?: string;
  day?: 1 | 2 | '';
  status?: ChatStatusFilter;
  /** bitta efir: shu kun efirining boshlanish vaqti (ISO) */
  session_at?: string;
}

export interface ReceiptUpload {
  file: File;
  tariff_id: number;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number;
}

const q = (o: object): Query => o as Query;

export const api = {
  // ── Auth / foydalanuvchilar ──
  login: (login: string, password: string) => http.post<LoginResponse>('/admin/auth/login', { login, password }),
  me: () => http.get<AdminUser>('/admin/me'),
  users: () => http.get<AdminUser[]>('/admin/users'),
  managers: () => http.get<{ id: number; name: string }[]>('/admin/managers'),
  media: (id: number) => http.get<MediaInfo>(`/admin/media/${id}`),
  createUser: (body: UserInput) => http.post<AdminUser>('/admin/users', body),
  updateUser: (id: number, body: UserInput) => http.put<AdminUser>(`/admin/users/${id}`, body),

  // ── Voronkalar ──
  funnels: () => http.get<Funnel[]>('/admin/funnels'),
  createFunnel: (body: { slug: string; name: string }) => http.post<Funnel>('/admin/funnels', body),
  copyFunnel: (id: number, body: { slug: string; name: string }) => http.post<Funnel>(`/admin/funnels/${id}/copy`, body),
  deeplink: (id: number, source: string) => http.get<DeeplinkResponse>(`/admin/funnels/${id}/deeplink`, { source }),
  settings: (fid: number) => http.get<FunnelSettings>(`/admin/funnels/${fid}/settings`),
  saveSettings: (fid: number, s: FunnelSettings) => http.put<SettingsSaveResponse>(`/admin/funnels/${fid}/settings`, s),
  requisites: (fid: number) => http.get<Requisites>(`/admin/funnels/${fid}/requisites`),
  saveRequisites: (fid: number, r: Requisites) => http.put<Requisites>(`/admin/funnels/${fid}/requisites`, r),

  // ── Tariflar ──
  tariffs: (fid: number) => http.get<TariffAdmin[]>(`/admin/funnels/${fid}/tariffs`),
  createTariff: (fid: number, t: Omit<TariffAdmin, 'id'>) => http.post<TariffAdmin>(`/admin/funnels/${fid}/tariffs`, t),
  updateTariff: (t: TariffAdmin) => http.put<TariffAdmin>(`/admin/tariffs/${t.id}`, t),
  deleteTariff: (id: number) => http.del(`/admin/tariffs/${id}`),

  // ── Progrev zanjiri ──
  chain: (fid: number) => http.get<ChainMessage[]>(`/admin/funnels/${fid}/chain`),
  createChain: (fid: number, m: ChainMessageInput) => http.post<ChainMessage>(`/admin/funnels/${fid}/chain`, m),
  updateChain: (id: number, m: ChainMessageInput) => http.put<ChainMessage>(`/admin/chain/${id}`, m),
  deleteChain: (id: number) => http.del(`/admin/chain/${id}`),
  duplicateChain: (id: number) => http.post<ChainMessage>(`/admin/chain/${id}/duplicate`),
  testChain: (id: number) => http.post<{ ok: true }>(`/admin/chain/${id}/test`),
  chainHistory: (id: number) => http.get<ChainHistoryEntry[]>(`/admin/chain/${id}/history`),
  simulate: (fid: number, body: { registered_at: string; day1_at: string }) =>
    http.post<SimulationRow[]>(`/admin/funnels/${fid}/chain/simulate`, body),

  // ── Media ──
  uploadMedia: (file: File) => {
    const f = new FormData();
    f.append('file', file);
    return http.upload<MediaInfo>('/admin/media', f);
  },

  // ── Izohlar ──
  comments: (fid: number, day: 1 | 2) => http.get<CommentRow[]>(`/admin/funnels/${fid}/comments`, { day }),
  addComment: (fid: number, c: CommentInput) => http.post<CommentRow>(`/admin/funnels/${fid}/comments`, c),
  deleteComment: (id: number) => http.del(`/admin/comments/${id}`),
  importComments: (fid: number, day: 1 | 2, file: File) => {
    const f = new FormData();
    f.append('file', file);
    f.append('day', String(day));
    return http.upload<{ imported: number }>(`/admin/funnels/${fid}/comments/import`, f);
  },

  // ── Lidlar ──
  callLists: (fid: number) => http.get<CallList[]>('/admin/call-lists', { funnel_id: fid }),
  leads: (fid: number, f: LeadsFilter) => http.get<LeadsPage>('/admin/leads', q({ funnel_id: fid, ...f })),
  exportLeads: (fid: number, f: LeadsFilter) =>
    downloadFile('/admin/leads/export.xlsx', q({ funnel_id: fid, ...f, page: undefined, page_size: undefined }), 'lidlar.xlsx'),
  lead: (id: number) => http.get<LeadCard>(`/admin/leads/${id}`),
  contact: (id: number, body: ContactInput) => http.post<unknown>(`/admin/leads/${id}/contact`, body),
  assign: (id: number, manager_id: number | null) => http.post<unknown>(`/admin/leads/${id}/assign`, { manager_id }),
  setDeadline: (id: number, deadline_at: string) => http.post<unknown>(`/admin/leads/${id}/deadline`, { deadline_at }),
  paymentPlan: (id: number, body: { remaining_amount: number | null; remaining_due_date: string | null }) =>
    http.post<unknown>(`/admin/leads/${id}/payment-plan`, body),
  sendInvite: (id: number) => http.post<unknown>(`/admin/leads/${id}/send-invite`),
  uploadReceipt: (id: number, r: ReceiptUpload) => {
    const f = new FormData();
    f.append('file', r.file);
    f.append('tariff_id', String(r.tariff_id));
    f.append('kind', r.kind);
    f.append('method', r.method);
    f.append('amount', String(r.amount));
    return http.upload<PaymentRow>(`/admin/leads/${id}/receipt`, f);
  },
  messageLeads: (body: LeadMessageInput) => http.post<{ queued: number }>('/admin/leads/message', body),

  // ── To'lovlar ──
  payments: (fid: number, status: PaymentsStatusFilter) => http.get<PaymentRow[]>('/admin/payments', { funnel_id: fid, status }),
  approvePayment: (id: number) => http.post<PaymentRow>(`/admin/payments/${id}/approve`),
  rejectPayment: (id: number, reason: string) => http.post<PaymentRow>(`/admin/payments/${id}/reject`, { reason }),
  refundPayment: (id: number) => http.post<PaymentRow>(`/admin/payments/${id}/refund`),
  receiptBlob: (fileUrl: string) => requestBlob(fileUrl),

  // ── Savollar ──
  questions: (fid: number, answered: boolean) => http.get<QuestionRow[]>('/admin/questions', { funnel_id: fid, answered }),
  answer: (id: number, text: string) => http.post<unknown>(`/admin/questions/${id}/answer`, { text }),

  // ── Efir chati (barcha rollar) ──
  chat: (fid: number, f: ChatFilter) => http.get<ChatRow[]>('/admin/chat', q({ funnel_id: fid, ...f })),
  chatSessions: (fid: number) => http.get<ChatSession[]>('/admin/chat/sessions', { funnel_id: fid }),
  chatReply: (id: number, text: string) => http.post<ChatRow>(`/admin/chat/${id}/reply`, { text }),

  // ── Ommaviy xabar ──
  broadcasts: (fid: number) => http.get<Broadcast[]>(`/admin/funnels/${fid}/broadcasts`),
  createBroadcast: (fid: number, b: BroadcastInput) => http.post<Broadcast>(`/admin/funnels/${fid}/broadcasts`, b),
  testBroadcast: (b: { text: string; buttons: ChainButton[][]; media_id: number | null }) =>
    http.post<{ ok: true }>('/admin/broadcasts/test', b),

  // ── Dashboard / statistika ──
  dashboard: (fid: number, period: DashboardPeriod) => http.get<DashboardResponse>('/admin/dashboard', { funnel_id: fid, period }),
  stats: (fid: number, f: StatsFilter) => http.get<StatsResponse>('/admin/stats', q({ funnel_id: fid, ...f })),
  exportStats: (fid: number, f: StatsFilter) => downloadFile('/admin/stats/export.xlsx', q({ funnel_id: fid, ...f }), 'statistika.xlsx'),
  watchStats: (fid: number, f: WatchStatsFilter) => http.get<WatchStats>(`/admin/funnels/${fid}/watch-stats`, q(f)),
  adSpend: (fid: number) => http.get<AdSpendRow[]>(`/admin/funnels/${fid}/ad-spend`),
  addAdSpend: (fid: number, row: AdSpendRow) => http.post<AdSpendRow>(`/admin/funnels/${fid}/ad-spend`, row),
  liveResults: (fid: number) => http.get<LiveResults>(`/admin/funnels/${fid}/live-results`),
  saveLiveResults: (fid: number, r: LiveResults) => http.put<LiveResults>(`/admin/funnels/${fid}/live-results`, r),

  // ── Sozlamalar ──
  globalSettings: () => http.get<GlobalSettings>('/admin/settings'),
  saveGlobalSettings: (s: GlobalSettings) => http.put<GlobalSettings>('/admin/settings', s),
  audit: () => http.get<AuditRow[]>('/admin/audit'),
  failedMessages: () => http.get<FailedMessage[]>('/admin/failed-messages'),
};
