begin;

-- Detail načítá pouze několik nejnovějších aktivních chyb. Původní frontový
-- index nepokrýval needs_review ani řazení podle posledního pokusu, takže mohl
-- PostgreSQL při souběžné práci workerů zvolit drahý průchod celé tabulky.
create index if not exists cpo_target_lookups_active_error_detail_idx
  on public.complete_power_outage_target_lookups (
    provider,
    last_attempt_at desc,
    lookup_status,
    id
  )
  include (
    target_id,
    attempt_count,
    next_attempt_at,
    last_error_code,
    last_error_message
  )
  where lookup_status in ('error', 'needs_review');

-- Statistiky planneru se po vytvoření částečného indexu aktualizují hned;
-- nejde o změnu žádného záznamu fronty.
analyze public.complete_power_outage_target_lookups;

commit;
