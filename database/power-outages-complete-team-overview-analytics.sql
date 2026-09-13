begin;

-- Krok 2: jedna read-only analyticka vrstva pro budouci admin popup Prehled tymu.
-- UI ani zdrojova data tento soubor nemeni.
do $$
begin
  if to_regclass('public.complete_power_outage_company_ownership_events') is null
     or to_regclass('public.complete_power_outage_company_assignments') is null
     or to_regclass('public.complete_power_outage_communication_states') is null
     or to_regclass('public.complete_power_outage_communication_events') is null
     or to_regclass('public.complete_power_outage_communication_activity_links') is null
     or to_regclass('public.activities') is null
     or to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_addresses') is null
     or to_regclass('public.complete_power_outages') is null
     or to_regclass('public.complete_power_outage_company_scores') is null
     or to_regclass('public.complete_power_outage_company_top_selections') is null
     or to_regprocedure('public.complete_power_outage_is_large_company_v1(text)') is null
  then
    raise exception 'Chybi zavislosti pro analytiku Prehledu tymu KOMPLETNI.';
  end if;
end
$$;

create or replace function public.get_cpo_team_overview_scope_v1(
  requested_period_from timestamptz,
  requested_period_to timestamptz,
  requested_period_basis text,
  requested_owner_id uuid,
  requested_selector_key text,
  requested_source text
)
returns table (
  candidate_id uuid,
  outage_id uuid,
  company_name text,
  ico text,
  source text,
  outage_starts_at timestamptz,
  outage_ends_at timestamptz,
  current_owner_id uuid,
  current_owner_name text,
  communication_status text,
  communication_changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Prehled tymu je dostupny pouze administratorovi.' using errcode = '42501';
  end if;
  if requested_period_from is null or requested_period_to is null
     or requested_period_to <= requested_period_from then
    raise exception 'Neplatne obdobi Prehledu tymu.' using errcode = '22023';
  end if;
  if requested_period_to - requested_period_from > interval '366 days' then
    raise exception 'Prehled tymu lze nacist nejvyse za 366 dni.' using errcode = '22023';
  end if;
  if requested_period_basis not in ('activity', 'outage') then
    raise exception 'Neplatny casovy zaklad Prehledu tymu.' using errcode = '22023';
  end if;
  if requested_selector_key not in (
    'all', 'all_confirmed', 'top', 'top_v1',
    'large_companies', 'grade_a', 'grade_b'
  ) then
    raise exception 'Neplatny vyber AI SELECT.' using errcode = '22023';
  end if;
  if requested_source not in ('all', 'cez', 'egd', 'pre') then
    raise exception 'Neplatny distributor.' using errcode = '22023';
  end if;
  if requested_owner_id is not null and not exists (
    select 1 from public.profiles profile where profile.id = requested_owner_id
  ) then
    raise exception 'Vybrany uzivatel neexistuje.' using errcode = '22023';
  end if;

  return query
  select
    company.id,
    outage.id,
    company.company_name,
    company.ico,
    outage.source,
    outage.starts_at,
    outage.ends_at,
    assignment.owner_id,
    assignment.owner_name,
    coalesce(communication.communication_status, 'not_contacted'),
    communication.status_changed_at
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_assignments assignment
    on assignment.candidate_id = company.id
  left join public.complete_power_outage_communication_states communication
    on communication.candidate_id = company.id
  left join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row
    on top_row.candidate_id = company.id
  where company.candidate_status = 'confirmed'
    and company.business_relevance_status = 'eligible'
    and (requested_source = 'all' or outage.source = requested_source)
    and (
      requested_selector_key in ('all', 'all_confirmed')
      or requested_selector_key in ('top', 'top_v1')
        and coalesce(top_row.top_eligible, false)
      or requested_selector_key = 'large_companies'
        and public.complete_power_outage_is_large_company_v1(company.ico)
      or requested_selector_key = 'grade_a'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'A'
      or requested_selector_key = 'grade_b'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'B'
    )
    and (
      requested_period_basis = 'outage'
        and outage.starts_at >= requested_period_from
        and outage.starts_at < requested_period_to
      or requested_period_basis = 'activity' and (
        exists (
          select 1
          from public.complete_power_outage_communication_events event_row
          where event_row.candidate_id = company.id
            and event_row.occurred_at >= requested_period_from
            and event_row.occurred_at < requested_period_to
        )
        or exists (
          select 1
          from public.complete_power_outage_company_ownership_events ownership
          where ownership.candidate_id = company.id
            and ownership.occurred_at >= requested_period_from
            and ownership.occurred_at < requested_period_to
        )
        or exists (
          select 1
          from public.complete_power_outage_communication_activity_links link
          join public.activities activity on activity.id = link.activity_id
          where link.candidate_id = company.id
            and activity.deleted_at is null
            and coalesce(activity.completed_at, activity.scheduled_for, activity.occurred_at)
                >= requested_period_from
            and coalesce(activity.completed_at, activity.scheduled_for, activity.occurred_at)
                < requested_period_to
        )
      )
    )
    and (
      requested_owner_id is null
      or assignment.owner_id = requested_owner_id
      or exists (
        select 1
        from public.complete_power_outage_communication_events event_row
        where event_row.candidate_id = company.id
          and event_row.actor_user_id = requested_owner_id
          and event_row.occurred_at >= requested_period_from
          and event_row.occurred_at < requested_period_to
      )
      or exists (
        select 1
        from public.complete_power_outage_company_ownership_events ownership
        where ownership.candidate_id = company.id
          and requested_owner_id in (ownership.owner_id, ownership.previous_owner_id)
          and ownership.occurred_at >= requested_period_from
          and ownership.occurred_at < requested_period_to
      )
      or exists (
        select 1
        from public.complete_power_outage_communication_activity_links link
        join public.activities activity on activity.id = link.activity_id
        where link.candidate_id = company.id
          and activity.user_id = requested_owner_id
          and activity.deleted_at is null
          and coalesce(activity.completed_at, activity.scheduled_for, activity.occurred_at)
              >= requested_period_from
          and coalesce(activity.completed_at, activity.scheduled_for, activity.occurred_at)
              < requested_period_to
      )
    );
end;
$$;

comment on function public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text) is
  'Privatni jednotny filtracni kontrakt analytiky Prehledu tymu KOMPLETNI.';

revoke all on function public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)
  to service_role;

create or replace function public.get_complete_power_outage_team_overview_v1(
  requested_period_from timestamptz,
  requested_period_to timestamptz,
  requested_period_basis text default 'activity',
  requested_owner_id uuid default null,
  requested_selector_key text default 'all_confirmed',
  requested_source text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Prehled tymu je dostupny pouze administratorovi.' using errcode = '42501';
  end if;

  with scope as materialized (
    select * from public.get_cpo_team_overview_scope_v1(
      requested_period_from, requested_period_to, requested_period_basis,
      requested_owner_id, requested_selector_key, requested_source
    )
  ), relevant_users as materialized (
    select distinct assignment.owner_id as user_id
    from scope
    join public.complete_power_outage_company_assignments assignment
      on assignment.candidate_id = scope.candidate_id
    union
    select distinct event_row.actor_user_id
    from scope
    join public.complete_power_outage_communication_events event_row
      on event_row.candidate_id = scope.candidate_id
    where event_row.actor_kind = 'user'
      and event_row.occurred_at >= requested_period_from
      and event_row.occurred_at < requested_period_to
    union
    select distinct activity.user_id
    from scope
    join public.complete_power_outage_communication_activity_links link
      on link.candidate_id = scope.candidate_id
    join public.activities activity on activity.id = link.activity_id
    where activity.deleted_at is null
      and coalesce(activity.completed_at, activity.scheduled_for, activity.occurred_at)
          >= requested_period_from
      and coalesce(activity.completed_at, activity.scheduled_for, activity.occurred_at)
          < requested_period_to
  ), user_metrics as (
    select
      profile.id as user_id,
      profile.name as user_name,
      (select count(*) from scope where scope.current_owner_id = profile.id
        and scope.communication_status not in ('job_won', 'closed_no_job'))::integer as active_count,
      (select count(distinct event_row.candidate_id)
       from public.complete_power_outage_communication_events event_row
       join scope on scope.candidate_id = event_row.candidate_id
       where event_row.actor_user_id = profile.id
         and event_row.occurred_at >= requested_period_from
         and event_row.occurred_at < requested_period_to
         and event_row.event_kind = 'manual_contact')::integer as contacted_count,
      (select count(distinct event_row.candidate_id)
       from public.complete_power_outage_communication_events event_row
       join scope on scope.candidate_id = event_row.candidate_id
       where event_row.actor_user_id = profile.id
         and event_row.occurred_at >= requested_period_from
         and event_row.occurred_at < requested_period_to
         and event_row.new_status = 'interested')::integer as interested_count,
      (select count(distinct event_row.candidate_id)
       from public.complete_power_outage_communication_events event_row
       join scope on scope.candidate_id = event_row.candidate_id
       where event_row.actor_user_id = profile.id
         and event_row.occurred_at >= requested_period_from
         and event_row.occurred_at < requested_period_to
         and event_row.new_status = 'offer_sent')::integer as offer_sent_count,
      (select count(distinct event_row.candidate_id)
       from public.complete_power_outage_communication_events event_row
       join scope on scope.candidate_id = event_row.candidate_id
       where event_row.actor_user_id = profile.id
         and event_row.occurred_at >= requested_period_from
         and event_row.occurred_at < requested_period_to
         and event_row.event_kind = 'job_won')::integer as job_won_count,
      (select count(*)
       from public.complete_power_outage_communication_activity_links link
       join public.activities activity on activity.id = link.activity_id
       join scope on scope.candidate_id = link.candidate_id
       where activity.user_id = profile.id and activity.deleted_at is null
         and activity.status = 'planned' and activity.scheduled_for < now())::integer as overdue_count,
      (select max(event_row.occurred_at)
       from public.complete_power_outage_communication_events event_row
       join scope on scope.candidate_id = event_row.candidate_id
       where event_row.actor_user_id = profile.id) as last_activity_at
    from relevant_users user_row
    join public.profiles profile on profile.id = user_row.user_id
    where requested_owner_id is null or profile.id = requested_owner_id
  ), summary as (
    select jsonb_build_object(
      'recordCount', (select count(*) from scope),
      'uniqueCompanyCount', (select count(distinct ico) from scope where ico is not null),
      'activeAssignmentCount', (select count(*) from scope
        where current_owner_id is not null
          and communication_status not in ('job_won', 'closed_no_job')),
      'assignedUserCount', (select count(*) from user_metrics),
      'contactedCount', (select count(distinct event_row.candidate_id)
        from public.complete_power_outage_communication_events event_row
        join scope on scope.candidate_id = event_row.candidate_id
        where event_row.event_kind = 'manual_contact'
          and event_row.occurred_at >= requested_period_from
          and event_row.occurred_at < requested_period_to),
      'jobWonCount', (select count(distinct event_row.candidate_id)
        from public.complete_power_outage_communication_events event_row
        join scope on scope.candidate_id = event_row.candidate_id
        where event_row.event_kind = 'job_won'
          and event_row.occurred_at >= requested_period_from
          and event_row.occurred_at < requested_period_to),
      'plannedFollowUpCount', (select count(*)
        from public.complete_power_outage_communication_activity_links link
        join public.activities activity on activity.id = link.activity_id
        join scope on scope.candidate_id = link.candidate_id
        where activity.deleted_at is null and activity.status = 'planned'),
      'overdueFollowUpCount', (select count(*)
        from public.complete_power_outage_communication_activity_links link
        join public.activities activity on activity.id = link.activity_id
        join scope on scope.candidate_id = link.candidate_id
        where activity.deleted_at is null and activity.status = 'planned'
          and activity.scheduled_for < now()),
      'completedFollowUpCount', (select count(*)
        from public.complete_power_outage_communication_activity_links link
        join public.activities activity on activity.id = link.activity_id
        join scope on scope.candidate_id = link.candidate_id
        where activity.deleted_at is null and activity.status = 'completed'
          and activity.completed_at >= requested_period_from
          and activity.completed_at < requested_period_to)
    ) as value
  ), funnel as (
    select jsonb_build_object(
      'contacted', count(distinct event_row.candidate_id) filter (
        where event_row.event_kind = 'manual_contact'),
      'unreachable', count(distinct event_row.candidate_id) filter (
        where event_row.new_status = 'unreachable'),
      'interested', count(distinct event_row.candidate_id) filter (
        where event_row.new_status = 'interested'),
      'offerSent', count(distinct event_row.candidate_id) filter (
        where event_row.new_status = 'offer_sent'),
      'jobWon', count(distinct event_row.candidate_id) filter (
        where event_row.event_kind = 'job_won'),
      'closedNoJob', count(distinct event_row.candidate_id) filter (
        where event_row.new_status = 'closed_no_job')
    ) as value
    from public.complete_power_outage_communication_events event_row
    join scope on scope.candidate_id = event_row.candidate_id
    where event_row.occurred_at >= requested_period_from
      and event_row.occurred_at < requested_period_to
  ), serialized_users as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', metric.user_id,
      'userName', metric.user_name,
      'activeCount', metric.active_count,
      'contactedCount', metric.contacted_count,
      'interestedCount', metric.interested_count,
      'offerSentCount', metric.offer_sent_count,
      'jobWonCount', metric.job_won_count,
      'conversionPercent', case when metric.contacted_count > 0
        then round(metric.job_won_count::numeric * 100 / metric.contacted_count, 1)
        else 0 end,
      'overdueCount', metric.overdue_count,
      'lastActivityAt', metric.last_activity_at
    ) order by metric.job_won_count desc, metric.active_count desc, metric.user_name), '[]'::jsonb) as value
    from user_metrics metric
  )
  select jsonb_build_object(
    'contract', 'complete-team-overview-analytics-v1',
    'generatedAt', now(),
    'filters', jsonb_build_object(
      'periodFrom', requested_period_from,
      'periodTo', requested_period_to,
      'periodBasis', requested_period_basis,
      'ownerId', requested_owner_id,
      'selectorKey', requested_selector_key,
      'source', requested_source
    ),
    'summary', summary.value,
    'funnel', funnel.value,
    'users', serialized_users.value
  ) into result
  from summary, funnel, serialized_users;

  return result;
end;
$$;

comment on function public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text) is
  'Admin-only KPI, vykonnost uzivatelu, komunikacni funnel a pripominky pro Prehled tymu KOMPLETNI.';

revoke all on function public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)
  from public, anon;
grant execute on function public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)
  to authenticated;

create or replace function public.get_complete_power_outage_team_records_v1(
  requested_period_from timestamptz,
  requested_period_to timestamptz,
  requested_period_basis text default 'activity',
  requested_owner_id uuid default null,
  requested_selector_key text default 'all_confirmed',
  requested_source text default 'all',
  requested_section text default 'attention',
  requested_limit integer default 25,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(100, greatest(1, coalesce(requested_limit, 25)));
  safe_offset integer := least(10000, greatest(0, coalesce(requested_offset, 0)));
  result jsonb;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Prehled tymu je dostupny pouze administratorovi.' using errcode = '42501';
  end if;
  if requested_section not in ('active', 'attention', 'reminders', 'outcomes') then
    raise exception 'Neplatna sekce Prehledu tymu.' using errcode = '22023';
  end if;

  with scope as materialized (
    select * from public.get_cpo_team_overview_scope_v1(
      requested_period_from, requested_period_to, requested_period_basis,
      requested_owner_id, requested_selector_key, requested_source
    )
  ), decorated as materialized (
    select
      scope.*,
      activity.id as follow_up_activity_id,
      activity.status as follow_up_status,
      activity.scheduled_for,
      activity.completed_at,
      activity.user_id as follow_up_owner_id,
      follow_up_profile.name as follow_up_owner_name,
      last_event.last_communication_at,
      job_event.job_won_at,
      job_event.job_won_by,
      job_profile.name as job_won_by_name,
      case
        when activity.status = 'planned' and activity.scheduled_for < now() then 'overdue_follow_up'
        when scope.outage_ends_at < now()
          and scope.communication_status not in ('job_won', 'closed_no_job') then 'past_outage_open'
        when scope.communication_status in ('interested', 'offer_sent')
          and activity.id is null then 'missing_follow_up'
        when scope.communication_status = 'not_contacted'
          and scope.outage_starts_at between now() and now() + interval '72 hours' then 'approaching_uncontacted'
        when scope.communication_status in ('contacted', 'unreachable', 'interested', 'offer_sent')
          and coalesce(last_event.last_communication_at, scope.communication_changed_at)
              < now() - interval '7 days' then 'stale_communication'
        else null
      end as attention_reason,
      case
        when activity.status = 'planned' and activity.scheduled_for < now() then 10
        when scope.outage_ends_at < now()
          and scope.communication_status not in ('job_won', 'closed_no_job') then 20
        when scope.communication_status in ('interested', 'offer_sent')
          and activity.id is null then 30
        when scope.communication_status = 'not_contacted'
          and scope.outage_starts_at between now() and now() + interval '72 hours' then 40
        when scope.communication_status in ('contacted', 'unreachable', 'interested', 'offer_sent')
          and coalesce(last_event.last_communication_at, scope.communication_changed_at)
              < now() - interval '7 days' then 50
        else 999
      end as attention_priority
    from scope
    left join lateral (
      select linked_activity.*
      from public.complete_power_outage_communication_activity_links link
      join public.activities linked_activity on linked_activity.id = link.activity_id
      where link.candidate_id = scope.candidate_id
        and link.is_current
        and linked_activity.deleted_at is null
      order by linked_activity.updated_at desc
      limit 1
    ) activity on true
    left join public.profiles follow_up_profile on follow_up_profile.id = activity.user_id
    left join lateral (
      select max(event_row.occurred_at) as last_communication_at
      from public.complete_power_outage_communication_events event_row
      where event_row.candidate_id = scope.candidate_id
        and event_row.event_kind in ('manual_contact', 'status_changed', 'job_won', 'job_reopened')
    ) last_event on true
    left join lateral (
      select event_row.occurred_at as job_won_at, event_row.actor_user_id as job_won_by
      from public.complete_power_outage_communication_events event_row
      where event_row.candidate_id = scope.candidate_id
        and event_row.event_kind = 'job_won'
        and event_row.occurred_at >= requested_period_from
        and event_row.occurred_at < requested_period_to
      order by event_row.occurred_at desc, event_row.id desc
      limit 1
    ) job_event on true
    left join public.profiles job_profile on job_profile.id = job_event.job_won_by
  ), selected as materialized (
    select decorated.*
    from decorated
    where requested_section = 'active'
        and decorated.current_owner_id is not null
        and decorated.communication_status not in ('job_won', 'closed_no_job')
      or requested_section = 'attention' and decorated.attention_reason is not null
      or requested_section = 'reminders' and decorated.follow_up_activity_id is not null
      or requested_section = 'outcomes' and decorated.job_won_at is not null
  ), paged as (
    select *
    from selected
    order by
      case when requested_section = 'attention' then attention_priority end asc,
      case when requested_section = 'reminders' then scheduled_for end asc nulls last,
      case when requested_section = 'outcomes' then job_won_at end desc nulls last,
      outage_starts_at asc,
      candidate_id
    limit safe_limit offset safe_offset
  )
  select jsonb_build_object(
    'contract', 'complete-team-overview-records-v1',
    'section', requested_section,
    'totalCount', (select count(*) from selected),
    'limit', safe_limit,
    'offset', safe_offset,
    'hasMore', safe_offset + (select count(*) from paged) < (select count(*) from selected),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'candidateId', paged.candidate_id,
      'outageId', paged.outage_id,
      'companyName', paged.company_name,
      'ico', paged.ico,
      'source', paged.source,
      'outageStartsAt', paged.outage_starts_at,
      'outageEndsAt', paged.outage_ends_at,
      'ownerId', paged.current_owner_id,
      'ownerName', paged.current_owner_name,
      'communicationStatus', paged.communication_status,
      'lastCommunicationAt', paged.last_communication_at,
      'followUpActivityId', paged.follow_up_activity_id,
      'followUpStatus', paged.follow_up_status,
      'scheduledFor', paged.scheduled_for,
      'completedAt', paged.completed_at,
      'followUpOwnerId', paged.follow_up_owner_id,
      'followUpOwnerName', paged.follow_up_owner_name,
      'jobWonAt', paged.job_won_at,
      'jobWonBy', paged.job_won_by,
      'jobWonByName', paged.job_won_by_name,
      'attentionReason', paged.attention_reason
    ) order by
      case when requested_section = 'attention' then paged.attention_priority end asc,
      case when requested_section = 'reminders' then paged.scheduled_for end asc nulls last,
      case when requested_section = 'outcomes' then paged.job_won_at end desc nulls last,
      paged.outage_starts_at asc, paged.candidate_id) from paged), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

comment on function public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer) is
  'Admin-only strankovane pracovni seznamy Prehledu tymu KOMPLETNI: aktivni, pozornost, pripominky a vznikle zakazky.';

revoke all on function public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)
  from public, anon;
grant execute on function public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)
  to authenticated;

commit;
