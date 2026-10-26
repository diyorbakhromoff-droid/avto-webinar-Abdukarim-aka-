"""progrev flows

Progrev sxemasi: bo'limlar, bloklar, chiziqlar, lidlarning sxemadagi joyi va statistika.
Eski ("Kunlar bo'yicha") zanjir o'zgarmaydi. Mavjud lid voqealari sxema uchun "ko'rilgan" deb belgilanadi —
aks holda ishga tushganda eski voqealar sxemani boshlab yuborardi.

Revision ID: c3e5a7f9b2d4
Revises: b128864a6af1
Create Date: 2026-10-26 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c3e5a7f9b2d4'
down_revision: Union[str, None] = 'b128864a6af1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'flows',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('funnel_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('sort', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by', sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(['funnel_id'], ['funnels.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_flows_funnel_id', 'flows', ['funnel_id'])

    op.create_table(
        'flow_nodes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('flow_id', sa.Integer(), nullable=False),
        sa.Column('type', sa.String(length=12), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('x', sa.Integer(), nullable=False),
        sa.Column('y', sa.Integer(), nullable=False),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['flow_id'], ['flows.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_flow_nodes_flow_id', 'flow_nodes', ['flow_id'])

    op.create_table(
        'flow_edges',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('flow_id', sa.Integer(), nullable=False),
        sa.Column('from_node_id', sa.Integer(), nullable=False),
        sa.Column('from_port', sa.String(length=24), nullable=False),
        sa.Column('to_node_id', sa.Integer(), nullable=False),
        sa.Column('to_item', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['flow_id'], ['flows.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['from_node_id'], ['flow_nodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['to_node_id'], ['flow_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('from_node_id', 'from_port'),
    )
    op.create_index('ix_flow_edges_flow_id', 'flow_edges', ['flow_id'])
    op.create_index('ix_flow_edges_to_node_id', 'flow_edges', ['to_node_id'])

    op.create_table(
        'flow_runs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lead_id', sa.Integer(), nullable=False),
        sa.Column('flow_id', sa.Integer(), nullable=False),
        sa.Column('node_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('waiting_for', sa.String(length=10), nullable=True),
        sa.Column('wait_event', sa.String(length=24), nullable=True),
        sa.Column('wait_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('session_id', sa.Integer(), nullable=True),
        sa.Column('ctx', sa.JSON(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('ended_reason', sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['flow_id'], ['flows.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['flow_nodes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['session_id'], ['lead_sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_flow_runs_lead_id', 'flow_runs', ['lead_id'])
    op.create_index('ix_flow_runs_flow_id', 'flow_runs', ['flow_id'])
    op.create_index('ix_flow_runs_due', 'flow_runs', ['status', 'wait_until'])

    op.create_table(
        'flow_visits',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('run_id', sa.Integer(), nullable=False),
        sa.Column('lead_id', sa.Integer(), nullable=False),
        sa.Column('node_id', sa.Integer(), nullable=False),
        sa.Column('port', sa.String(length=24), nullable=True),
        sa.Column('entered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('left_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['run_id'], ['flow_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['flow_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_flow_visits_run_id', 'flow_visits', ['run_id'])
    op.create_index('ix_flow_visits_node_at', 'flow_visits', ['node_id', 'entered_at'])

    op.create_table(
        'flow_chain_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('run_id', sa.Integer(), nullable=False),
        sa.Column('lead_id', sa.Integer(), nullable=False),
        sa.Column('node_id', sa.Integer(), nullable=False),
        sa.Column('start_index', sa.Integer(), nullable=False),
        sa.Column('entered_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=True),
        sa.Column('key_suffix', sa.String(length=16), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['run_id'], ['flow_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['flow_nodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_id'], ['lead_sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_flow_chain_entries_run_id', 'flow_chain_entries', ['run_id'])
    op.create_index('ix_flow_chain_entries_lead_id', 'flow_chain_entries', ['lead_id'])

    op.add_column('chain_messages', sa.Column('flow_node_id', sa.Integer(), nullable=True))
    op.create_foreign_key('chain_messages_flow_node_id_fkey', 'chain_messages', 'flow_nodes', ['flow_node_id'],
                          ['id'], ondelete='CASCADE')
    op.create_index('ix_chain_messages_flow_node_id', 'chain_messages', ['flow_node_id'])

    op.add_column('scheduled_messages', sa.Column('flow_run_id', sa.Integer(), nullable=True))
    op.add_column('scheduled_messages', sa.Column('flow_node_id', sa.Integer(), nullable=True))
    op.create_foreign_key('scheduled_messages_flow_run_id_fkey', 'scheduled_messages', 'flow_runs', ['flow_run_id'],
                          ['id'], ondelete='SET NULL')
    op.create_foreign_key('scheduled_messages_flow_node_id_fkey', 'scheduled_messages', 'flow_nodes',
                          ['flow_node_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_scheduled_messages_flow_run_id', 'scheduled_messages', ['flow_run_id'])

    op.add_column('leads', sa.Column('tags', sa.ARRAY(sa.String(length=64)), server_default=sa.text("'{}'"),
                                     nullable=False))
    op.add_column('leads', sa.Column('ask_until', sa.DateTime(timezone=True), nullable=True))

    # mavjud voqealar — ko'rilgan (true), yangilari — false
    op.add_column('lead_events', sa.Column('flow_done', sa.Boolean(), server_default=sa.true(), nullable=False))
    op.alter_column('lead_events', 'flow_done', server_default=sa.false())
    op.create_index('ix_events_flow_pending', 'lead_events', ['id'], postgresql_where=sa.text('NOT flow_done'))


def downgrade() -> None:
    op.drop_index('ix_events_flow_pending', table_name='lead_events')
    op.drop_column('lead_events', 'flow_done')
    op.drop_column('leads', 'ask_until')
    op.drop_column('leads', 'tags')
    op.drop_index('ix_scheduled_messages_flow_run_id', table_name='scheduled_messages')
    op.drop_constraint('scheduled_messages_flow_node_id_fkey', 'scheduled_messages', type_='foreignkey')
    op.drop_constraint('scheduled_messages_flow_run_id_fkey', 'scheduled_messages', type_='foreignkey')
    op.drop_column('scheduled_messages', 'flow_node_id')
    op.drop_column('scheduled_messages', 'flow_run_id')
    # "Xabar" bloklarining xabarlari o'chadi; zanjirlarga ko'chirilganlari yana "Kunlar bo'yicha"ga qaytadi
    op.execute("DELETE FROM chain_messages WHERE trigger_type = 'flow'")
    op.drop_index('ix_chain_messages_flow_node_id', table_name='chain_messages')
    op.drop_constraint('chain_messages_flow_node_id_fkey', 'chain_messages', type_='foreignkey')
    op.drop_column('chain_messages', 'flow_node_id')
    op.drop_table('flow_chain_entries')
    op.drop_table('flow_visits')
    op.drop_table('flow_runs')
    op.drop_table('flow_edges')
    op.drop_table('flow_nodes')
    op.drop_table('flows')
