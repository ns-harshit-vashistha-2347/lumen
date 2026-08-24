#!/bin/sh
# Single-container entrypoint for Hugging Face Spaces (one process group,
# port 7860). Runs migrations, starts a Celery worker in the background,
# then hands off to uvicorn as PID 1.

set -e

echo "==> alembic upgrade head"
alembic upgrade head

echo "==> starting celery worker (background)"
celery -A src.celery_app worker \
    -Q ingestion \
    -n ingestion_worker@%h \
    --concurrency=2 \
    --loglevel=info &

echo "==> starting uvicorn on :7860"
exec uvicorn main:app --host 0.0.0.0 --port 7860 --workers 1
