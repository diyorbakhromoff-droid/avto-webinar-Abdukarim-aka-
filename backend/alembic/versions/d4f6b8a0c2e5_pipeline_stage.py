"""pipeline stage

Sotuv doskasi: lidning menejer bosqichi. Mavjud lidlar to'lov, chek va oxirgi aloqa natijasiga qarab
joylashtiriladi.

Revision ID: d4f6b8a0c2e5
Revises: c3e5a7f9b2d4
Create Date: 2026-10-27 10:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd4f6b8a0c2e5'
down_revision: Union[str, None] = 'c3e5a7f9b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('leads', sa.Column('stage', sa.String(length=16), server_default='new', nullable=False))
    op.add_column('leads', sa.Column('stage_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
                                     nullable=False))
    op.create_index(op.f('ix_leads_stage'), 'leads', ['stage'], unique=False)
    op.execute("""
        UPDATE leads l SET stage = CASE c.result WHEN 'callback' THEN 'callback' WHEN 'refused' THEN 'lost'
                                                 WHEN 'sold' THEN 'won' ELSE 'contacted' END
        FROM (SELECT DISTINCT ON (lead_id) lead_id, result FROM contact_logs ORDER BY lead_id, id DESC) c
        WHERE c.lead_id = l.id
    """)
    op.execute("""
        UPDATE leads SET stage = 'waiting_payment'
        WHERE stage <> 'won' AND payment_status = 'none' AND step IN ('receipt_sent', 'receipt_rejected')
    """)
    op.execute("UPDATE leads SET stage = 'won' WHERE payment_status <> 'none'")
    op.execute("UPDATE leads SET stage_at = COALESCE(last_contact_at, step_at)")


def downgrade() -> None:
    op.drop_index(op.f('ix_leads_stage'), table_name='leads')
    op.drop_column('leads', 'stage_at')
    op.drop_column('leads', 'stage')
