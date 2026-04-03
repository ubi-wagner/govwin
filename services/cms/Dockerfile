# ─── CMS Service Dockerfile ──────────────────────────────────────
# Python FastAPI service for content management and media storage.
# Runs on Railway as a web service with health check at /health.
# ─────────────────────────────────────────────────────────────────

FROM python:3.12-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Create storage directory (Railway volume will mount over this)
RUN mkdir -p /data/cms

# Railway assigns PORT dynamically
ENV PORT=8000

EXPOSE ${PORT}

# Run with uvicorn
CMD uvicorn src.main:app --host 0.0.0.0 --port ${PORT} --workers 2 --log-level info
