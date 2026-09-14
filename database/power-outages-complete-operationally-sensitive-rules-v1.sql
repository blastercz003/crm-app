begin;

-- KROK 2 / PROVOZNE CITLIVE v1
-- Neveřejná deterministická matice pravidel. V tomto kroku se nevytváří
-- selector, nemění se stránka, kontakty ani plánování/odesílání e-mailů.
do $$
begin
  if to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regclass('public.complete_power_outage_company_evidence') is null
  then
    raise exception 'Chybí závislosti pro pravidla PROVOZNĚ CITLIVÉ v1.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_operational_sensitivity_state (
  singleton boolean primary key default true check (singleton),
  rules_version integer not null default 1 check (rules_version > 0),
  rules_prepared boolean not null default false,
  shadow_enabled boolean not null default false,
  selector_enabled boolean not null default false,
  ui_enabled boolean not null default false,
  contact_selector_enabled boolean not null default false,
  notification_selector_enabled boolean not null default false,
  confirmed_only boolean not null default true check (confirmed_only),
  current_outages_only boolean not null default true check (current_outages_only),
  eligible_business_only boolean not null default true check (eligible_business_only),
  mapy_absence_is_negative boolean not null default false check (not mapy_absence_is_negative),
  unknown_employee_size_is_negative boolean not null default false
    check (not unknown_employee_size_is_negative),
  manual_review_required boolean not null default false check (not manual_review_required),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.complete_power_outage_operational_sensitivity_state (
  singleton,
  rules_version,
  rules_prepared,
  shadow_enabled,
  selector_enabled,
  ui_enabled,
  contact_selector_enabled,
  notification_selector_enabled,
  confirmed_only,
  current_outages_only,
  eligible_business_only,
  mapy_absence_is_negative,
  unknown_employee_size_is_negative,
  manual_review_required,
  metadata
)
values (
  true,
  1,
  true,
  false,
  false,
  false,
  false,
  false,
  true,
  true,
  true,
  false,
  false,
  false,
  jsonb_build_object(
    'contract', 'complete-operational-sensitivity-rules-v1',
    'mapyRole', 'positive_or_exclusionary_site_evidence_only',
    'missingMapyDisposition', 'neutral',
    'missingEmployeeCategoryDisposition', 'neutral',
    'googleUsed', false,
    'visibleScoreUsed', false
  )
)
on conflict (singleton) do update
set
  rules_version = excluded.rules_version,
  rules_prepared = excluded.rules_prepared,
  confirmed_only = excluded.confirmed_only,
  current_outages_only = excluded.current_outages_only,
  eligible_business_only = excluded.eligible_business_only,
  mapy_absence_is_negative = excluded.mapy_absence_is_negative,
  unknown_employee_size_is_negative = excluded.unknown_employee_size_is_negative,
  manual_review_required = excluded.manual_review_required,
  metadata = excluded.metadata,
  updated_at = now();

create table if not exists public.complete_power_outage_operational_sensitivity_rules (
  rule_key text primary key,
  rules_version integer not null default 1 check (rules_version > 0),
  category text not null check (category in (
    'food_and_cold_chain',
    'continuous_industry',
    'automotive_manufacturing',
    'critical_healthcare',
    'residential_care',
    'data_and_telecom',
    'water_and_wastewater',
    'livestock',
    'temperature_controlled_logistics',
    'large_hospitality_and_gastro',
    'emergency_services',
    'excluded_automotive_service',
    'excluded_small_healthcare',
    'excluded_ordinary_public_or_nonprofit'
  )),
  evidence_source text not null check (evidence_source in (
    'ares_primary_nace',
    'ares_any_nace',
    'mapy_exact_label',
    'company_name'
  )),
  match_operator text not null check (match_operator in ('prefix', 'exact', 'regex')),
  match_value text not null check (btrim(match_value) <> ''),
  effect text not null check (effect in ('include', 'conditional_include', 'support', 'exclude')),
  priority integer not null check (priority between 1 and 1000),
  minimum_employee_count integer check (minimum_employee_count is null or minimum_employee_count > 0),
  requires_exact_site_evidence boolean not null default false,
  requires_mapy_evidence boolean not null default false check (not requires_mapy_evidence),
  active boolean not null default true,
  rationale text not null check (btrim(rationale) <> ''),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_operational_rule_shape_check check (
    (evidence_source = 'mapy_exact_label' and match_operator = 'exact'
      and requires_exact_site_evidence)
    or (evidence_source in ('ares_primary_nace', 'ares_any_nace')
      and match_operator = 'prefix' and match_value ~ '^[0-9]{2,5}$')
    or (evidence_source = 'company_name' and match_operator = 'regex')
  ),
  constraint cpo_operational_rule_employee_check check (
    effect = 'conditional_include' or minimum_employee_count is null
  )
);

create index if not exists cpo_operational_rules_match_idx
  on public.complete_power_outage_operational_sensitivity_rules (
    rules_version, evidence_source, effect, active, priority desc
  );

-- Přímé zařazení podle převažujícího NACE. Prefixy jsou zvoleny tak, aby
-- pracovaly s uloženými variantami CZ-NACE 2008 i 2025.
insert into public.complete_power_outage_operational_sensitivity_rules (
  rule_key, category, evidence_source, match_operator, match_value,
  effect, priority, minimum_employee_count, requires_exact_site_evidence,
  rationale
)
values
  ('nace-primary-food-10', 'food_and_cold_chain', 'ares_primary_nace', 'prefix', '10', 'include', 700, null, false, 'Výroba potravin.'),
  ('nace-primary-beverage-11', 'food_and_cold_chain', 'ares_primary_nace', 'prefix', '11', 'include', 700, null, false, 'Výroba nápojů.'),
  ('nace-primary-paper-17', 'continuous_industry', 'ares_primary_nace', 'prefix', '17', 'include', 680, null, false, 'Technologická výroba papíru a výrobků z papíru.'),
  ('nace-primary-chemical-20', 'continuous_industry', 'ares_primary_nace', 'prefix', '20', 'include', 720, null, false, 'Chemická výroba.'),
  ('nace-primary-pharma-21', 'continuous_industry', 'ares_primary_nace', 'prefix', '21', 'include', 730, null, false, 'Farmaceutická výroba.'),
  ('nace-primary-rubber-plastic-22', 'continuous_industry', 'ares_primary_nace', 'prefix', '22', 'include', 700, null, false, 'Výroba pryžových a plastových výrobků.'),
  ('nace-primary-glass-mineral-23', 'continuous_industry', 'ares_primary_nace', 'prefix', '23', 'include', 720, null, false, 'Výroba skla a ostatních nekovových minerálních výrobků.'),
  ('nace-primary-metals-24', 'continuous_industry', 'ares_primary_nace', 'prefix', '24', 'include', 730, null, false, 'Hutnictví a výroba kovů.'),
  ('nace-primary-electronics-26', 'continuous_industry', 'ares_primary_nace', 'prefix', '26', 'include', 700, null, false, 'Výroba elektroniky a optických přístrojů.'),
  ('nace-primary-electrical-27', 'continuous_industry', 'ares_primary_nace', 'prefix', '27', 'include', 700, null, false, 'Výroba elektrických zařízení.'),
  ('nace-primary-machinery-28', 'continuous_industry', 'ares_primary_nace', 'prefix', '28', 'include', 680, null, false, 'Výroba strojů a zařízení.'),
  ('nace-primary-automotive-29', 'automotive_manufacturing', 'ares_primary_nace', 'prefix', '29', 'include', 800, null, false, 'Výroba motorových vozidel a jejich dílů.'),
  ('nace-primary-water-36', 'water_and_wastewater', 'ares_primary_nace', 'prefix', '36', 'include', 800, null, false, 'Výroba a rozvod vody.'),
  ('nace-primary-wastewater-37', 'water_and_wastewater', 'ares_primary_nace', 'prefix', '37', 'include', 800, null, false, 'Odvádění a čištění odpadních vod.'),
  ('nace-primary-telecom-61', 'data_and_telecom', 'ares_primary_nace', 'prefix', '61', 'include', 760, null, false, 'Telekomunikační provoz.'),
  ('nace-primary-data-centres-6311', 'data_and_telecom', 'ares_primary_nace', 'prefix', '6311', 'include', 820, null, false, 'Datová centra, hosting a související infrastruktura.'),
  ('nace-primary-hospital-861', 'critical_healthcare', 'ares_primary_nace', 'prefix', '861', 'include', 900, null, false, 'Ústavní nemocniční péče.'),
  ('nace-primary-care-871', 'residential_care', 'ares_primary_nace', 'prefix', '871', 'include', 790, null, false, 'Pobytová ošetřovatelská péče.'),
  ('nace-primary-care-872', 'residential_care', 'ares_primary_nace', 'prefix', '872', 'include', 790, null, false, 'Pobytová péče pro osoby vyžadující trvalý provoz.'),
  ('nace-primary-care-873', 'residential_care', 'ares_primary_nace', 'prefix', '873', 'include', 790, null, false, 'Pobytová péče pro seniory a osoby se zdravotním postižením.'),
  ('nace-primary-cattle-0141', 'livestock', 'ares_primary_nace', 'prefix', '0141', 'include', 700, null, false, 'Chov skotu závislý na provozních technologiích.'),
  ('nace-primary-other-cattle-0142', 'livestock', 'ares_primary_nace', 'prefix', '0142', 'include', 700, null, false, 'Chov ostatního skotu.'),
  ('nace-primary-sheep-goats-0145', 'livestock', 'ares_primary_nace', 'prefix', '0145', 'include', 680, null, false, 'Chov ovcí a koz.'),
  ('nace-primary-pigs-0146', 'livestock', 'ares_primary_nace', 'prefix', '0146', 'include', 740, null, false, 'Chov prasat se závislostí na ventilaci a krmení.'),
  ('nace-primary-poultry-0147', 'livestock', 'ares_primary_nace', 'prefix', '0147', 'include', 760, null, false, 'Chov drůbeže se závislostí na ventilaci a vytápění.'),
  ('nace-primary-other-animals-0149', 'livestock', 'ares_primary_nace', 'prefix', '0149', 'include', 660, null, false, 'Ostatní chovy zvířat.'),
  ('nace-primary-police-8424', 'emergency_services', 'ares_primary_nace', 'prefix', '8424', 'include', 880, null, false, 'Policie a veřejná bezpečnost.'),
  ('nace-primary-fire-8425', 'emergency_services', 'ares_primary_nace', 'prefix', '8425', 'include', 880, null, false, 'Požární ochrana a záchranný provoz.')
on conflict (rule_key) do update
set category = excluded.category,
    evidence_source = excluded.evidence_source,
    match_operator = excluded.match_operator,
    match_value = excluded.match_value,
    effect = excluded.effect,
    priority = excluded.priority,
    minimum_employee_count = excluded.minimum_employee_count,
    requires_exact_site_evidence = excluded.requires_exact_site_evidence,
    rationale = excluded.rationale,
    active = true,
    updated_at = now();

-- Obory, u kterých samotný typ nestačí: zařazení bude v kroku 3 vyžadovat
-- alespoň uvedenou dolní mez kategorie zaměstnanců. Neznámá velikost není
-- negativní důkaz; pouze se neuplatní tato konkrétní podmíněná cesta.
insert into public.complete_power_outage_operational_sensitivity_rules (
  rule_key, category, evidence_source, match_operator, match_value,
  effect, priority, minimum_employee_count, requires_exact_site_evidence,
  rationale
)
values
  ('nace-primary-textile-13-sized', 'continuous_industry', 'ares_primary_nace', 'prefix', '13', 'conditional_include', 620, 25, false, 'Větší textilní výroba.'),
  ('nace-primary-wood-16-sized', 'continuous_industry', 'ares_primary_nace', 'prefix', '16', 'conditional_include', 620, 25, false, 'Větší dřevozpracující výroba.'),
  ('nace-primary-fabricated-metal-25-sized', 'continuous_industry', 'ares_primary_nace', 'prefix', '25', 'conditional_include', 640, 25, false, 'Větší kovovýroba.'),
  ('nace-primary-other-transport-30-sized', 'continuous_industry', 'ares_primary_nace', 'prefix', '30', 'conditional_include', 640, 25, false, 'Větší výroba ostatních dopravních prostředků.'),
  ('nace-primary-other-manufacturing-32-sized', 'continuous_industry', 'ares_primary_nace', 'prefix', '32', 'conditional_include', 610, 25, false, 'Větší ostatní technologická výroba.'),
  ('nace-primary-waste-treatment-382-sized', 'continuous_industry', 'ares_primary_nace', 'prefix', '382', 'conditional_include', 600, 25, false, 'Větší zařízení pro zpracování a odstraňování odpadu.'),
  ('nace-primary-warehouse-5210-sized', 'temperature_controlled_logistics', 'ares_primary_nace', 'prefix', '5210', 'conditional_include', 610, 50, false, 'Větší skladovací provoz; chladový řetězec může potvrdit další důkaz.'),
  ('nace-primary-hotel-551-sized', 'large_hospitality_and_gastro', 'ares_primary_nace', 'prefix', '551', 'conditional_include', 610, 25, false, 'Větší hotelový provoz.'),
  ('nace-primary-restaurant-561-sized', 'large_hospitality_and_gastro', 'ares_primary_nace', 'prefix', '561', 'conditional_include', 590, 50, false, 'Pouze větší restaurační provoz.'),
  ('nace-primary-catering-562-sized', 'large_hospitality_and_gastro', 'ares_primary_nace', 'prefix', '562', 'conditional_include', 620, 50, false, 'Pouze větší cateringový nebo závodní stravovací provoz.'),
  ('nace-primary-food-retail-4711-sized', 'food_and_cold_chain', 'ares_primary_nace', 'prefix', '4711', 'conditional_include', 600, 50, false, 'Pouze větší prodejna potravin se závislostí na chlazení.')
on conflict (rule_key) do update
set category = excluded.category,
    evidence_source = excluded.evidence_source,
    match_operator = excluded.match_operator,
    match_value = excluded.match_value,
    effect = excluded.effect,
    priority = excluded.priority,
    minimum_employee_count = excluded.minimum_employee_count,
    requires_exact_site_evidence = excluded.requires_exact_site_evidence,
    rationale = excluded.rationale,
    active = true,
    updated_at = now();

-- Vedlejší NACE nikdy nezařadí firmu samo. Slouží pouze jako podpůrný
-- důkaz pro přesně potvrzenou provozovnu a další pozitivní signál.
insert into public.complete_power_outage_operational_sensitivity_rules (
  rule_key, category, evidence_source, match_operator, match_value,
  effect, priority, minimum_employee_count, requires_exact_site_evidence,
  rationale
)
values
  ('nace-any-food', 'food_and_cold_chain', 'ares_any_nace', 'prefix', '10', 'support', 300, null, false, 'Vedlejší potravinářská činnost.'),
  ('nace-any-beverage', 'food_and_cold_chain', 'ares_any_nace', 'prefix', '11', 'support', 300, null, false, 'Vedlejší výroba nápojů.'),
  ('nace-any-automotive', 'automotive_manufacturing', 'ares_any_nace', 'prefix', '29', 'support', 360, null, false, 'Vedlejší automotive výrobní činnost.'),
  ('nace-any-water', 'water_and_wastewater', 'ares_any_nace', 'prefix', '36', 'support', 350, null, false, 'Vedlejší vodárenská činnost.'),
  ('nace-any-wastewater', 'water_and_wastewater', 'ares_any_nace', 'prefix', '37', 'support', 350, null, false, 'Vedlejší kanalizační a čistírenská činnost.'),
  ('nace-any-hospital', 'critical_healthcare', 'ares_any_nace', 'prefix', '861', 'support', 380, null, false, 'Vedlejší nemocniční činnost.'),
  ('nace-any-other-health', 'critical_healthcare', 'ares_any_nace', 'prefix', '869', 'support', 260, null, false, 'Jiná zdravotní péče vyžaduje konkrétní důkaz kritického provozu.'),
  ('nace-any-data-centres', 'data_and_telecom', 'ares_any_nace', 'prefix', '6311', 'support', 380, null, false, 'Vedlejší datová infrastruktura.'),
  ('nace-any-mixed-farming', 'livestock', 'ares_any_nace', 'prefix', '015', 'support', 250, null, false, 'Smíšené hospodářství samo nedokládá technologicky závislý chov.'),
  ('nace-any-warehousing', 'temperature_controlled_logistics', 'ares_any_nace', 'prefix', '5210', 'support', 270, null, false, 'Skladování samo nedokládá teplotní režim.')
on conflict (rule_key) do update
set category = excluded.category,
    evidence_source = excluded.evidence_source,
    match_operator = excluded.match_operator,
    match_value = excluded.match_value,
    effect = excluded.effect,
    priority = excluded.priority,
    minimum_employee_count = excluded.minimum_employee_count,
    requires_exact_site_evidence = excluded.requires_exact_site_evidence,
    rationale = excluded.rationale,
    active = true,
    updated_at = now();

-- Výslovné oborové výluky. Vyšší prioritu mají pouze přesně definované
-- výjimky 8424/8425 pro bezpečnostní a záchranné složky.
insert into public.complete_power_outage_operational_sensitivity_rules (
  rule_key, category, evidence_source, match_operator, match_value,
  effect, priority, minimum_employee_count, requires_exact_site_evidence,
  rationale
)
values
  ('nace-primary-auto-sale-451', 'excluded_automotive_service', 'ares_primary_nace', 'prefix', '451', 'exclude', 840, null, false, 'Prodej motorových vozidel není automotive výroba.'),
  ('nace-primary-auto-repair-452', 'excluded_automotive_service', 'ares_primary_nace', 'prefix', '452', 'exclude', 850, null, false, 'Autoservis a opravy vozidel jsou výslovně vyloučeny.'),
  ('nace-primary-auto-parts-sale-453', 'excluded_automotive_service', 'ares_primary_nace', 'prefix', '453', 'exclude', 840, null, false, 'Prodej autodílů není automotive výroba.'),
  ('nace-primary-motorcycle-sale-repair-454', 'excluded_automotive_service', 'ares_primary_nace', 'prefix', '454', 'exclude', 840, null, false, 'Prodej a opravy motocyklů jsou vyloučeny.'),
  ('nace-primary-new-auto-repair-9531', 'excluded_automotive_service', 'ares_primary_nace', 'prefix', '9531', 'exclude', 850, null, false, 'Opravy motorových vozidel v nové klasifikaci jsou vyloučeny.'),
  ('nace-primary-general-practice-8621', 'excluded_small_healthcare', 'ares_primary_nace', 'prefix', '8621', 'exclude', 850, null, false, 'Běžná praktická ambulance.'),
  ('nace-primary-specialist-practice-8622', 'excluded_small_healthcare', 'ares_primary_nace', 'prefix', '8622', 'exclude', 850, null, false, 'Běžná specializovaná ambulance bez dalšího kritického důkazu.'),
  ('nace-primary-dental-practice-8623', 'excluded_small_healthcare', 'ares_primary_nace', 'prefix', '8623', 'exclude', 850, null, false, 'Stomatologická ambulance.'),
  ('nace-primary-education-85', 'excluded_ordinary_public_or_nonprofit', 'ares_primary_nace', 'prefix', '85', 'exclude', 800, null, false, 'Běžná vzdělávací instituce není sama o sobě provozně citlivá.'),
  ('nace-primary-public-admin-84', 'excluded_ordinary_public_or_nonprofit', 'ares_primary_nace', 'prefix', '84', 'exclude', 780, null, false, 'Běžná veřejná správa; 8424 a 8425 mají vyšší prioritu jako výjimky.'),
  ('nace-primary-associations-94', 'excluded_ordinary_public_or_nonprofit', 'ares_primary_nace', 'prefix', '94', 'exclude', 800, null, false, 'Spolky, církevní a členské organizace jsou vyloučeny.')
on conflict (rule_key) do update
set category = excluded.category,
    evidence_source = excluded.evidence_source,
    match_operator = excluded.match_operator,
    match_value = excluded.match_value,
    effect = excluded.effect,
    priority = excluded.priority,
    minimum_employee_count = excluded.minimum_employee_count,
    requires_exact_site_evidence = excluded.requires_exact_site_evidence,
    rationale = excluded.rationale,
    active = true,
    updated_at = now();

-- Mapy.com může rozhodnutí pouze doplnit u důkazu exact_address nebo
-- same_building. Jeho absence není nikde vyjádřena jako pravidlo.
insert into public.complete_power_outage_operational_sensitivity_rules (
  rule_key, category, evidence_source, match_operator, match_value,
  effect, priority, minimum_employee_count, requires_exact_site_evidence,
  rationale
)
values
  ('mapy-hospital', 'critical_healthcare', 'mapy_exact_label', 'exact', 'Nemocniční pavilon, oddělení', 'include', 930, null, true, 'Jednoznačný nemocniční provoz.'),
  ('mapy-laboratory', 'critical_healthcare', 'mapy_exact_label', 'exact', 'Laboratoře', 'include', 900, null, true, 'Laboratorní provoz se závislostí na přístrojích a vzorcích.'),
  ('mapy-senior-home', 'residential_care', 'mapy_exact_label', 'exact', 'Domov pro seniory', 'include', 900, null, true, 'Pobytová péče s nepřetržitým provozem.'),
  ('mapy-food-production', 'food_and_cold_chain', 'mapy_exact_label', 'exact', 'Výroba potravin', 'include', 720, null, true, 'Přímý důkaz potravinářské výroby.'),
  ('mapy-bakery', 'food_and_cold_chain', 'mapy_exact_label', 'exact', 'Pekařství', 'include', 690, null, true, 'Pekařská výroba.'),
  ('mapy-butcher', 'food_and_cold_chain', 'mapy_exact_label', 'exact', 'Řeznictví, uzenářství', 'include', 710, null, true, 'Masná výroba a chlazení.'),
  ('mapy-brewery', 'food_and_cold_chain', 'mapy_exact_label', 'exact', 'Pivovar', 'include', 700, null, true, 'Technologická výroba nápojů.'),
  ('mapy-water-station', 'water_and_wastewater', 'mapy_exact_label', 'exact', 'Vodoměrná stanice, vodočet', 'support', 360, null, true, 'Doplňkový důkaz vodárenské infrastruktury.'),
  ('mapy-firefighters', 'emergency_services', 'mapy_exact_label', 'exact', 'Hasiči', 'include', 760, null, true, 'Záchranný provoz.'),
  ('mapy-police', 'emergency_services', 'mapy_exact_label', 'exact', 'Policie', 'include', 760, null, true, 'Bezpečnostní provoz.'),
  ('mapy-municipal-police', 'emergency_services', 'mapy_exact_label', 'exact', 'Policie městská', 'include', 740, null, true, 'Bezpečnostní provoz.'),
  ('mapy-generic-production', 'continuous_industry', 'mapy_exact_label', 'exact', 'Výroba', 'support', 340, null, true, 'Obecný výrobní štítek vyžaduje další oborový důkaz.'),
  ('mapy-metal-production', 'continuous_industry', 'mapy_exact_label', 'exact', 'Kovovýroba a úprava povrchů', 'support', 390, null, true, 'Konkrétní výrobní doplněk.'),
  ('mapy-building-material-production', 'continuous_industry', 'mapy_exact_label', 'exact', 'Výroba stavebnin', 'support', 390, null, true, 'Konkrétní výrobní doplněk.'),
  ('mapy-electrical-production', 'continuous_industry', 'mapy_exact_label', 'exact', 'Výroba elektrotechniky', 'support', 390, null, true, 'Konkrétní výrobní doplněk.'),
  ('mapy-auto-service', 'excluded_automotive_service', 'mapy_exact_label', 'exact', 'Autoservis', 'exclude', 830, null, true, 'Výslovně vyloučený autoservis.'),
  ('mapy-auto-wash', 'excluded_automotive_service', 'mapy_exact_label', 'exact', 'Automyčka', 'exclude', 820, null, true, 'Automyčka není automotive výroba.'),
  ('mapy-auto-services', 'excluded_automotive_service', 'mapy_exact_label', 'exact', 'Auto-moto služby', 'exclude', 820, null, true, 'Auto-moto služby nejsou automotive výroba.'),
  ('mapy-vehicle-inspection', 'excluded_automotive_service', 'mapy_exact_label', 'exact', 'Stanice technické kontroly', 'exclude', 820, null, true, 'STK není automotive výroba.'),
  ('mapy-doctor', 'excluded_small_healthcare', 'mapy_exact_label', 'exact', 'Lékař', 'exclude', 820, null, true, 'Běžná ordinace.'),
  ('mapy-eye-practice', 'excluded_small_healthcare', 'mapy_exact_label', 'exact', 'Oční ordinace', 'exclude', 820, null, true, 'Běžná oční ordinace.'),
  ('mapy-dental-practice', 'excluded_small_healthcare', 'mapy_exact_label', 'exact', 'Stomatologická ordinace', 'exclude', 820, null, true, 'Běžná stomatologická ordinace.'),
  ('mapy-health-advice', 'excluded_small_healthcare', 'mapy_exact_label', 'exact', 'Zdravotní poradny', 'exclude', 810, null, true, 'Poradna bez důkazu kritické technologie.'),
  ('mapy-physiotherapy', 'excluded_small_healthcare', 'mapy_exact_label', 'exact', 'Fyzioterapie', 'exclude', 810, null, true, 'Fyzioterapie bez důkazu kritické technologie.'),
  ('mapy-veterinary-practice', 'excluded_small_healthcare', 'mapy_exact_label', 'exact', 'Veterinární ordinace', 'exclude', 810, null, true, 'Běžná veterinární ordinace.'),
  ('mapy-school', 'excluded_ordinary_public_or_nonprofit', 'mapy_exact_label', 'exact', 'Škola', 'exclude', 780, null, true, 'Běžná škola.'),
  ('mapy-kindergarten', 'excluded_ordinary_public_or_nonprofit', 'mapy_exact_label', 'exact', 'Mateřská škola', 'exclude', 780, null, true, 'Běžná mateřská škola.'),
  ('mapy-office', 'excluded_ordinary_public_or_nonprofit', 'mapy_exact_label', 'exact', 'Správní úřad', 'exclude', 780, null, true, 'Běžný správní úřad.'),
  ('mapy-association', 'excluded_ordinary_public_or_nonprofit', 'mapy_exact_label', 'exact', 'Sdružení a spolky', 'exclude', 780, null, true, 'Spolek bez kritického provozu.')
on conflict (rule_key) do update
set category = excluded.category,
    evidence_source = excluded.evidence_source,
    match_operator = excluded.match_operator,
    match_value = excluded.match_value,
    effect = excluded.effect,
    priority = excluded.priority,
    minimum_employee_count = excluded.minimum_employee_count,
    requires_exact_site_evidence = excluded.requires_exact_site_evidence,
    rationale = excluded.rationale,
    active = true,
    updated_at = now();

-- Velmi úzké názvové signály pro případy, kdy ARES nemá dostatečně
-- podrobnou činnost. Nepoužívají obecná slova jako automotive nebo výroba.
insert into public.complete_power_outage_operational_sensitivity_rules (
  rule_key, category, evidence_source, match_operator, match_value,
  effect, priority, minimum_employee_count, requires_exact_site_evidence,
  rationale
)
values
  ('name-hospital', 'critical_healthcare', 'company_name', 'regex', 'nemocnic', 'include', 650, null, false, 'Jednoznačný nemocniční název.'),
  ('name-dialysis', 'critical_healthcare', 'company_name', 'regex', 'dial[yý]z', 'include', 900, null, false, 'Dialyzační provoz.'),
  ('name-laboratory', 'critical_healthcare', 'company_name', 'regex', 'laborato[rř]', 'support', 330, null, false, 'Laboratoř vyžaduje další oborový důkaz.'),
  ('name-data-centre', 'data_and_telecom', 'company_name', 'regex', '(datov.{0,3}centr|data[ -]?cent|serverovn)', 'include', 650, null, false, 'Datové centrum nebo serverovna.'),
  ('name-waterworks', 'water_and_wastewater', 'company_name', 'regex', 'vod[aá]rn', 'include', 650, null, false, 'Vodárenský provoz.'),
  ('name-wastewater-plant', 'water_and_wastewater', 'company_name', 'regex', '(čistírn|cistirn).{0,20}odpad', 'include', 670, null, false, 'Čistírna odpadních vod.'),
  ('name-freezer', 'food_and_cold_chain', 'company_name', 'regex', 'mraz[ií]rn', 'include', 660, null, false, 'Mrazírenský provoz.'),
  ('name-cold-store', 'food_and_cold_chain', 'company_name', 'regex', 'chlad[ií]rn', 'include', 660, null, false, 'Chladírenský provoz.'),
  ('name-dairy', 'food_and_cold_chain', 'company_name', 'regex', 'ml[eé]k[aá]rn', 'include', 650, null, false, 'Mlékárenský provoz.'),
  ('name-meat-plant', 'food_and_cold_chain', 'company_name', 'regex', 'masokombin[aá]t', 'include', 670, null, false, 'Masokombinát.'),
  ('name-brewery', 'food_and_cold_chain', 'company_name', 'regex', 'pivovar', 'include', 630, null, false, 'Pivovarský provoz.')
on conflict (rule_key) do update
set category = excluded.category,
    evidence_source = excluded.evidence_source,
    match_operator = excluded.match_operator,
    match_value = excluded.match_value,
    effect = excluded.effect,
    priority = excluded.priority,
    minimum_employee_count = excluded.minimum_employee_count,
    requires_exact_site_evidence = excluded.requires_exact_site_evidence,
    rationale = excluded.rationale,
    active = true,
    updated_at = now();

alter table public.complete_power_outage_operational_sensitivity_state
  enable row level security;
alter table public.complete_power_outage_operational_sensitivity_rules
  enable row level security;

revoke all on table public.complete_power_outage_operational_sensitivity_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_operational_sensitivity_rules
  from public, anon, authenticated;
grant all on table public.complete_power_outage_operational_sensitivity_state
  to service_role;
grant all on table public.complete_power_outage_operational_sensitivity_rules
  to service_role;

comment on table public.complete_power_outage_operational_sensitivity_rules is
  'Neveřejná bezbodová matice PROVOZNĚ CITLIVÉ v1. Chybějící Mapy.com důkaz je neutrální.';

commit;
