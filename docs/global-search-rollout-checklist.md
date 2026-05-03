# Global Search Rollout Checklist

## 1) DB migration order

1. Apply `database/global-search-logs.sql`
2. Apply `database/global-search-hardening.sql`

## 2) Pre-release validation

1. Open `/dashboard` on desktop.
2. Verify header layout is unchanged (logo, NOTIFIKACE, user panel positions).
3. Verify search input is visible only on desktop.
4. Press `Cmd/Ctrl + K` -> input receives focus.
5. Type 2 chars -> dashboard content stays unchanged.
6. Type 3+ chars -> global search blocks replace dashboard content.
7. Clear query to <3 chars -> dashboard content returns.

## 3) Section behavior validation

Check each visible section:

1. `ZOBRAZIT VŠE` links use expected query params.
2. Clicking result opens detail (or filtered list where intended).
3. Empty section shows `Nic nenalezeno.`

## 4) Permissions validation

1. Admin account: sees all allowed sections.
2. Non-admin account: only sees sections currently permitted by app rules.
3. No unauthorized section/data appears in results.

## 5) Telemetry validation

After running several searches + clicks:

1. Confirm inserts exist in `public.global_search_logs`.
2. Confirm both event types appear: `query`, `click`.
3. Confirm payload contains query/latency/section metadata.

## 6) Rollback plan

If any issue appears:

1. Set `GLOBAL_SEARCH_FEATURE_ENABLED = false` in `src/lib/global-search/config.ts`.
2. Redeploy app.
3. Keep DB objects in place (non-destructive, safe to retain).

## 7) Post-release monitoring (first 48h)

1. Check API error rate for `/api/global-search` and `/api/global-search/click`.
2. Watch median/95p search latency.
3. Review most frequent queries with no-click patterns for relevance tuning.
