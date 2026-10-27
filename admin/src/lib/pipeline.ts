import type { LeadStep, PipelineStage } from '../api/types';
import type { Tone } from '../components/ui';

/** Sotuv doskasi ustunlari (backend domain/pipeline.STAGES bilan bir xil tartib). */
export const STAGES: { key: PipelineStage; label: string; color: string }[] = [
  { key: 'new', label: 'Yangi', color: '#2D5B8A' },
  { key: 'contacted', label: "Bog'lanildi", color: '#B8892A' },
  { key: 'callback', label: "Qayta qo'ng'iroq", color: '#C9702B' },
  { key: 'waiting_payment', label: "To'lov kutilmoqda", color: '#6E54A8' },
  { key: 'won', label: 'Sotildi', color: '#23703F' },
  { key: 'lost', label: 'Rad etdi', color: '#B3261E' },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<PipelineStage, string>;
export const STAGE_COLOR = Object.fromEntries(STAGES.map((s) => [s.key, s.color])) as Record<PipelineStage, string>;

/** Avtovoronka qadamining rangi: issiq lidlar sariq, to'laganlar yashil, o'tkazib yuborganlar qizil. */
export function stepTone(step: LeadStep): Tone {
  switch (step) {
    case 'deposit_paid':
    case 'full_paid':
      return 'success';
    case 'reached_offer':
    case 'clicked_buy':
    case 'receipt_sent':
      return 'warn';
    case 'day1_missed':
    case 'day2_missed':
    case 'left_before_offer':
    case 'receipt_rejected':
    case 'cold':
      return 'danger';
    case 'day1_watched':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Ism bosh harflari (menejer belgisi uchun). */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
