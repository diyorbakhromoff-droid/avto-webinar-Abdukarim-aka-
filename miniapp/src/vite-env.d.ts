/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" — backend o'rniga mahalliy fixture'lar (npm run dev:mock) */
  readonly VITE_MOCK?: string;
  /** API manzili prefiksi; bo'sh = shu domen (/api) */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
