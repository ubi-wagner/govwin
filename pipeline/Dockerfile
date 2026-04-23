FROM python:3.12-slim

WORKDIR /app

# Build deps for native extensions (psycopg, cryptography).
# Installed, used for pip, then purged to keep the final image lean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Dependencies (cached layer — rebuilds only when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y gcc g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# App code + operational scripts (needed for `railway run ... scripts/...`)
COPY src/ ./src/
COPY scripts/ ./scripts/

CMD ["python", "src/main.py"]
