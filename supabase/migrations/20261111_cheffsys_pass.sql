-- =====================================================================
-- Contraseña del día Cheffsys — cambios en el proyecto Supabase compartido
-- (hixsa-visitantes). Idempotente: se puede ejecutar más de una vez.
-- Aplicar desde el SQL Editor (el proyecto no usa historial de migraciones).
-- =====================================================================

-- 1) Bitácora: quién consultó, copió o compartió la contraseña y de qué fecha.
create table if not exists public.bitacora_pass (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  usuario_id    uuid references public.perfiles(id) on delete set null,
  usuario_email text not null,
  fecha_pass    date not null,
  accion        text not null check (accion in ('consulta', 'copia', 'compartir', 'whatsapp'))
);
comment on table public.bitacora_pass is
  'Contraseña del día Cheffsys: consultas y envíos. Solo escribe la Edge Function pass-del-dia.';
create index if not exists bitacora_pass_created_at_idx on public.bitacora_pass (created_at desc);

-- RLS activo y sin políticas: nadie la lee ni escribe desde el navegador.
-- Solo la Edge Function (service_role) y el SQL Editor tienen acceso.
alter table public.bitacora_pass enable row level security;

-- 2) Rol nuevo para el personal que solo necesita la contraseña.
insert into public.roles (id, nombre, descripcion, secciones, alcance, puede_exportar, sistema)
values ('soporte_cheffsys', 'SOPORTE CHEFFSYS',
        'Consulta, copia y comparte la contraseña del día de Cheffsys.',
        array['cheffsys_pass'], 'hoy', false, false)
on conflict (id) do nothing;

-- 3) ADMIN: contraseña de hoy y de otras fechas. (SUPERADMIN ya tiene todo por código.)
update public.roles
set secciones = (
  select array_agg(distinct s) from unnest(secciones || array['cheffsys_pass', 'cheffsys_pass_fechas']) s
)
where id in ('admin', 'superadmin');

-- Para dar acceso a otro rol existente (ej. supervisor) solo a la de hoy:
-- update public.roles set secciones = array_append(secciones, 'cheffsys_pass')
-- where id = 'supervisor' and not ('cheffsys_pass' = any(secciones));
