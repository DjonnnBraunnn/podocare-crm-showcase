-- PodoCare CRM — initial schema
-- Multi-tenant from day one: every client-facing table carries workspace_id,
-- and access is enforced through Postgres RLS, not just hidden in the UI.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create type workspace_role as enum ('owner', 'admin', 'specialist');

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role workspace_role not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table services_catalog (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  default_price numeric(10, 2),
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  birth_date date,
  general_notes text,
  -- specialists only see clients assigned to (or created by) them; owner/admin see everyone
  assigned_specialist_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table visits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  visit_date date not null default current_date,
  complaints text,
  diagnosis text,
  service_ids uuid[] not null default '{}',
  notes text,
  next_visit_date date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  visit_id uuid references visits (id) on delete set null,
  storage_path text not null,
  phase text not null check (phase in ('before', 'after')),
  taken_at timestamptz not null default now()
);

create table foot_conditions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  visit_id uuid references visits (id) on delete set null,
  foot text not null check (foot in ('left', 'right')),
  x numeric not null,
  y numeric not null,
  condition_type text not null,
  note text,
  created_at timestamptz not null default now()
);

create table consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  visit_id uuid references visits (id) on delete set null,
  signed_at timestamptz not null default now(),
  signature_storage_path text,
  pdf_storage_path text,
  form_text text,
  created_at timestamptz not null default now()
);

create index on workspace_members (user_id);
create index on clients (workspace_id);
create index on visits (client_id);
create index on photos (client_id);
create index on foot_conditions (client_id);
create index on consents (client_id);

-- ---------------------------------------------------------------------------
-- Helper functions used inside RLS policies
-- security definer + fixed search_path so they can read workspace_members
-- without being blocked by that table's own RLS (no recursion).
-- ---------------------------------------------------------------------------

create or replace function public.workspace_role_for(p_workspace_id uuid)
returns workspace_role
language sql
security definer
set search_path = public
stable
as $$
  select role from workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

-- owner/admin manage every client in the workspace; a specialist only
-- manages clients assigned to them or that they personally created
create or replace function public.can_manage_client(p_client_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from clients c
    join workspace_members m on m.workspace_id = c.workspace_id
    where c.id = p_client_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or c.assigned_specialist_id = auth.uid()
        or c.created_by = auth.uid()
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table services_catalog enable row level security;
alter table clients enable row level security;
alter table visits enable row level security;
alter table photos enable row level security;
alter table foot_conditions enable row level security;
alter table consents enable row level security;

-- workspaces
create policy "members can view their workspace"
  on workspaces for select
  using (is_workspace_member(id));

create policy "owner can update workspace"
  on workspaces for update
  using (workspace_role_for(id) = 'owner');

-- workspace_members
create policy "members can view workspace roster"
  on workspace_members for select
  using (is_workspace_member(workspace_id));

create policy "owner/admin can manage members"
  on workspace_members for all
  using (workspace_role_for(workspace_id) in ('owner', 'admin'))
  with check (workspace_role_for(workspace_id) in ('owner', 'admin'));

-- services_catalog
create policy "members can view services"
  on services_catalog for select
  using (is_workspace_member(workspace_id));

create policy "owner/admin can insert services"
  on services_catalog for insert
  with check (workspace_role_for(workspace_id) in ('owner', 'admin'));

create policy "owner/admin can update services"
  on services_catalog for update
  using (workspace_role_for(workspace_id) in ('owner', 'admin'));

create policy "owner/admin can delete services"
  on services_catalog for delete
  using (workspace_role_for(workspace_id) in ('owner', 'admin'));

-- clients
create policy "owner/admin see all clients, specialists see their own"
  on clients for select
  using (
    workspace_role_for(workspace_id) in ('owner', 'admin')
    or assigned_specialist_id = auth.uid()
    or created_by = auth.uid()
  );

create policy "members can create clients"
  on clients for insert
  with check (is_workspace_member(workspace_id));

create policy "owner/admin or owning specialist can update client"
  on clients for update
  using (can_manage_client(id));

create policy "owner/admin can delete client"
  on clients for delete
  using (workspace_role_for(workspace_id) in ('owner', 'admin'));

-- visits, photos, foot_conditions, consents all gate through the parent client
create policy "can view visits of accessible client"
  on visits for select
  using (can_manage_client(client_id));

create policy "can create visit for accessible client"
  on visits for insert
  with check (can_manage_client(client_id));

create policy "can update visit of accessible client"
  on visits for update
  using (can_manage_client(client_id));

create policy "owner/admin can delete visit"
  on visits for delete
  using (workspace_role_for(workspace_id) in ('owner', 'admin'));

create policy "can view photos of accessible client"
  on photos for select
  using (can_manage_client(client_id));

create policy "can upload photos for accessible client"
  on photos for insert
  with check (can_manage_client(client_id));

create policy "can delete photos of accessible client"
  on photos for delete
  using (can_manage_client(client_id));

create policy "can view foot conditions of accessible client"
  on foot_conditions for select
  using (can_manage_client(client_id));

create policy "can add foot conditions for accessible client"
  on foot_conditions for insert
  with check (can_manage_client(client_id));

create policy "can update foot conditions of accessible client"
  on foot_conditions for update
  using (can_manage_client(client_id));

create policy "can delete foot conditions of accessible client"
  on foot_conditions for delete
  using (can_manage_client(client_id));

create policy "can view consents of accessible client"
  on consents for select
  using (can_manage_client(client_id));

create policy "can create consents for accessible client"
  on consents for insert
  with check (can_manage_client(client_id));

-- ---------------------------------------------------------------------------
-- Auto-provision a workspace + owner membership when someone signs up
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
begin
  insert into workspaces (name, owner_id)
  values (coalesce(new.raw_user_meta_data ->> 'workspace_name', 'Мой кабинет'), new.id)
  returning id into new_workspace_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Storage buckets: photos and signed consent PDFs
-- Object path convention: `${workspace_id}/${client_id}/...` so the same
-- workspace-membership check used for tables also guards file access.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('client-photos', 'client-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('consents', 'consents', false)
on conflict (id) do nothing;

create policy "workspace members can read their client photos"
  on storage.objects for select
  using (
    bucket_id = 'client-photos'
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "workspace members can upload their client photos"
  on storage.objects for insert
  with check (
    bucket_id = 'client-photos'
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "workspace members can delete their client photos"
  on storage.objects for delete
  using (
    bucket_id = 'client-photos'
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "workspace members can read their consent files"
  on storage.objects for select
  using (
    bucket_id = 'consents'
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "workspace members can upload their consent files"
  on storage.objects for insert
  with check (
    bucket_id = 'consents'
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );
