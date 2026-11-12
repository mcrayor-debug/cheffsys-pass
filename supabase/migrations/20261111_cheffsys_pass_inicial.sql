-- =====================================================================
-- Contraseña del día CheffSys — esquema independiente (proyecto Supabase CheffsysPass)
-- Ya aplicado. Se conserva como referencia y para recrear el proyecto.
-- =====================================================================

-- 1) Perfiles: uno por usuario de Auth. Rol: admin (cualquier fecha) o soporte (solo hoy).
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text not null default '',
  rol        text not null default 'soporte' check (rol in ('admin', 'soporte')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.perfiles is 'Usuarios de la app. Se crea un perfil (rol soporte) al dar de alta el usuario en Authentication.';
alter table public.perfiles enable row level security;

-- 2) Perfil automático al crear un usuario en Authentication.
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nombre', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.crear_perfil() from public, anon, authenticated;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- 3) Bitácora de consultas y envíos.
create table if not exists public.bitacora_pass (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  usuario_id    uuid references public.perfiles(id) on delete set null,
  usuario_email text not null,
  fecha_pass    date not null,
  accion        text not null check (accion in ('consulta', 'copia', 'compartir', 'whatsapp'))
);
comment on table public.bitacora_pass is 'Consultas y envíos de la contraseña. Solo escribe la Edge Function pass-del-dia.';
create index if not exists bitacora_pass_created_at_idx on public.bitacora_pass (created_at desc);
create index if not exists bitacora_pass_usuario_idx on public.bitacora_pass (usuario_id);
alter table public.bitacora_pass enable row level security;

-- RLS activo y sin políticas en ambas tablas: el navegador no lee ni escribe nada.
-- Solo la Edge Function (service_role) y el SQL Editor tienen acceso.

-- Administrar usuarios (SQL Editor):
--   update public.perfiles set rol = 'admin'  where email = 'correo@empresa.com';
--   update public.perfiles set activo = false where email = 'correo@empresa.com';
