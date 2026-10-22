/**
 * Telegram HTML (b, i, u, s, a, code, pre, tg-spoiler, blockquote) ni oldindan ko'rish uchun
 * xavfsiz HTML ga aylantiradi. Qolgan hamma narsa escape qilinadi.
 */
export const SAMPLE_VARS: Record<string, string> = {
  ism: 'Madina',
  efir_sanasi: '23-oktabr',
  efir_vaqti: '20:00',
  deadline: '26-oktabr, 21:00',
};
export const VARIABLES = ['{ism}', '{efir_sanasi}', '{efir_vaqti}', '{deadline}'];

const ALLOWED: Record<string, string> = {
  b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u', s: 's', strike: 's', del: 's',
  code: 'code', pre: 'pre', blockquote: 'blockquote', 'tg-spoiler': 'span',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function substituteVars(text: string, vars: Record<string, string> = SAMPLE_VARS): string {
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? vars[k] : all));
}

export function renderTelegramHtml(text: string, vars: Record<string, string> = SAMPLE_VARS): string {
  const src = substituteVars(text, vars);
  const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let out = '';
  let last = 0;
  for (const m of src.matchAll(tagRe)) {
    const idx = m.index ?? 0;
    out += esc(src.slice(last, idx));
    last = idx + m[0].length;
    const name = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    if (name === 'a') {
      if (closing) out += '</a>';
      else {
        const href = /href\s*=\s*["']([^"']*)["']/i.exec(m[2])?.[1] ?? '';
        const safe = /^(https?:|tg:)/i.test(href) ? href : '#';
        out += `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">`;
      }
      continue;
    }
    if (name === 'span' && /class\s*=\s*["']tg-spoiler["']/i.test(m[2]) && !closing) {
      out += '<span class="tg-spoiler">';
      continue;
    }
    if (name === 'span' && closing) {
      out += '</span>';
      continue;
    }
    const mapped = ALLOWED[name];
    if (!mapped) {
      out += esc(m[0]);
      continue;
    }
    if (closing) out += `</${mapped}>`;
    else out += mapped === 'span' ? '<span class="tg-spoiler">' : `<${mapped}>`;
  }
  out += esc(src.slice(last));
  return out.replace(/\n/g, '<br>');
}

/** Telegram hisoblaydigan ko'rinadigan belgilar soni (teglarsiz). */
export function visibleLength(text: string): number {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(lt|gt|amp|quot);/g, '_')
    .length;
}
