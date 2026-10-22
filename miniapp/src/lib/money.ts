/** Pul — butun son, so'mda. Ko'rsatish: "1 990 000 so'm" (uzilmaydigan ingichka bo'sh joy bilan). */

const THIN_NBSP = ' ';
const NBSP = ' ';

export function formatNumber(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
}

export function formatMoney(n: number): string {
  return `${formatNumber(n)}${NBSP}so'm`;
}
