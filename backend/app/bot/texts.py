"""Botning tizim matnlari. Progrev xabarlari admin paneldan tahrirlanadi."""

ASK_PHONE = ("Joyingizni band qilish uchun telefon raqamingizni yuboring — pastdagi "
             "«Raqamni yuborish» tugmasini bosing yoki raqamni +998 XX XXX XX XX ko'rinishida yozing.")
PHONE_BUTTON = "Raqamni yuborish"
BAD_PHONE = "Raqam noto'g'ri ko'rinishda. Iltimos, +998 90 123 45 67 ko'rinishida yozing."
PHONE_THANKS = "Rahmat!"
CHOOSE_DAY1 = ("1-kun efiri qachon sizga qulay? 2-kun aynan 24 soatdan keyin, xuddi shu vaqtda bo'ladi.")
CHOOSE_DAY2 = "2-kun efiri uchun qulay vaqtni tanlang:"
NO_SLOTS = "Hozircha bo'sh vaqt yo'q. Tez orada yangi vaqtlar qo'shiladi."
SLOT_GONE = "Bu vaqt endi mavjud emas, qaytadan tanlang."
LIMIT_REACHED = ("Qayta tanlash imkoniyatlari tugadi. Yangi webinarlar haqida xabar beramiz.")

MENU_MY = "Mening efirim"
MENU_ASK = "Savol berish"
MENU_STOP = "Xabarlarni to'xtatish"

ASK_QUESTION = "Savolingizni yozing — spikerning jamoasi javob beradi."
QUESTION_OK = "Savolingiz qabul qilindi. Javob shu yerga keladi."
ANSWER = "<b>Savolingizga javob:</b>\n\n{answer}"
CHAT_ANSWER = "<b>Efirdagi savolingizga javob</b>\n\n<i>{question}</i>\n\n{answer}"

STOPPED = ("Avtomatik xabarlar to'xtatildi. Efir va to'lov bo'yicha muhim xabarlar kelib turadi. "
           "Qayta yoqish uchun pastdagi tugmani bosing.")
RESUMED = "Xabarlar qayta yoqildi."

SESSION_BOOKED = ("<b>Joyingiz band qilindi</b>\n\n1-kun: {d1}\n2-kun: {d2}\n\n"
                  "Efirdan oldin eslatma yuboraman.")
SESSION_INFO = "<b>Sizning efiringiz</b>\n\n1-kun: {d1}\n2-kun: {d2}"
SESSION_NONE = "Siz hali efir vaqtini tanlamagansiz."
ENTER_BUTTON = "Efirga kirish"
CHANGE_BUTTON = "Vaqtni o'zgartirish"
RESCHEDULE_BUTTON = "Boshqa vaqt tanlash"
CHANGE_LATE = "Vaqtni efirdan kamida {n} soat oldin o'zgartirish mumkin."
ALREADY = "Siz ro'yxatdan o'tgansiz. {status}"

CHOOSE_TARIFF = "Tarifni tanlang.{deadline}"
DEADLINE_NOTE = " Maxsus narx {deadline} gacha amal qiladi."
OFFER_CLOSED = "Kechirasiz, bu taklif muddati tugagan."
CHOOSE_METHOD = "To'lov usulini tanlang:"
CHOOSE_AMOUNT = "Qancha to'laysiz?"
FULL_AMOUNT = "To'liq: {amount}"
DEPOSIT_AMOUNT = "Boshlang'ich: {amount}"
CARD_DETAILS = ("<b>Karta orqali o'tkazma</b>\n\nKarta raqami (bosib nusxalang):\n<code>{card}</code>\n"
                "Karta egasi: {holder}\nSumma: <b>{amount}</b>\n\n"
                "O'tkazgach chek rasmi yoki PDF faylini shu yerga yuboring.")
LINK_DETAILS = ("<b>{method} orqali to'lov</b>\n\nSumma: <b>{amount}</b>\n"
                "Pastdagi tugma orqali to'lang, so'ng chek rasmi yoki PDF faylini shu yerga yuboring.")
SEND_RECEIPT = "Chek yuborish"
WAIT_RECEIPT = "Chek rasmi yoki PDF faylini yuboring."
RECEIPT_OK = "Chekingiz qabul qilindi, tez orada tasdiqlanadi."
RECEIPT_NEED_CHOICE = "Avval tarif va to'lov usulini tanlang:"
PAY_APPROVED_FULL = ("<b>To'lov tasdiqlandi</b>\n\nKursga xush kelibsiz! Yopiq kanalga kirish havolasi faqat "
                     "siz uchun, 24 soat amal qiladi.")
PAY_APPROVED_DEPOSIT = ("<b>Boshlang'ich to'lov tasdiqlandi</b>\n\nRahmat! Tez orada menejerimiz siz bilan "
                        "bog'lanib, darslar boshlanishi va qolgan to'lov muddatini tushuntiradi.")
PAY_APPROVED_REMAINING = "<b>To'lov tasdiqlandi.</b> Rahmat!"
PAY_REJECTED = "Chekingiz rad etildi.\nSabab: {reason}\n\nTo'g'ri chekni qayta yuboring."
RESEND_RECEIPT = "Chekni qayta yuborish"
CHANNEL_BUTTON = "Kurs kanaliga kirish"

METHOD_NAMES = {"card": "Karta", "payme": "Payme", "click": "Click"}
KIND_NAMES = {"deposit": "boshlang'ich", "full": "to'liq", "remaining": "qolgan to'lov"}

GROUP_RECEIPT = ("<b>Yangi chek #{id}</b>\nLid: {name}\nTelefon: {phone}\nTarif: {tariff} · {method}\n"
                 "Summa: {amount} ({kind})\nDeadline: {deadline}{dup}")
GROUP_DUP = "\n\n⚠️ Diqqat: bu fayl #{dup} chekda ham yuborilgan"
GROUP_APPROVED = "\n\n✅ Tasdiqlandi — {who}, {at}"
GROUP_REJECTED = "\n\n❌ Rad etildi — {who}, {at}\nSabab: {reason}"
GROUP_NOT_ALLOWED = "Bu tugmani faqat admin panelda ro'yxatdan o'tgan admin yoki sotuv menejeri bosa oladi."
GROUP_ALREADY = "Bu chek allaqachon ko'rib chiqilgan."
GROUP_REASON = "Rad etish sababi — #{id}:"

MANAGER_DEPOSIT = "Boshlang'ich to'lov tasdiqlandi: {name}, {phone}. Lid bilan bog'laning."
MANAGER_RECEIPT = "Yangi chek: {name}, {phone} — {amount} ({kind})."
MANAGER_REMAINING_DUE = "Bugun qolgan to'lov sanasi: {name}, {phone} — {amount}."
MANAGER_CALLBACK = "Qayta qo'ng'iroq vaqti keldi: {name}, {phone}. Izoh: {note}"
REQUISITES_CHANGED = "Diqqat: «{funnel}» voronkasi rekvizitlari o'zgartirildi — {who}."


def money(amount: int | None) -> str:
    if amount is None:
        return "—"
    return f"{amount:,}".replace(",", " ") + " so'm"
