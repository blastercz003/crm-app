# Global Search Hardening

This document describes database-level hardening prepared for global search relevance and performance.

## File

- `database/global-search-hardening.sql`

## What it adds

- Enables extensions:
  - `pg_trgm`
  - `unaccent`
- Adds `GIN + trigram` indexes for key searchable columns across:
  - clients
  - tasks
  - meetings
  - offers
  - jobs
  - job_finances
  - notifications
- Adds helper function:
  - `public.global_search_normalize(text)` for future accent-insensitive ranking paths.

## Why this is safe

- Uses `create ... if not exists` where possible.
- No destructive operations.
- No runtime behavior change until SQL is applied.

## Rollout order

1. Apply `database/global-search-logs.sql`.
2. Apply `database/global-search-hardening.sql`.
3. Monitor query latency and DB CPU after rollout.

## Next optional step

- Add section-specific SQL ranking (`similarity` / fulltext) once baseline telemetry confirms target quality and latency.
