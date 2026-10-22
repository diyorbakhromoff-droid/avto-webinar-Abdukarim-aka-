import { getInitData, IS_MOCK } from '../lib/telegram';
import { syncClock } from '../lib/time';
import type {
  AppStateResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  OkResponse,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Mini App ishlatadigan backend chaqiruvlari (shartnomadagi MINI APP bo'limi). */
export interface MiniApi {
  getState(): Promise<AppStateResponse>;
  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse>;
  question(text: string): Promise<OkResponse>;
  offerClick(tariffId: number | null): Promise<OkResponse>;
  reschedule(): Promise<OkResponse>;
}

const API_BASE = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const TIMEOUT_MS = 15_000;

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: {
        Authorization: `tma ${getInitData()}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : 'network error');
  } finally {
    window.clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown };
      if (typeof data.detail === 'string') detail = data.detail;
    } catch {
      /* JSON emas */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const httpApi: MiniApi = {
  getState: () => request<AppStateResponse>('GET', '/app/state'),
  heartbeat: (body) => request<HeartbeatResponse>('POST', '/app/heartbeat', body),
  question: (text) => request<OkResponse>('POST', '/app/question', { text }),
  offerClick: (tariff_id) => request<OkResponse>('POST', '/app/offer-click', { tariff_id }),
  reschedule: () => request<OkResponse>('POST', '/app/reschedule', {}),
};

let implPromise: Promise<MiniApi> | null = null;
function impl(): Promise<MiniApi> {
  if (!implPromise) {
    implPromise = IS_MOCK
      ? import('./mock').then((m) => m.mockApi)
      : Promise.resolve(httpApi);
  }
  return implPromise;
}

/** Holatni oladi va server soatiga moslashadi. */
export async function fetchState(): Promise<AppStateResponse> {
  const api = await impl();
  const t0 = Date.now();
  const data = await api.getState();
  syncClock(data.server_time, t0, Date.now());
  return data;
}

export async function sendHeartbeat(body: HeartbeatRequest): Promise<void> {
  const api = await impl();
  const t0 = Date.now();
  const res = await api.heartbeat(body);
  if (res && typeof res.server_time === 'string') syncClock(res.server_time, t0, Date.now());
}

export async function sendQuestion(text: string): Promise<void> {
  await (await impl()).question(text);
}

export async function sendOfferClick(tariffId: number | null): Promise<void> {
  await (await impl()).offerClick(tariffId);
}

export async function sendReschedule(): Promise<void> {
  await (await impl()).reschedule();
}
