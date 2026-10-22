import type {
  ButtonType, CallListKey, ChainKind, ContactResult, LeadStep, PaymentKind, PaymentMethod,
  PaymentStatus, Role, Segment, StuckStep, TriggerType,
} from '../api/types';

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  content: 'Kontent menejer',
  sales: 'Sotuv menejeri',
};

export const KIND_LABEL: Record<ChainKind, string> = {
  text: 'Matn',
  photo: 'Rasm + matn',
  video: 'Video + matn',
  video_note: 'Video-doira',
  voice: 'Ovozli xabar',
  audio: 'Audio',
  document: 'Fayl (PDF va h.k.)',
  album: 'Albom (2–10 media)',
};
export const KIND_SHORT: Record<ChainKind, string> = {
  text: 'matn', photo: 'rasm', video: 'video', video_note: 'video-doira', voice: 'ovozli',
  audio: 'audio', document: 'fayl', album: 'albom',
};

export const TRIGGER_LABEL: Record<TriggerType, string> = {
  after_registration: "Ro'yxatdan X keyin",
  before_day: 'Kundan X oldin',
  at_day_start: 'Kun boshlanishida (+X)',
  after_day_end: 'Kun tugaganidan X keyin',
  on_button: 'Tugma bosilganda',
  stuck: "Qadamda X vaqt to'xtab qolganda",
};

export const SEGMENT_LABEL: Record<Segment | 'cold', string> = {
  all: 'Hammaga',
  day1_attended: '1-kunga kelganlar',
  day1_missed: '1-kunga kelmaganlar',
  day2_attended: '2-kunga kelganlar',
  day2_missed: '2-kunga kelmaganlar',
  reached_offer: "Oferta momentigacha ko'rganlar",
  left_before_offer: 'Ofertagacha chiqib ketganlar',
  receipt_sent: 'Chek yuborganlar',
  deposit_paid: "Boshlang'ich to'laganlar",
  full_paid: "To'liq to'laganlar",
  not_paid: "To'lamaganlar",
  cold: 'Sovuq lidlar',
};
export const SEGMENT_SHORT: Record<Segment | 'cold', string> = {
  all: 'hammaga',
  day1_attended: "≥75% ko'rganlar",
  day1_missed: "ko'rmaganlar",
  day2_attended: '2-kunga kelganlar',
  day2_missed: '2-kunni ko\'rmaganlar',
  reached_offer: 'ofertagacha ko\'rganlar',
  left_before_offer: 'ofertagacha chiqqanlar',
  receipt_sent: 'chek yuborganlar',
  deposit_paid: "boshlang'ich to'laganlar",
  full_paid: "to'liq to'laganlar",
  not_paid: "to'lamaganlar",
  cold: 'sovuq lidlar',
};

export const STUCK_LABEL: Record<StuckStep, string> = {
  no_phone: 'Telefon bermadi',
  no_session: 'Sessiya tanlamadi',
  no_receipt: 'Tugma bosdi, chek yubormadi',
  receipt_rejected: 'Chek rad etildi',
};

export const BUTTON_TYPE_LABEL: Record<ButtonType, string> = {
  url: 'Havola (URL)',
  webapp: 'Efirga kirish (Mini App)',
  reschedule: "Vaqtni o'zgartirish",
  pay: "To'lov / kursga yozilish",
};
export const BUTTON_DEFAULT_TEXT: Record<ButtonType, string> = {
  url: 'Batafsil',
  webapp: 'Efirga kirish',
  reschedule: "Vaqtni o'zgartirish",
  pay: 'Kursga yozilish',
};

export const STEP_LABEL: Record<LeadStep, string> = {
  started: '/start bosdi',
  phone: 'Telefon berdi',
  session: 'Sessiya tanladi',
  day1_missed: "1-kunni ko'rmadi",
  day1_watched: "1-kunni ko'rdi",
  day2_missed: "2-kunni ko'rmadi",
  left_before_offer: 'Ofertagacha chiqdi',
  reached_offer: 'Ofertani ko\'rdi',
  clicked_buy: 'Tugma bosdi',
  receipt_sent: 'Chek yubordi',
  receipt_rejected: 'Chek rad etildi',
  deposit_paid: "Boshlang'ich to'ladi",
  full_paid: "To'liq to'ladi",
  cold: 'Sovuq',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  none: "yo'q",
  deposit: "boshlang'ich",
  full: "to'liq",
};
export const PAYMENT_STATUS_LONG: Record<PaymentStatus, string> = {
  none: "To'lov yo'q",
  deposit: "Boshlang'ich to'lagan",
  full: "To'liq to'lagan",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Karta o'tkazma",
  payme: 'Payme',
  click: 'Click',
};
export const METHOD_SHORT: Record<PaymentMethod, string> = { card: 'Karta', payme: 'Payme', click: 'Click' };

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  deposit: "Boshlang'ich",
  full: "To'liq",
  remaining: "Qolgan to'lov",
};

export const RECEIPT_LABEL: Record<'none' | 'pending' | 'approved' | 'rejected', string> = {
  none: '—',
  pending: 'kutilmoqda',
  approved: 'tasdiqlangan',
  rejected: 'rad etilgan',
};

export const CONTACT_LABEL: Record<ContactResult, string> = {
  no_answer: 'Javob bermadi',
  callback: "Qayta qo'ng'iroq",
  sold: 'Sotildi',
  refused: 'Rad etdi',
};

export const CALL_LIST_FALLBACK: Record<CallListKey, string> = {
  deposit_paid: "Boshlang'ich to'laganlar",
  full_paid: "To'liq to'laganlar",
  offer_not_paid: "Ofertani ko'rgan, to'lamagan",
  clicked_no_receipt: 'Tugma bosgan, chek yubormagan',
  receipt_rejected: 'Chek rad etilgan',
  no_session: 'Sessiya tanlamagan',
  day1_missed: "1-kunni ko'rmagan",
  day2_missed: "2-kunni ko'rmagan",
  left_before_offer: 'Ofertagacha chiqib ketgan',
  cold: 'Sovuq lidlar',
  blocked: 'Botni bloklagan',
};

export function options<K extends string>(rec: Record<K, string>): { value: K; label: string }[] {
  return (Object.keys(rec) as K[]).map((value) => ({ value, label: rec[value] }));
}
