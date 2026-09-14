begin;

-- Funkcni indexy nad public.clients vyhodnocuji obe normalizacni funkce pri
-- kazdem INSERT/UPDATE. Aplikacni role je proto musi smet spustit. Funkce jsou
-- immutable, zpracovavaji jen predany text a nectou zadna soukroma data.
do $$
begin
  if to_regprocedure(
    'public.complete_power_outage_normalize_client_name(text)'
  ) is null
     or to_regprocedure(
       'public.complete_power_outage_normalize_client_ico(text)'
     ) is null then
    raise exception 'Chybi normalizacni funkce pouzivane indexy tabulky clients.';
  end if;

  if to_regclass('public.clients_complete_normalized_name_idx') is null
     or to_regclass('public.clients_complete_normalized_ico_idx') is null then
    raise exception 'Chybi funkcni indexy tabulky clients.';
  end if;
end
$$;

revoke all on function public.complete_power_outage_normalize_client_name(text)
  from public, anon;
revoke all on function public.complete_power_outage_normalize_client_ico(text)
  from public, anon;

grant execute on function public.complete_power_outage_normalize_client_name(text)
  to authenticated, service_role;
grant execute on function public.complete_power_outage_normalize_client_ico(text)
  to authenticated, service_role;

commit;
