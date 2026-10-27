"""chain fixed_at

Zanjir xabarini aniq sana va vaqtda yuborish (trigger "at_datetime"). Mavjud xabarlar o'zgarmaydi.

Revision ID: e5a7c9b1d3f6
Revises: d4f6b8a0c2e5
Create Date: 2026-10-27 16:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e5a7c9b1d3f6'
down_revision: Union[str, None] = 'd4f6b8a0c2e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chain_messages', sa.Column('fixed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.execute("UPDATE chain_messages SET status = 'draft' WHERE trigger_type = 'at_datetime'")
    op.drop_column('chain_messages', 'fixed_at')
