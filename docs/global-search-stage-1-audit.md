# Global Search Stage 1 Audit

This document captures current section-level query parameter conventions and agreed behavior for the upcoming dashboard global search.

## Agreed behavior

- Search label: `HLEDAT`
- Placement: dashboard header (desktop only), left of `NOTIFIKACE`
- Shortcut: `Cmd/Ctrl + K`
- Trigger: live search while typing
- Debounce: `300ms`
- Minimum query length: `3`
- Result mode: inline on dashboard (replace dashboard content while active query is present)
- Per section: show top `10` + `ZOBRAZIT VŠE`
- Permissions: hide sections completely if user has no access; enforce existing app permissions 1:1
- URL behavior: do not sync query into dashboard URL

## Show-all route mapping

- Klienti -> `/clients?q=...`
- Úkoly -> `/tasks?search=...`
- Schůzky -> `/meetings?search=...`
- Nabídky -> `/offers?q=...`
- Zakázky -> `/jobs?q=...`
- Portál zakázek -> `/jobs-portal?q=...`
- Faktury -> `/faktury?q=...`
- Notifikace -> `/notifications?search=...`

## Notes

- Fulltext + typo tolerance is planned for implementation stages.
- This stage introduces only non-wired scaffolding; no runtime behavior changes.
- DB hardening scripts are prepared in:
  - `database/global-search-logs.sql`
  - `database/global-search-hardening.sql`
