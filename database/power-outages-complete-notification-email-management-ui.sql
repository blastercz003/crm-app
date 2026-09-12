begin;

-- Krok 10.7: admin-only read/write kontrakt pro panel EMAILY.
-- UI umi schvalovat konkretni oznameni, spravovat omezeny allowlist a
-- potvrdit incident. Neobsahuje zadne zapnuti LIVE rezimu ani odesilani.
do $$
declare missing_dependencies text[] := array[]::text[];
begin
  if to_regprocedure('public.get_cpo_notification_email_pilot_review_v1(integer)') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot review workspace');
  end if;
  if to_regprocedure('public.get_cpo_notification_email_pilot_allowlist_v1(integer)') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot allowlist workspace');
  end if;
  if to_regprocedure('public.get_cpo_notification_email_pilot_rate_summary_v1()') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot rate summary');
  end if;
  if to_regprocedure('public.get_cpo_notification_email_pilot_safety_summary_v1()') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot safety summary');
  end if;
  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro panel EMAILY KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create or replace function public.get_cpo_notification_email_management_v1(
  requested_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Panel EMAILY je dostupny pouze administratorum.';
  end if;
  if requested_limit < 1 or requested_limit > 100 then
    raise exception 'Limit prehledu musi byt mezi 1 a 100.';
  end if;

  return jsonb_build_object(
    'contract', 'complete-notification-email-management-ui-v1',
    'adminOnly', true,
    'liveActivationAvailable', false,
    'review', public.get_cpo_notification_email_pilot_review_v1(requested_limit),
    'allowlist', public.get_cpo_notification_email_pilot_allowlist_v1(requested_limit),
    'rateLimit', public.get_cpo_notification_email_pilot_rate_summary_v1(),
    'safety', public.get_cpo_notification_email_pilot_safety_summary_v1()
  );
end;
$$;

revoke all on function public.get_cpo_notification_email_management_v1(integer)
  from public, anon;
grant execute on function public.get_cpo_notification_email_management_v1(integer)
  to authenticated, service_role;

update public.complete_power_outage_notification_email_pilot_allowlist_state
set ui_enabled = true,
    metadata = metadata || jsonb_build_object(
      'managementUiEnabled', true,
      'managementUiContract', 'complete-notification-email-management-ui-v1',
      'liveActivationAvailable', false,
      'activatedAt', now()
    ),
    updated_at = now()
where singleton;

update public.complete_power_outage_notification_email_state
set metadata = metadata || jsonb_build_object(
      'pilotReviewUiEnabled', true,
      'pilotAllowlistUiEnabled', true,
      'pilotSafetyUiEnabled', true,
      'pilotRateLimitUiEnabled', true,
      'emailManagementUiEnabled', true,
      'emailManagementUiAudience', 'admin',
      'emailManagementUiContract', 'complete-notification-email-management-ui-v1',
      'liveActivationAvailable', false,
      'emailManagementUiActivatedAt', now()
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

commit;
