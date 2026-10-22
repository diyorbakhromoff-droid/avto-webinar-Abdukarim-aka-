/**
 * Halollik qoidasi (TZ §11): tizim matnlarida "jonli", "live", "hozir efirda" ishlatilmaydi.
 * Katta-kichik harf farqi yo'q; "jonli" qo'shimchalar bilan ham ("jonlida") ushlanadi.
 */
const WORD = /(?:^|[^\p{L}])(jonli\p{L}*|live(?!\p{L})|hozir\s+efirda)/giu;

export function honestyHits(text: string): string[] {
  const found = new Set<string>();
  const plain = text.replace(/<[^>]+>/g, ' ');
  for (const m of plain.matchAll(WORD)) found.add(m[1].toLowerCase().replace(/\s+/g, ' '));
  return [...found];
}
