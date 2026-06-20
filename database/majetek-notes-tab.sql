update public.asset_categories
set tabs_config = '["overview","insurance","stk","service","repairs","documents","photos"]'::jsonb
where name = 'Osobní vozy';

update public.asset_categories
set tabs_config = '["overview","insurance","rent","documents","photos","repairs"]'::jsonb
where name in ('Domy', 'Byty');

update public.asset_categories
set tabs_config = '["overview","insurance","service","repairs","documents","photos"]'::jsonb
where name = 'Elektronika';
