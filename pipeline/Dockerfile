# Pipeline worker — runs on Railway as a long-lived background service.
#
# Build context: REPOSITORY ROOT (not ./pipeline).
#
# Why: the pipeline auto-runs db/migrations/*.sql on boot via
# pipeline/src/main.py::run_migrations(). For that to work, the
# migrations directory must be inside the image. Since db/ lives at
# the repo root and is shared by the frontend and pipeline services,
# the build context must be the repo root so Docker can COPY it.
#
# Railway configuration for this service:
#   Build → Builder       → Dockerfile
#   Build → Dockerfile Path → pipeline/Dockerfile
#   Build → Root Directory  → (unset, or `/`)    ← critical
#
# Container layout mirrors the local monorepo so no code paths change:
#   /app/pipeline/src/main.py      (script entry)
#   /app/pipeline/src/seeds/...    (imported via PYTHONPATH)
#   /app/db/migrations/*.sql       (found via ../../db/migrations)

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first for better layer caching
COPY pipeline/requirements.txt ./pipeline/requirements.txt
RUN pip install --no-cache-dir -r pipeline/requirements.txt

# Copy pipeline source
COPY pipeline/src/ ./pipeline/src/

# Copy shared SQL migrations — the pipeline container is the canonical
# place where migrations get applied on each deploy. Leaving this out
# was the original Phase 0.5 oversight that broke auto-migration and
# blocked the master_admin bootstrap from ever landing in the DB.
COPY db/ ./db/

# Run from the pipeline directory so:
#   - cwd = /app/pipeline (matches local `cd pipeline && python src/main.py`)
#   - __file__ = /app/pipeline/src/main.py
#   - os.path.dirname(__file__) + '/../../db/migrations' = /app/db/migrations  ✓
#   - PYTHONPATH = /app/pipeline makes `from src.seeds.master_admin import ...`
#     resolve because Python's script-mode sys.path[0] is the script's
#     directory (src/), NOT the cwd, so we need an explicit entry.
WORKDIR /app/pipeline
ENV PYTHONPATH=/app/pipeline

CMD ["python", "src/main.py"]
