-- Extend the digital-business-card intake with an optional comment and
-- return enough info (client_id, workspace_id) for the server action to
-- attach an optional photo upload after the client row is resolved.

drop function if exists public.submit_client_intake(uuid, text, text, text);

create or replace function public.submit_client_intake(
  p_token uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_comment text default null
)
returns table (client_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_phone text;
  v_email text;
  v_comment text;
  v_existing_id uuid;
  v_client_id uuid;
begin
  if trim(coalesce(p_full_name, '')) = '' then
    raise exception 'full_name is required';
  end if;

  select id into v_workspace_id from workspaces where intake_token = p_token;
  if v_workspace_id is null then
    raise exception 'invalid intake token';
  end if;

  v_phone := nullif(trim(coalesce(p_phone, '')), '');
  v_email := nullif(trim(coalesce(p_email, '')), '');
  v_comment := nullif(trim(coalesce(p_comment, '')), '');

  if v_phone is not null or v_email is not null then
    select clients.id into v_existing_id
    from clients
    where clients.workspace_id = v_workspace_id
      and (
        (v_phone is not null and clients.phone = v_phone)
        or (v_email is not null and clients.email = v_email)
      )
    limit 1;
  end if;

  if v_existing_id is null then
    insert into clients (workspace_id, full_name, phone, email, general_notes, source)
    values (
      v_workspace_id,
      trim(p_full_name),
      v_phone,
      v_email,
      case when v_comment is not null then 'Комментарий с визитки: ' || v_comment else null end,
      'intake_form'
    )
    returning id into v_client_id;
  else
    v_client_id := v_existing_id;
    if v_comment is not null then
      update clients
      set general_notes = case
        when clients.general_notes is null or clients.general_notes = '' then 'Комментарий с визитки: ' || v_comment
        else clients.general_notes || E'\n' || 'Комментарий с визитки (' || to_char(now(), 'DD.MM.YYYY') || '): ' || v_comment
      end
      where clients.id = v_client_id;
    end if;
  end if;

  return query select v_client_id, v_workspace_id;
end;
$$;

grant execute on function public.submit_client_intake(uuid, text, text, text, text) to anon, authenticated;
