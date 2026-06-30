alter table public.bsafe24_contracts
  add column if not exists drive_time_hours integer
  check (drive_time_hours is null or drive_time_hours >= 0);
