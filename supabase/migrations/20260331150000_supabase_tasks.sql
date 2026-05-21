-- Supabase-native background task queue replacing pgmq for generation jobs.
-- background_jobs remains the product-visible source of truth.

create type public.task_status as enum (
  'queued',
  'running',
  'succeeded',
  'canceled',
  'dead_letter'
);

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null unique references public.background_jobs(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id),
  canvas_id          uuid references public.canvases(id) on delete set null,
  session_id         uuid references public.chat_sessions(id) on delete set null,
  queue_name         text not null,
  job_type           public.background_job_type not null,
  status             public.task_status not null default 'queued',
  available_at       timestamptz not null default now(),
  lease_until        timestamptz,
  locked_at          timestamptz,
  locked_by          text,
  last_error_code    text,
  last_error_message text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  canceled_at        timestamptz
);

create index idx_tasks_claimable
  on public.tasks(queue_name, available_at, created_at)
  where status = 'queued';

create index idx_tasks_expired_leases
  on public.tasks(queue_name, lease_until)
  where status = 'running';

create index idx_tasks_job_id on public.tasks(job_id);
create index idx_tasks_workspace_id on public.tasks(workspace_id);

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

create policy tasks_service_role
  on public.tasks for all
  to service_role
  using (true) with check (true);

create or replace function public.claim_background_tasks(
  p_queue_name text,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_limit integer default 1
)
returns setof public.tasks
language plpgsql
as $$
begin
  return query
  with candidate as (
    select id
    from public.tasks
    where queue_name = p_queue_name
      and available_at <= now()
      and (
        status = 'queued'::public.task_status
        or (
          status = 'running'::public.task_status
          and lease_until is not null
          and lease_until <= now()
        )
      )
    order by available_at asc, created_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.tasks as t
  set
    status = 'running'::public.task_status,
    locked_at = now(),
    locked_by = p_worker_id,
    lease_until = now() + (greatest(p_lease_seconds, 1) * interval '1 second'),
    updated_at = now()
  from candidate
  where t.id = candidate.id
  returning t.*;
end;
$$;

create or replace function public.claim_background_tasks_with_poll(
  p_queue_name text,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_limit integer default 1,
  p_max_poll_seconds integer default 5,
  p_poll_interval_ms integer default 500
)
returns setof public.tasks
language plpgsql
as $$
declare
  v_deadline timestamptz := clock_timestamp() + (greatest(p_max_poll_seconds, 1) * interval '1 second');
begin
  loop
    return query
    select *
    from public.claim_background_tasks(
      p_queue_name,
      p_worker_id,
      p_lease_seconds,
      p_limit
    );

    if found then
      return;
    end if;

    exit when clock_timestamp() >= v_deadline;
    perform pg_sleep(greatest(p_poll_interval_ms, 100) / 1000.0);
  end loop;

  return;
end;
$$;

-- Backfill non-terminal generation jobs so the new worker can resume them after cutover.
insert into public.tasks (
  job_id,
  workspace_id,
  canvas_id,
  session_id,
  queue_name,
  job_type,
  status,
  available_at,
  last_error_code,
  last_error_message,
  created_at,
  updated_at
)
select
  id,
  workspace_id,
  canvas_id,
  session_id,
  queue_name,
  job_type,
  'queued'::public.task_status,
  now(),
  error_code,
  error_message,
  created_at,
  updated_at
from public.background_jobs
where job_type in ('image_generation'::public.background_job_type, 'video_generation'::public.background_job_type)
  and (
    status in ('queued'::public.background_job_status, 'running'::public.background_job_status)
    or (
      status = 'failed'::public.background_job_status
      and attempt_count < max_attempts
    )
  )
on conflict (job_id) do nothing;

-- Remove the extension after task backfill so runtime no longer depends on pgmq.
drop extension if exists pgmq cascade;
