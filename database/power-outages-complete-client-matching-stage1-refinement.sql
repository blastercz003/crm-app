begin;

-- Závěrečná korekce neveřejné etapy 1 po kontrole reálných výsledků.
-- Nemění produkční vazby, stránkování, AI SELECT ani uživatelské rozhraní.
do $$
begin
  if to_regclass('public.complete_power_outage_client_match_audit') is null
     or to_regprocedure(
       'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)'
     ) is null
  then
    raise exception 'Nejprve nasaďte základ neveřejného auditu párování klientů.';
  end if;
end
$$;

-- Česká pošta a obdobné subjekty používají právní formu s.p. / státní podnik.
-- Po jejím odstranění je "Česká pošta" přesnou, nikoli fuzzy shodou.
create or replace function public.complete_power_outage_normalize_client_name(
  requested_name text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  with unaccented as (
    select lower(public.unaccent(btrim(requested_name))) as value
  ), words_only as (
    select btrim(regexp_replace(value, '[^[:alnum:]]+', ' ', 'g')) as value
    from unaccented
  ), spaces_collapsed as (
    select regexp_replace(value, '[[:space:]]+', ' ', 'g') as value
    from words_only
  ), legal_suffix_removed as (
    select btrim(regexp_replace(
      value,
      '[[:space:]]+(spol[[:space:]]+s[[:space:]]+r[[:space:]]+o|s[[:space:]]+r[[:space:]]+o|spolecnost[[:space:]]+s[[:space:]]+rucenim[[:space:]]+omezenym|a[[:space:]]+s|v[[:space:]]+o[[:space:]]+s|k[[:space:]]+s|z[[:space:]]+s|s[[:space:]]+e|s[[:space:]]+p|statni[[:space:]]+podnik)$',
      '',
      'g'
    )) as value
    from spaces_collapsed
  )
  select nullif(value, '')
  from legal_suffix_removed;
$$;

revoke all on function public.complete_power_outage_normalize_client_name(text)
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_normalize_client_name(text)
  to service_role;

-- Audit nadále sbírá širší pásmo od 0,68 pro kontrolu, ale fuzzy návrh smí
-- vzniknout až od přísné hranice 0,92. Ani návrh není produkční vazbou.
select public.refresh_complete_power_outage_client_match_audit(0.6800, 0.9200);

commit;
