# Stage 1: Build CMS React SPA
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output lands at /build/static (because vite outDir: '../static')

# Stage 2: Python backend + built SPA
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libpq-dev postgresql-client && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
COPY db/ ./db/
COPY --from=frontend-builder /build/static ./static/
RUN chmod +x db/run.sh
RUN useradd -r -s /bin/bash cmsuser && chown -R cmsuser:cmsuser /app
RUN mkdir -p /data/cms && chown -R cmsuser:cmsuser /data
USER cmsuser
# Migrations gate boot (fail-fast, matching the frontend/pipeline entrypoints): run.sh is
# idempotent and returns 0 when everything is already applied, exits 1 only on a real failure.
# Refuse to serve a CMS on an unmigrated/half-migrated schema — crash loudly so the platform
# surfaces and restarts it instead of silently running stale.
CMD ["/bin/bash", "-c", "bash db/run.sh || { echo '[FATAL] CMS DB migration failed — refusing to boot on an unmigrated schema'; exit 1; }; exec uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
