create index if not exists jobs_status_start_idx
  on public.jobs (job_status, start_at);

create index if not exists jobs_evidence_start_idx
  on public.jobs (evidence_status, start_at);

create index if not exists jobs_start_end_idx
  on public.jobs (start_at, end_at);

create index if not exists jobs_job_number_idx
  on public.jobs (job_number desc);

create index if not exists job_info_attachments_job_id_idx
  on public.job_info_attachments (job_id);

create index if not exists job_changes_queue_kind_updated_idx
  on public.job_changes_queue (kind, updated_at desc);
