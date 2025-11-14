# backend/app/workers/celery_app.py
from __future__ import annotations

import os, sys
_THIS = os.path.abspath(__file__)
_APP_DIR = os.path.dirname(os.path.dirname(_THIS))     # .../backend/app
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

import os
from celery import Celery

# ------------------------------
# Broker / Backend URL
# ------------------------------
BROKER_URL = (
    os.getenv("CELERY_BROKER_URL")
    or os.getenv("REDIS_URL")
    or "redis://localhost:6379/0"
)
RESULT_BACKEND = (
    os.getenv("CELERY_RESULT_BACKEND")
    or os.getenv("REDIS_URL")
    or "redis://localhost:6379/0"
)

# ------------------------------
# Celery Instance
# ------------------------------
celery = Celery(
    "sumflow",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
    include=["workers.tasks"],
)

# ------------------------------
# Config Defaults
# ------------------------------
celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Seoul",
    enable_utc=False,
)

# ------------------------------
# Extra Config (from .env)
# ------------------------------
# 1) 재연결 자동 시도
if str(os.getenv("broker_connection_retry_on_startup", "true")).lower() == "true":
    celery.conf.broker_connection_retry_on_startup = True

# 2) result_expires 설정 (초 단위)
_res_exp = os.getenv("CELERY_RESULT_EXPIRES")
if _res_exp and _res_exp.isdigit():
    celery.conf.result_expires = int(_res_exp)

# 3) Prefetch / Ack / Visibility Timeout 등 확장 가능성
_prefetch = os.getenv("CELERYD_PREFETCH_MULTIPLIER")
if _prefetch and _prefetch.isdigit():
    celery.conf.worker_prefetch_multiplier = int(_prefetch)

# ------------------------------
# Task Auto-discovery
# ------------------------------
celery.autodiscover_tasks(["workers.tasks"])

# ------------------------------
# Export Alias (for import consistency)
# ------------------------------
celery_app = celery
