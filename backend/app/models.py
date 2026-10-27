"""Ma'lumotlar bazasi modellari (PostgreSQL). Vaqtlar UTC da saqlanadi."""
from datetime import date, datetime

from sqlalchemy import (
    ARRAY, JSON, BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint, false, func, text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def ts(nullable: bool = True, default_now: bool = False):
    kw = {"server_default": func.now()} if default_now else {}
    return mapped_column(DateTime(timezone=True), nullable=nullable, **kw)


class Funnel(Base):
    """Voronka: bitta kurs uchun webinar videosi, slotlar, progrev zanjiri, oferta."""
    __tablename__ = "funnels"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = ts(False, True)

    # brend / dizayn
    course_title: Mapped[str] = mapped_column(String(200), default="")
    webinar_title: Mapped[str] = mapped_column(String(200), default="Bepul webinar · 2 kun")
    topic: Mapped[str] = mapped_column(String(300), default="")
    speaker_name: Mapped[str] = mapped_column(String(200), default="")
    speaker_title: Mapped[str] = mapped_column(String(300), default="")
    speaker_photo_url: Mapped[str | None] = mapped_column(String(500))
    logo_url: Mapped[str | None] = mapped_column(String(500))
    theme_primary: Mapped[str] = mapped_column(String(16), default="#5B9BEF")
    theme_background: Mapped[str] = mapped_column(String(16), default="#0E1726")
    bg_image_url: Mapped[str | None] = mapped_column(String(500))
    welcome_text: Mapped[str] = mapped_column(Text, default="")
    lead_magnet_media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    lead_magnet_caption: Mapped[str] = mapped_column(Text, default="")

    # slotlar
    slot_times: Mapped[list[str]] = mapped_column(ARRAY(String(5)), default=lambda: ["14:00", "20:00"])
    weekdays: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=lambda: list(range(7)))
    excluded_dates: Mapped[list[date]] = mapped_column(ARRAY(Date), default=list)
    min_hours_before: Mapped[float] = mapped_column(Float, default=3)
    options_count: Mapped[int] = mapped_column(Integer, default=2)
    late_entry_minutes: Mapped[int] = mapped_column(Integer, default=15)
    reschedule_limit: Mapped[int] = mapped_column(Integer, default=3)
    day1_watch_threshold: Mapped[float] = mapped_column(Float, default=0.75)
    quiet_start: Mapped[str] = mapped_column(String(5), default="23:00")
    quiet_end: Mapped[str] = mapped_column(String(5), default="08:00")

    # video
    day1_video_id: Mapped[str] = mapped_column(String(200), default="")
    day1_duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    day1_soft_offer_sec: Mapped[int | None] = mapped_column(Integer)
    day2_video_id: Mapped[str] = mapped_column(String(200), default="")
    day2_duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    day2_offer_sec: Mapped[int] = mapped_column(Integer, default=0)
    between_summary: Mapped[list[str]] = mapped_column(JSON, default=list)

    # sotuv
    offer_course_title: Mapped[str] = mapped_column(String(200), default="")
    bonuses: Mapped[list[str]] = mapped_column(JSON, default=list)
    deadline_hours: Mapped[int] = mapped_column(Integer, default=24)
    after_deadline: Mapped[str] = mapped_column(String(20), default="regular_price")
    channel_id: Mapped[int | None] = mapped_column(BigInteger)

    # rekvizitlar (faqat super admin o'zgartiradi)
    card_number: Mapped[str] = mapped_column(String(32), default="")
    card_holder: Mapped[str] = mapped_column(String(200), default="")
    payme_url: Mapped[str] = mapped_column(String(500), default="")
    click_url: Mapped[str] = mapped_column(String(500), default="")

    # to'xtab qolish chegaralari (daqiqa)
    stuck_no_phone_min: Mapped[int] = mapped_column(Integer, default=60)
    stuck_no_session_min: Mapped[int] = mapped_column(Integer, default=120)
    stuck_no_receipt_min: Mapped[int] = mapped_column(Integer, default=60)

    tariffs: Mapped[list["Tariff"]] = relationship(back_populates="funnel", order_by="Tariff.sort",
                                                   cascade="all, delete-orphan")


class Tariff(Base):
    __tablename__ = "tariffs"

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(ForeignKey("funnels.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(300), default="")
    special_price: Mapped[int] = mapped_column(BigInteger, default=0)
    regular_price: Mapped[int] = mapped_column(BigInteger, default=0)
    deposit_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    deposit_amount: Mapped[int] = mapped_column(BigInteger, default=100_000)
    sort: Mapped[int] = mapped_column(Integer, default=0)

    funnel: Mapped[Funnel] = relationship(back_populates="tariffs")


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20))  # super_admin | content | sales
    tg_user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = ts(False, True)


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (UniqueConstraint("funnel_id", "tg_user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(ForeignKey("funnels.id", ondelete="CASCADE"), index=True)
    tg_user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str | None] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = ts(False, True)
    phone_at: Mapped[datetime | None] = ts()

    step: Mapped[str] = mapped_column(String(32), default="started", index=True)
    step_at: Mapped[datetime] = ts(False, True)

    day1_reschedules: Mapped[int] = mapped_column(Integer, default=0)
    day2_reschedules: Mapped[int] = mapped_column(Integer, default=0)
    cold: Mapped[bool] = mapped_column(Boolean, default=False)
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    unsubscribed: Mapped[bool] = mapped_column(Boolean, default=False)

    # joriy sessiya bo'yicha ko'rish (ro'yxat ustunlari uchun denormalizatsiya)
    day1_watched_sec: Mapped[int | None] = mapped_column(Integer)
    day2_watched_sec: Mapped[int | None] = mapped_column(Integer)
    reached_offer_at: Mapped[datetime | None] = ts()
    clicked_buy_at: Mapped[datetime | None] = ts()
    deadline_at: Mapped[datetime | None] = ts()
    special_price_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    payment_status: Mapped[str] = mapped_column(String(10), default="none")  # none | deposit | full
    remaining_amount: Mapped[int | None] = mapped_column(BigInteger)
    remaining_due_date: Mapped[date | None] = mapped_column(Date)
    remaining_reminded_at: Mapped[datetime | None] = ts()

    manager_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), index=True)
    last_contact_at: Mapped[datetime | None] = ts()
    # sotuv doskasi: menejer bosqichi (avtovoronka qadamidan alohida, domain.pipeline.STAGES)
    stage: Mapped[str] = mapped_column(String(16), default="new", server_default="new", index=True)
    stage_at: Mapped[datetime] = ts(False, True)

    # sxema: teglar va "savolingizni yozing" so'ralgan payt (shu vaqtgacha yozgan matn savol bo'ladi)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list, server_default=text("'{}'"))
    ask_until: Mapped[datetime | None] = ts()

    manager: Mapped[AdminUser | None] = relationship()


class LeadSession(Base):
    """Ikki kunlik efir: 1-kun (tanlangan slot) va 2-kun (aniq 24 soatdan keyin)."""
    __tablename__ = "lead_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    day1_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    day2_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | replaced | completed
    created_at: Mapped[datetime] = ts(False, True)
    # kun tugaganidan keyin baholangan natijalar
    day1_evaluated: Mapped[bool] = mapped_column(Boolean, default=False)
    day2_evaluated: Mapped[bool] = mapped_column(Boolean, default=False)
    day1_watched: Mapped[bool | None] = mapped_column(Boolean)
    day2_joined: Mapped[bool | None] = mapped_column(Boolean)

    lead: Mapped[Lead] = relationship()


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("session_id", "day", "day_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("lead_sessions.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    day: Mapped[int] = mapped_column(Integer)
    day_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # shu kunning boshlanishi (2-kun ko'chsa yangi yozuv)
    joined_at: Mapped[datetime] = ts(False, True)
    join_position_sec: Mapped[int] = mapped_column(Integer, default=0)
    max_position_sec: Mapped[int] = mapped_column(Integer, default=0)
    watched_sec: Mapped[int] = mapped_column(Integer, default=0)
    last_heartbeat_at: Mapped[datetime | None] = ts()
    last_position_sec: Mapped[int] = mapped_column(Integer, default=0)
    reached_offer: Mapped[bool] = mapped_column(Boolean, default=False)
    left_at: Mapped[datetime | None] = ts()  # efir davomida chiqib ketgan payti (qaytsa — None)


class Heartbeat(Base):
    """Xom heartbeat yozuvlari — 30 kun saqlanadi, tomosha grafigi uchun agregatsiya qilinadi."""
    __tablename__ = "heartbeats"
    __table_args__ = (Index("ix_hb_funnel_day_at", "funnel_id", "day", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    funnel_id: Mapped[int] = mapped_column(Integer)
    lead_id: Mapped[int] = mapped_column(Integer, index=True)
    attendance_id: Mapped[int] = mapped_column(Integer)
    day: Mapped[int] = mapped_column(Integer)
    position_sec: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = ts(False, True)


class WatchBucket(Base):
    """Agregatsiya: kun va daqiqa bo'yicha tomoshabinlar soni."""
    __tablename__ = "watch_buckets"
    __table_args__ = (UniqueConstraint("funnel_id", "day", "session_date", "minute"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(Integer, index=True)
    day: Mapped[int] = mapped_column(Integer)
    session_date: Mapped[date] = mapped_column(Date)
    minute: Mapped[int] = mapped_column(Integer)
    viewers: Mapped[int] = mapped_column(Integer, default=0)
    joined: Mapped[int] = mapped_column(Integer, default=0)


class Media(Base):
    __tablename__ = "media"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100), default="")
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    path: Mapped[str] = mapped_column(String(500))
    tg_file_id: Mapped[str | None] = mapped_column(String(255))  # birinchi yuborishdan keyin keshlanadi
    created_at: Mapped[datetime] = ts(False, True)


class ChainMessage(Base):
    __tablename__ = "chain_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(ForeignKey("funnels.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16), default="text")
    text: Mapped[str] = mapped_column(Text, default="")
    media_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    buttons: Mapped[list] = mapped_column(JSON, default=list)
    trigger_type: Mapped[str] = mapped_column(String(24))
    trigger_day: Mapped[int | None] = mapped_column(Integer)
    offset_minutes: Mapped[int] = mapped_column(Integer, default=0)
    stuck_step: Mapped[str | None] = mapped_column(String(24))
    button_key: Mapped[str | None] = mapped_column(String(64))
    segment: Mapped[str] = mapped_column(String(24), default="all")
    segment_day: Mapped[int | None] = mapped_column(Integer)      # ko'rish segmentlari: qaysi kun videosi
    segment_minute: Mapped[int | None] = mapped_column(Integer)   # ko'rish segmentlari: X-daqiqa
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(10), default="active")
    sort: Mapped[int] = mapped_column(Integer, default=0)
    system_key: Mapped[str | None] = mapped_column(String(32))  # standart xabarlar (eslatma, qayta tanlash)
    # sxemadagi "Xabar" yoki "Zanjir" blokiga tegishli bo'lsa — faqat lid shu blokka yetganda yuboriladi
    flow_node_id: Mapped[int | None] = mapped_column(ForeignKey("flow_nodes.id", ondelete="CASCADE"), index=True)
    updated_at: Mapped[datetime] = ts(False, True)
    updated_by: Mapped[str | None] = mapped_column(String(100))


class ChainHistory(Base):
    __tablename__ = "chain_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("chain_messages.id", ondelete="CASCADE"), index=True)
    user_name: Mapped[str] = mapped_column(String(100))
    changes: Mapped[dict] = mapped_column(JSON)
    at: Mapped[datetime] = ts(False, True)


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(ForeignKey("funnels.id", ondelete="CASCADE"), index=True)
    segment: Mapped[str] = mapped_column(String(24))
    text: Mapped[str] = mapped_column(Text, default="")
    buttons: Mapped[list] = mapped_column(JSON, default=list)
    media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    lead_ids: Mapped[list[int] | None] = mapped_column(JSON)  # menejer tanlagan lidlarga xabar
    send_at: Mapped[datetime | None] = ts()
    status: Mapped[str] = mapped_column(String(12), default="scheduled")  # scheduled | sending | done
    recipients: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = ts(False, True)


class ScheduledMessage(Base):
    """Navbat: har bir lidga rejalashtirilgan xabar. dedupe_key — bitta xabar bir marta."""
    __tablename__ = "scheduled_messages"
    __table_args__ = (
        UniqueConstraint("lead_id", "dedupe_key"),
        Index("ix_sched_due", "status", "send_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    chain_message_id: Mapped[int | None] = mapped_column(ForeignKey("chain_messages.id", ondelete="CASCADE"))
    broadcast_id: Mapped[int | None] = mapped_column(ForeignKey("broadcasts.id", ondelete="CASCADE"))
    session_id: Mapped[int | None] = mapped_column(ForeignKey("lead_sessions.id", ondelete="CASCADE"))
    flow_run_id: Mapped[int | None] = mapped_column(ForeignKey("flow_runs.id", ondelete="SET NULL"), index=True)
    flow_node_id: Mapped[int | None] = mapped_column(ForeignKey("flow_nodes.id", ondelete="CASCADE"))
    dedupe_key: Mapped[str] = mapped_column(String(64))
    session_bound: Mapped[bool] = mapped_column(Boolean, default=False)
    send_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | sent | skipped | cancelled | failed
    reason: Mapped[str | None] = mapped_column(String(200))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    sent_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = ts(False, True)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    tariff_id: Mapped[int | None] = mapped_column(ForeignKey("tariffs.id", ondelete="SET NULL"))
    method: Mapped[str] = mapped_column(String(10))   # card | payme | click
    kind: Mapped[str] = mapped_column(String(10))     # deposit | full | remaining
    amount: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    reject_reason: Mapped[str | None] = mapped_column(String(200))
    file_path: Mapped[str] = mapped_column(String(500))
    file_mime: Mapped[str] = mapped_column(String(100))
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    duplicate_of: Mapped[int | None] = mapped_column(Integer)
    submitted_at: Mapped[datetime] = ts(False, True)
    within_deadline: Mapped[bool] = mapped_column(Boolean, default=False)
    decided_at: Mapped[datetime | None] = ts()
    decided_by: Mapped[str | None] = mapped_column(String(100))
    refunded: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(100))  # menejer yuklagan bo'lsa
    group_chat_id: Mapped[int | None] = mapped_column(BigInteger)
    group_message_id: Mapped[int | None] = mapped_column(BigInteger)

    lead: Mapped[Lead] = relationship()
    tariff: Mapped[Tariff | None] = relationship()


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(10))  # miniapp — efir chati, bot — keyingi savollar
    session_id: Mapped[int | None] = mapped_column(ForeignKey("lead_sessions.id", ondelete="SET NULL"))
    day: Mapped[int | None] = mapped_column(Integer)
    video_sec: Mapped[int | None] = mapped_column(Integer)  # yozilgan paytdagi video soniyasi
    created_at: Mapped[datetime] = ts(False, True)
    answer: Mapped[str | None] = mapped_column(Text)
    answered_by: Mapped[str | None] = mapped_column(String(100))
    answered_at: Mapped[datetime | None] = ts()

    lead: Mapped[Lead] = relationship()


class LiveComment(Base):
    """Asl jonli efirdagi izohlar — videoga sinxron chiqadi."""
    __tablename__ = "live_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(ForeignKey("funnels.id", ondelete="CASCADE"), index=True)
    day: Mapped[int] = mapped_column(Integer)
    t: Mapped[int] = mapped_column(Integer)
    author: Mapped[str] = mapped_column(String(100))
    text: Mapped[str] = mapped_column(Text)


class LeadStep(Base):
    """Qadamlar tarixi: qayerda va qancha to'xtab qolgani (statistika uchun)."""
    __tablename__ = "lead_steps"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    step: Mapped[str] = mapped_column(String(32), index=True)
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = ts()
    next_step: Mapped[str | None] = mapped_column(String(32))


class LeadEvent(Base):
    __tablename__ = "lead_events"
    __table_args__ = (Index("ix_events_flow_pending", "id", postgresql_where=text("NOT flow_done")),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(32), index=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = ts(False, True)
    flow_done: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())  # sxema ko'rib chiqdi


class ContactLog(Base):
    __tablename__ = "contact_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    manager_name: Mapped[str] = mapped_column(String(100))
    result: Mapped[str] = mapped_column(String(12))
    callback_at: Mapped[datetime | None] = ts()
    note: Mapped[str] = mapped_column(Text, default="")
    reminded: Mapped[bool] = mapped_column(Boolean, default=False)
    at: Mapped[datetime] = ts(False, True)


class AdSpend(Base):
    __tablename__ = "ad_spend"

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(ForeignKey("funnels.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(64))
    date: Mapped[date] = mapped_column(Date)
    amount: Mapped[int] = mapped_column(BigInteger)


class KeyValue(Base):
    """Umumiy sozlamalar (admin guruhi ID, jonli webinar natijalari va h.k.)."""
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | list | int | str | None] = mapped_column(JSON)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_name: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(64))
    details: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[datetime] = ts(False, True)


# ─────────────────────────── progrev sxemasi ───────────────────────────

class Flow(Base):
    """Sxemaning bo'limi (alohida varaq): bloklar va ularni ulovchi chiziqlar."""
    __tablename__ = "flows"

    id: Mapped[int] = mapped_column(primary_key=True)
    funnel_id: Mapped[int] = mapped_column(ForeignKey("funnels.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(10), default="draft")  # active | draft
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = ts(False, True)
    updated_at: Mapped[datetime] = ts(False, True)
    updated_by: Mapped[str | None] = mapped_column(String(100))


class FlowNode(Base):
    """Blok: start | message | wait | condition | action | goto | chain | stop | note.
    Xabar matni va tugmalari chain_messages da (flow_node_id), qolgan sozlamalar config da."""
    __tablename__ = "flow_nodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    flow_id: Mapped[int] = mapped_column(ForeignKey("flows.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(12))
    title: Mapped[str] = mapped_column(String(200), default="")
    x: Mapped[int] = mapped_column(Integer, default=0)
    y: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = ts(False, True)


class FlowEdge(Base):
    """Chiziq: blokning chiqishidan (port) boshqa blokka. Zanjirga ulansa — to_item-xabaridan boshlanadi."""
    __tablename__ = "flow_edges"
    __table_args__ = (UniqueConstraint("from_node_id", "from_port"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    flow_id: Mapped[int] = mapped_column(ForeignKey("flows.id", ondelete="CASCADE"), index=True)
    from_node_id: Mapped[int] = mapped_column(ForeignKey("flow_nodes.id", ondelete="CASCADE"))
    from_port: Mapped[str] = mapped_column(String(24))
    to_node_id: Mapped[int] = mapped_column(ForeignKey("flow_nodes.id", ondelete="CASCADE"), index=True)
    to_item: Mapped[int] = mapped_column(Integer, default=0)


class FlowRun(Base):
    """Lidning bo'limdagi joyi. Bir lid bir bo'limda bir vaqtda faqat bitta joyda bo'ladi."""
    __tablename__ = "flow_runs"
    __table_args__ = (Index("ix_flow_runs_due", "status", "wait_until"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    flow_id: Mapped[int] = mapped_column(ForeignKey("flows.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[int | None] = mapped_column(ForeignKey("flow_nodes.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | waiting | done | stopped
    waiting_for: Mapped[str | None] = mapped_column(String(10))       # button | time | event | chain
    wait_event: Mapped[str | None] = mapped_column(String(24))
    wait_until: Mapped[datetime | None] = ts()
    session_id: Mapped[int | None] = mapped_column(ForeignKey("lead_sessions.id", ondelete="SET NULL"))
    ctx: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = ts(False, True)
    updated_at: Mapped[datetime] = ts(False, True)
    ended_reason: Mapped[str | None] = mapped_column(String(200))


class FlowVisit(Base):
    """Lid blokka kirdi va qaysi chiqishdan chiqdi — blok ustidagi raqamlar shundan."""
    __tablename__ = "flow_visits"
    __table_args__ = (Index("ix_flow_visits_node_at", "node_id", "entered_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("flow_runs.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    node_id: Mapped[int] = mapped_column(ForeignKey("flow_nodes.id", ondelete="CASCADE"))
    port: Mapped[str | None] = mapped_column(String(24))
    entered_at: Mapped[datetime] = ts(False, True)
    left_at: Mapped[datetime | None] = ts()


class FlowChainEntry(Base):
    """Lid zanjirga kirdi (start_index-xabardan). Efir vaqti o'zgarsa, shu yozuv bo'yicha qayta rejalashtiriladi."""
    __tablename__ = "flow_chain_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("flow_runs.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[int] = mapped_column(ForeignKey("flow_nodes.id", ondelete="CASCADE"))
    start_index: Mapped[int] = mapped_column(Integer, default=0)
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    session_id: Mapped[int | None] = mapped_column(ForeignKey("lead_sessions.id", ondelete="SET NULL"))
    key_suffix: Mapped[str] = mapped_column(String(16), default="")  # shu sessiyada qayta kirilsa — qayta yuboriladi
    active: Mapped[bool] = mapped_column(Boolean, default=True)
