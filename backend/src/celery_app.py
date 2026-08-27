from celery import Celery

from src.core.config import settings


celery_app = Celery(
    settings.PROJECT_NAME,
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "src.tasks.ingestion_tasks",
        "src.tasks.code_ingestion_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="ingestion",
    task_routes={
        "ingest_document_task": {"queue": "ingestion"},
        "ingest_repo_task": {"queue": "ingestion"},
        "reindex_repo_task": {"queue": "ingestion"},
    },
)