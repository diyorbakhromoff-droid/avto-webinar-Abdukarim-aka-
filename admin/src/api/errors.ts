export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** Toast va xato bloklari uchun foydalanuvchiga ko'rsatiladigan matn. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.detail || `Xato (${e.status})`;
  if (e instanceof Error) {
    if (e.name === 'TypeError') return "Server bilan aloqa yo'q. Internetni tekshiring.";
    return e.message;
  }
  return "Noma'lum xato";
}
