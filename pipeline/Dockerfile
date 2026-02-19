# Python pipeline worker — Railway deployment
# Runs as a long-lived process: LISTEN + job execution
# No HTTP server, no exposed port needed

FROM python:3.12-slim

WORKDIR /app

# Install system deps for psycopg3 + sentence-transformers
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY src/ ./src/
COPY config/ ./config/

# Railway: no PORT needed — this is a worker, not a web server
# Railway will keep it running as long as the process stays alive

CMD ["python", "src/main.py"]
