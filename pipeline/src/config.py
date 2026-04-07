"""Pipeline configuration from environment variables."""
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://govtech:changeme@localhost:5432/govtech_intel")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
SAM_GOV_API_KEY = os.getenv("SAM_GOV_API_KEY", "")
API_KEY_ENCRYPTION_SECRET = os.getenv("API_KEY_ENCRYPTION_SECRET", "")
STORAGE_ROOT = os.getenv("STORAGE_ROOT", "/data")
USE_STUB_DATA = os.getenv("USE_STUB_DATA", "false").lower() == "true"
