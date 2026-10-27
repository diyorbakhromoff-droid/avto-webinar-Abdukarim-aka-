import { ApiError } from './errors';

export const IS_MOCK = import.meta.env.VITE_MOCK === '1';
const TOKEN_KEY = 'aw_admin_token';
const API_PREFIX = '/api';

export type Query = Record<string, string | number | boolean | null | undefined>;

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage yopiq bo'lishi mumkin */
  }
}

let unauthorizedHandler: (() => void) | null = null;
/** AuthProvider ro'yxatdan o'tkazadi: istalgan 401 da login sahifasiga qaytaradi. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith(API_PREFIX + '/')) return path;
  return API_PREFIX + (path.startsWith('/') ? path : `/${path}`);
}

function plainQuery(query?: Query): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = '';
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') detail = data.detail;
    else if (Array.isArray(data?.detail)) {
      // FastAPI validatsiya xatosi
      detail = data.detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join('; ');
    }
  } catch {
    /* JSON emas */
  }
  if (!detail) {
    detail =
      res.status === 401 ? 'Sessiya tugadi, qayta kiring' :
      res.status === 403 ? "Bu amal uchun ruxsat yo'q" :
      res.status === 404 ? 'Topilmadi' :
      res.status >= 500 ? 'Server xatosi. Birozdan keyin urinib ko\'ring' :
      `Xato (${res.status})`;
  }
  return new ApiError(res.status, detail);
}

function handle401(path: string, err: unknown): void {
  if (err instanceof ApiError && err.status === 401 && !path.includes('/auth/login')) {
    setToken(null);
    unauthorizedHandler?.();
  }
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  if (IS_MOCK) {
    const { mockRequest } = await import('./mock');
    try {
      return (await mockRequest(method, path, plainQuery(opts.query), opts.form ?? opts.body)) as T;
    } catch (e) {
      handle401(path, e);
      throw e;
    }
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(resolveUrl(path) + buildQuery(opts.query), { method, headers, body });
  if (!res.ok) {
    const err = await parseError(res);
    handle401(path, err);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Bearer token bilan faylni Blob sifatida oladi (chek rasmi, Excel). */
export async function requestBlob(path: string, query?: Query): Promise<Blob> {
  if (IS_MOCK) {
    const { mockBlob } = await import('./mock');
    return mockBlob(path, plainQuery(query));
  }
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(resolveUrl(path) + buildQuery(query), { headers });
  if (!res.ok) {
    const err = await parseError(res);
    handle401(path, err);
    throw err;
  }
  return res.blob();
}

/** Faylni yuklab olish: fetch → blob → vaqtinchalik <a download>. */
export async function downloadFile(path: string, query: Query | undefined, filename: string): Promise<void> {
  const blob = await requestBlob(path, query);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, { body: body ?? {}, query }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
};
