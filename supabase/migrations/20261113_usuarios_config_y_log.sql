-- =====================================================================
-- Iteración 2 (ya aplicada en CheffsysPass): usuarios desde la app y bitácora de cambios.
-- =====================================================================

-- 1) Datos adicionales del perfil.
alter table public.perfiles
  add column if not exists celular    text,
  add column if not exists foto_path  text,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table public.perfiles
    add constraint perfiles_celular_chk check (celular is null or celular ~ '^\+?[0-9]{10,15}$');
exception when duplicate_object then null; end $$;

-- 2) Bitácora de cambios de usuarios (quién hizo qué a quién).
create table if not exists public.bitacora_admin (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor_id       uuid references public.perfiles(id) on delete set null,
  actor_email    text not null,
  accion         text not null check (accion in ('alta', 'edicion', 'baja', 'reactivacion', 'eliminacion', 'password')),
  objetivo_email text not null,
  detalle        jsonb not null default '{}'::jsonb
);
comment on table public.bitacora_admin is 'Cambios de usuarios hechos desde Configuración. Solo escribe la Edge Function admin-usuarios.';
create index if not exists bitacora_admin_created_at_idx on public.bitacora_admin (created_at desc);
create index if not exists bitacora_admin_actor_idx on public.bitacora_admin (actor_id);
alter table public.bitacora_admin enable row level security;

-- 3) Fotos de usuario: bucket privado, solo la Edge Function (service_role) lee y escribe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
