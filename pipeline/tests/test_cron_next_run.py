"""compute_next_run — the dispatcher advances pipeline_schedules from the real
cron_expression (daily / weekly / every-N-hours), with a warned fallback to a
run_type step for anything it can't parse.

UTC canonical: cron hour/minute are UTC platform-wide (an admin's local schedule is
converted to a UTC cron on save; the UI renders back in the admin's display timezone).
"""
from datetime import datetime, timezone, timedelta

from ingest.dispatcher import compute_next_run


def _at(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def test_daily_same_day_when_hour_ahead():
    now = _at(2026, 7, 16, 5)
    assert compute_next_run("0 6 * * *", "daily", now) == _at(2026, 7, 16, 6)


def test_daily_next_day_when_hour_passed():
    now = _at(2026, 7, 16, 7)
    assert compute_next_run("0 6 * * *", "daily", now) == _at(2026, 7, 17, 6)


def test_daily_honours_minutes():
    now = _at(2026, 7, 16, 6, 0)
    assert compute_next_run("30 6 * * *", "daily", now) == _at(2026, 7, 16, 6, 30)


def test_weekly_sunday_lands_on_sunday_in_the_future():
    now = _at(2026, 7, 16, 10)
    nxt = compute_next_run("0 4 * * 0", "weekly", now)  # cron dow 0 = Sunday
    assert nxt.weekday() == 6 and nxt.hour == 4 and nxt.minute == 0
    assert now < nxt <= now + timedelta(days=7)


def test_weekly_monday_lands_on_monday_in_the_future():
    now = _at(2026, 7, 16, 10)
    nxt = compute_next_run("0 7 * * 1", "weekly", now)  # cron dow 1 = Monday
    assert nxt.weekday() == 0 and nxt.hour == 7
    assert now < nxt <= now + timedelta(days=7)


def test_every_n_hours():
    now = _at(2026, 7, 16, 5)
    assert compute_next_run("0 */4 * * *", None, now) == now + timedelta(hours=4)


def test_monthly_falls_back_to_step_not_silent():
    # day-of-month is unsupported -> warned fallback to the run_type step.
    now = _at(2026, 7, 16, 5)
    assert compute_next_run("0 4 1 * *", "monthly", now) == now + timedelta(hours=24)


def test_empty_cron_uses_run_type_step():
    now = _at(2026, 7, 16, 5)
    assert compute_next_run(None, "weekly", now) == now + timedelta(hours=168)
    assert compute_next_run("", "daily", now) == now + timedelta(hours=24)


def test_garbage_cron_falls_back():
    now = _at(2026, 7, 16, 5)
    assert compute_next_run("not a cron", "daily", now) == now + timedelta(hours=24)
    assert compute_next_run("0 25 * * *", "daily", now) == now + timedelta(hours=24)  # hour 25 invalid
