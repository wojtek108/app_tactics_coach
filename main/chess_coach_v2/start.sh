#!/usr/bin/env bash
# Start the chess coach server.
cd "$(dirname "$0")"
exec .venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload --env-file .env
