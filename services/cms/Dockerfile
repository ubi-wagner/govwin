FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libpq-dev postgresql-client && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
COPY db/ ./db/
RUN chmod +x db/run.sh
CMD bash -c "bash db/run.sh && uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}"
