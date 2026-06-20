alter table public.asset_document_types
  add column if not exists tabs_config jsonb not null default '[]'::jsonb;

update public.asset_document_types
set tabs_config = case name
  when 'Kupní smlouva' then '[]'::jsonb
  when 'Pojistná smlouva' then '["insurance"]'::jsonb
  when 'STK' then '["stk"]'::jsonb
  when 'Servis' then '["service"]'::jsonb
  when 'Revize' then '["service"]'::jsonb
  when 'Nájemní smlouva' then '["rent"]'::jsonb
  when 'Faktura' then '["service"]'::jsonb
  when 'Fotodokumentace' then '["photos"]'::jsonb
  when 'Jiné' then '[]'::jsonb
  else tabs_config
end;
