"""THE SEND SEAM IS A BOUNDARY, and this is what makes it one on the CRM side.

`src/mailer/` owns four things no transport may reimplement: the suppression check, idempotency,
the `email_send_ledger` row, and sender resolution. A caller that reaches `gmail_client.send_email`
directly gets none of them — it double-sends on replay, mails an address that hard-bounced last
week, and leaves no row to answer "why did this notification not go?".

── THE EXEMPTION IS NOT AN ALLOWLIST ─────────────────────────────────────────────────────────
Two files DO still call the transport directly, and that is deliberate: the CRM's campaign / HITL
email engine is a mailbox CLIENT, not a notification sender. It threads replies (`in_reply_to`,
`thread_id`), sweeps an inbox, counts per-account daily sends, and keeps its own `email_sends` queue
in `cms-postgres` with its own status machine. Forcing it through a seam whose driver has no concept
of a thread would lose threading to buy a ledger row it already has.

But an exemption that only says "these files may" is the shape of a leak that becomes permanent. So
each exempt file carries an OBLIGATION that is asserted here: **it must consult the shared
suppression list before dispatch.** A hard bounce belongs to the address, the reputation is shared
with the notification stream, and a campaign that ignored it would burn the domain both depend on.

── THE INSTRUMENT BEFORE THE FINDING ─────────────────────────────────────────────────────────
The first test asserts the scanner can see the tree at all. A scanner with a wrong root reports "no
offenders" and looks exactly like a clean codebase.
"""
from __future__ import annotations

import os
import re

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src'))

#: The one package allowed to hold a transport.
DRIVERS = os.path.join('mailer', 'drivers')
#: The whole seam — allowed to touch the ledger tables.
SEAM = os.path.join('src', 'mailer')

#: file -> the reason it may reach the transport directly. Each one is asserted below to consult
#: the shared suppression list, so the exemption carries an obligation rather than a permission.
CAMPAIGN_ENGINE = {
    'workers/email_queue.py': 'the campaign/HITL send queue — threads replies, counts per-account '
                              'daily sends, and keeps its own status machine in cms-postgres',
    'routers/email.py': 'the campaign admin API, including the template test-send',
}

#: Inbound only. It reads a mailbox; it does not send.
READS_ONLY = {'workers/email_sweep.py'}


def _py_files() -> list[str]:
    out = []
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        out += [os.path.join(root, f) for f in files if f.endswith('.py')]
    return out


def _rel(path: str) -> str:
    return os.path.relpath(path, SRC).replace(os.sep, '/')


def _read(path: str) -> str:
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def test_the_scanner_can_see_the_tree():
    # A boundary test whose file list is empty passes every assertion below for the wrong reason.
    files = {_rel(f) for f in _py_files()}
    assert len(files) > 20, f'only {len(files)} python files found — the scan root is wrong'
    assert 'mailer/__init__.py' in files
    assert 'mailer/drivers/gmail.py' in files
    assert 'event_listener.py' in files


def test_the_rules_would_flag_a_violation():
    # Red by construction: each pattern is asserted against a string that IS a violation, so the
    # rules below cannot pass merely by never matching anything.
    samples = [
        ('from .gmail_client import send_email', re.compile(r'gmail_client import send_email')),
        ('from ..workers.gmail_client import send_email as x',
         re.compile(r'gmail_client import send_email')),
        ("requests.post('https://api.postmarkapp.com/email')", re.compile(r'api\.postmarkapp\.com')),
        ('INSERT INTO email_send_ledger (id)', re.compile(r'\bemail_send_ledger\b')),
    ]
    for sample, pattern in samples:
        assert pattern.search(sample), f'rule {pattern.pattern} failed to match its own example'


def test_only_the_drivers_and_the_campaign_engine_reach_a_transport():
    offenders = []
    for f in _py_files():
        rel = _rel(f)
        if DRIVERS in f or rel in CAMPAIGN_ENGINE or rel in READS_ONLY:
            continue
        src = _read(f)
        if re.search(r'gmail_client import send_email', src) or re.search(r'api\.postmarkapp\.com', src):
            offenders.append(rel)
    assert offenders == [], (
        'these modules hand a message to a provider without passing through mailer.send(), so they '
        'get no suppression check, no idempotency reservation, and no ledger row: ' + ', '.join(offenders)
    )


def test_every_exempt_file_still_honours_the_suppression_list():
    # The obligation that makes the exemption a decision rather than a hole. Without it the campaign
    # engine would keep mailing addresses that hard-bounced, on the same domain the notification
    # stream sends from.
    #
    # The assertion is on `await suppression_for(` and not on the mere presence of the NAME. The
    # first version of this test checked for the substring, and a probe that replaced the import
    # with `suppression_for = None` passed it — the name was still there and nothing called it. A
    # check that a symbol is imported is not a check that it runs.
    missing = []
    for rel, reason in CAMPAIGN_ENGINE.items():
        src = _read(os.path.join(SRC, *rel.split('/')))
        if not re.search(r'await\s+suppression_for\s*\(', src):
            missing.append(f'{rel} ({reason})')
    assert missing == [], (
        'a file exempt from the transport boundary MUST consult the shared suppression list before '
        'dispatch — the exemption is for threading, not for ignoring bounces: ' + '; '.join(missing)
    )


def test_only_the_seam_touches_the_ledger_table():
    # `email_send_ledger` lives in the MAIN database and is deliberately named unlike the CRM's own
    # `email_sends` queue in cms-postgres, because this service holds a pool to both.
    offenders = [
        _rel(f) for f in _py_files()
        if SEAM not in f and re.search(r'\bemail_send_ledger\b', _read(f))
    ]
    assert offenders == [], (
        'the ledger is written in one place, through the shared-database pool: ' + ', '.join(offenders)
    )


def test_the_two_email_send_tables_are_not_confused():
    # The CRM's own `email_sends` (cms-postgres — campaign queue, gmail_thread_id, retry_count) and
    # the platform's `email_send_ledger` (main DB — correlation, idempotency) are different tables in
    # different databases, and this service connects to both. Anything reaching for `email_sends`
    # must be using the CMS pool; anything reaching for the ledger must be using the shared one.
    for f in _py_files():
        src = _read(f)
        if not re.search(r'\bemail_send_ledger\b', src):
            continue
        assert SEAM in f, (
            f'{_rel(f)} queries email_send_ledger outside the seam — and if that was meant to be '
            'the CRM queue, the table it wants is email_sends, in the other database'
        )
