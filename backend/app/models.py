"""SQLAlchemy ORM models.

Two tables back the whole application:

* ``tasks``          – :class:`TaskItem`, a to-do entry anchored to a calendar
  day and tagged with a planning scope (daily / weekly / monthly / yearly).
* ``financial_logs`` – :class:`FinancialLog`, a single income or expense.

Money is stored as an integer number of minor units (cents/kuruş) in
``amount_cents``. Integers make SQL ``SUM`` exact and sidestep SQLite's lack of
a native decimal type; the :attr:`FinancialLog.amount` property converts to and
from :class:`~decimal.Decimal` so the rest of the code works in major units.

All timestamps are stored as UTC and returned as timezone-aware datetimes.
"""

import enum
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from app.database import Base

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

#: Quantum used to round money values to two decimal places.
_CENT = Decimal("0.01")


def utcnow() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""
    return datetime.now(UTC)


def decimal_to_cents(value: Decimal | int | float | str) -> int:
    """Convert a major-unit amount (e.g. ``Decimal("12.50")``) to integer cents.

    Values are rounded half-up to two decimal places first, matching how a
    human would round a receipt. Floats are routed through ``str`` so binary
    floating-point artefacts (``0.1 + 0.2``) do not leak into the result.
    """
    as_decimal = value if isinstance(value, Decimal) else Decimal(str(value))
    return int((as_decimal.quantize(_CENT, rounding=ROUND_HALF_UP) * 100).to_integral_value())


def cents_to_decimal(cents: int) -> Decimal:
    """Convert integer cents back to a two-decimal :class:`Decimal`."""
    return (Decimal(cents) / 100).quantize(_CENT)


class UTCDateTime(TypeDecorator[datetime]):
    """A ``DateTime`` column that always round-trips timezone-aware UTC values.

    SQLite has no timezone support, so SQLAlchemy hands back naive datetimes.
    This decorator normalises every value to UTC before writing (stored naive)
    and re-attaches ``tzinfo=UTC`` when reading, so the API always emits ISO
    timestamps with an explicit ``+00:00`` offset that JavaScript and Swift
    parse unambiguously.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        """Normalise outgoing values to naive UTC (naive input is assumed UTC)."""
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(UTC).replace(tzinfo=None)
        return value

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        """Attach UTC to values read back from the database."""
        if value is None:
            return None
        return value.replace(tzinfo=UTC)


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class TaskScope(enum.StrEnum):
    """Planning horizon of a task.

    The scope does not change *where* the task appears on the calendar (that is
    always ``due_date``); it lets clients filter and style tasks, e.g. showing
    yearly goals in a separate lane from daily chores.
    """

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class FinanceKind(enum.StrEnum):
    """Direction of a financial log: money coming in or going out."""

    INCOME = "income"
    EXPENSE = "expense"


def _enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    """Persist enum *values* (``"daily"``) rather than member names (``"DAILY"``)."""
    return [member.value for member in enum_cls]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class TaskItem(Base):
    """A to-do item displayed on the calendar on its ``due_date``.

    Business rules:
        * ``completed_at`` is set when the task is marked complete and cleared
          when it is reopened; it is never set by clients directly.
        * ``priority`` ranges from 0 (none) to 3 (high).
        * ``color`` is an optional ``#RRGGBB`` hint for calendar chips.
        * ``updated_at`` is bumped on every change and indexed so the mobile
          client can later pull "everything changed since X".
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("priority BETWEEN 0 AND 3", name="ck_tasks_priority_range"),
        Index("ix_tasks_due_date_scope", "due_date", "scope"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[TaskScope] = mapped_column(
        Enum(
            TaskScope,
            native_enum=False,
            length=16,
            values_callable=_enum_values,
            validate_strings=True,
            name="task_scope",
        ),
        nullable=False,
        default=TaskScope.DAILY,
    )
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=utcnow, onupdate=utcnow, index=True
    )

    def __repr__(self) -> str:
        return f"<TaskItem id={self.id} scope={self.scope} due={self.due_date} title={self.title!r}>"


class FinancialLog(Base):
    """A single income or expense entry.

    Business rules:
        * The stored amount is always strictly positive; whether it adds to or
          subtracts from the balance is decided by ``kind``.
        * ``occurred_on`` is the calendar day the money moved, which is the day
          the entry appears on in the calendar grid.
        * ``currency`` is an ISO-4217 code. Aggregations sum amounts as-is, so
          mixing currencies in one month will produce a meaningless total —
          acceptable for a single-user, single-currency setup.
    """

    __tablename__ = "financial_logs"
    __table_args__ = (
        CheckConstraint("amount_cents > 0", name="ck_financial_logs_amount_positive"),
        Index("ix_financial_logs_occurred_on_kind", "occurred_on", "kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[FinanceKind] = mapped_column(
        Enum(
            FinanceKind,
            native_enum=False,
            length=16,
            values_callable=_enum_values,
            validate_strings=True,
            name="finance_kind",
        ),
        nullable=False,
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TRY")
    category: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=utcnow, onupdate=utcnow, index=True
    )

    @property
    def amount(self) -> Decimal:
        """The amount in major units (e.g. ``Decimal("149.90")``)."""
        return cents_to_decimal(self.amount_cents)

    @amount.setter
    def amount(self, value: Decimal | int | float | str) -> None:
        """Set the amount from major units, storing it as integer cents."""
        self.amount_cents = decimal_to_cents(value)

    def __repr__(self) -> str:
        return (
            f"<FinancialLog id={self.id} {self.kind} {self.amount} {self.currency} "
            f"on={self.occurred_on} category={self.category!r}>"
        )
