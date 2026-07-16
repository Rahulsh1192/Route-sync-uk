# ── RouteSync Python media + AI worker ────────────────────────────────────────
FROM python:3.11-slim AS base
WORKDIR /app

# System deps: ffmpeg for media processing, libgomp for YOLO
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgomp1 \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 worker
USER worker

# Python deps
COPY --chown=worker:worker services/worker/requirements.txt ./
RUN pip install --user --no-cache-dir -r requirements.txt

COPY --chown=worker:worker services/worker ./

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/home/worker/.local/bin:${PATH}"

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import worker; print('ok')" || exit 1

CMD ["python", "-m", "worker.main"]
