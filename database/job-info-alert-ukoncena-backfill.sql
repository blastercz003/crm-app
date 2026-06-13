update public.jobs
set info_alert_enabled = false
where job_status = 'ukoncena'
  and info_alert_enabled = true;
