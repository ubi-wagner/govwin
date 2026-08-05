"""Pipeline configuration from environment variables."""
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is required. "
        "Set it to your PostgreSQL connection string."
    )

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
SAM_GOV_API_KEY = os.getenv("SAM_GOV_API_KEY", "")
API_KEY_ENCRYPTION_SECRET = os.getenv("API_KEY_ENCRYPTION_SECRET", "")
USE_STUB_DATA = os.getenv("USE_STUB_DATA", "false").lower() == "true"

# Guard: stub data must NEVER run in production. Railway injects RAILWAY_ENVIRONMENT_NAME
# on this project (the older RAILWAY_ENVIRONMENT is NOT provided), so the prior check on
# RAILWAY_ENVIRONMENT alone silently never fired — a pipeline with USE_STUB_DATA=true would
# have served fake data in prod undetected. Check every marker Railway/our config exposes.
_ENV_MARKERS = (
    os.getenv("RAILWAY_ENVIRONMENT_NAME"),
    os.getenv("RAILWAY_ENVIRONMENT"),  # legacy Railway name, kept for back-compat
    os.getenv("APP_ENV"),
)
IS_PRODUCTION = any((m or "").strip().lower() == "production" for m in _ENV_MARKERS)

if USE_STUB_DATA and IS_PRODUCTION:
    raise RuntimeError(
        "USE_STUB_DATA=true is forbidden in production "
        "(RAILWAY_ENVIRONMENT_NAME/APP_ENV=production) — unset USE_STUB_DATA on the prod service."
    )
