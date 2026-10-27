import type { Role } from '../api/types';

export type SectionKey =
  | 'dashboard' | 'funnels' | 'video' | 'slots' | 'chain' | 'timing' | 'sales' | 'comments'
  | 'leads' | 'questions' | 'chat' | 'payments' | 'broadcasts' | 'stats' | 'settings';

export interface Section { key: SectionKey; path: string; label: string; roles: Role[] }

const ALL: Role[] = ['super_admin', 'content', 'sales'];
const CONTENT: Role[] = ['super_admin', 'content'];
const SALES: Role[] = ['super_admin', 'sales'];

export const SECTIONS: Section[] = [
  { key: 'dashboard', path: '/', label: 'Dashboard', roles: ALL },
  { key: 'funnels', path: '/funnels', label: 'Voronkalar', roles: CONTENT },
  { key: 'video', path: '/video', label: 'Webinar videosi', roles: CONTENT },
  { key: 'slots', path: '/slots', label: 'Slotlar', roles: CONTENT },
  { key: 'chain', path: '/chain', label: 'Progrev zanjiri', roles: CONTENT },
  { key: 'timing', path: '/timing', label: 'Xabarlar vaqti', roles: CONTENT },
  { key: 'sales', path: '/sales', label: 'Sotuv bloki', roles: CONTENT },
  { key: 'comments', path: '/comments', label: 'Izohlar', roles: CONTENT },
  { key: 'leads', path: '/leads', label: 'Lidlar', roles: SALES },
  { key: 'questions', path: '/questions', label: 'Savollar', roles: SALES },
  { key: 'chat', path: '/chat', label: 'Efir chati', roles: ALL },
  { key: 'payments', path: '/payments', label: "To'lovlar", roles: SALES },
  { key: 'broadcasts', path: '/broadcasts', label: 'Ommaviy xabar', roles: CONTENT },
  { key: 'stats', path: '/stats', label: 'Statistika', roles: ALL },
  { key: 'settings', path: '/settings', label: 'Sozlamalar', roles: ['super_admin'] },
];

export function canAccess(role: Role | undefined, key: SectionKey): boolean {
  if (!role) return false;
  return SECTIONS.find((s) => s.key === key)?.roles.includes(role) ?? false;
}
