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
USER cmsuser
CMD ["/bin/bash", "-c", "bash db/run.sh || echo '[warn] Migration failed or skipped'; exec uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
