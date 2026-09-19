# denied. backend

This FastAPI service records privacy-safe safety decisions in Tiger Cloud. It deliberately does **not** accept or store page text, URLs, screenshots, form values, or candidate payloads.

## Setup

Copy the repository's `.env.example` to `.env` and set real values. Then install and run with uv:

```powershell
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Initialize the Tiger Cloud schema once:

```powershell
Get-Content schema.sql | uv run python -c "import os, sys, psycopg; c=psycopg.connect(os.environ['TIGER_DATABASE_URL']); c.execute(sys.stdin.read()); c.commit()"
```

`POST /decisions` is for the trusted judgment service after it has received and validated Jev scores. It is not an endpoint for arbitrary page scripts. Send `X-Backend-Token` with the configured `BACKEND_API_TOKEN`.

The browser reports what happened after a decision through `POST /outcomes`. The backend returns aggregate metrics at `GET /metrics`.
