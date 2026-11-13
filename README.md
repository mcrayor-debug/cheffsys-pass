# Contraseña del día · CheffSys

App web móvil (instalable) para que el personal autorizado consulte, copie y comparta la contraseña diaria de CheffSys. Proyecto **independiente**: Supabase propio, Worker propio y repositorio propio. No comparte nada con Registro de Visitantes.

Guía de despliegue paso a paso: `docs/Guia_despliegue_CheffsysPass.pdf` y `.docx`.

Powered by HIXSA. Uso interno.

## Arquitectura

| Componente | Recurso | Qué hace |
|---|---|---|
| Frontend | Cloudflare Worker `cheffsys-pass` (estáticos de `public/`), vinculado a GitHub | Login, contraseña, copiar, WhatsApp, compartir |
| Edge Function | Supabase `CheffsysPass` → `pass-del-dia` | Valida sesión y rol, calcula la contraseña, registra bitácora |
| Edge Function | Supabase `CheffsysPass` → `admin-usuarios` | Configuración: alta, edición, baja, eliminación, contraseñas temporales y log (solo admin) |
| Base de datos | Supabase `CheffsysPass` → `perfiles`, `bitacora_pass`, `bitacora_admin` | Usuarios, roles y auditoría |
| Almacenamiento | Supabase `CheffsysPass` → bucket privado `fotos` | Fotos de usuario (URLs firmadas de 1 h) |
| Código | GitHub `cheffsys-pass` | Repositorio; Action que prueba y despliega la función |

- La **fórmula vive solo en el servidor** (`supabase/functions/pass-del-dia/formula.ts`).
- Roles: `soporte` (solo hoy) y `admin` (cualquier fecha). Se asignan en `perfiles.rol`.
- RLS activo y sin políticas: el navegador no lee ni escribe tablas; solo la función (service_role).
- La fecha "de hoy" se calcula en hora de Ciudad de México.

## Estructura

```
public/                          → Cloudflare (estáticos)
  index.html, styles.css, app.js
  config.js                      → URL y llave publishable de CheffsysPass
  manifest.webmanifest, _headers
  img/                           → logotipos, íconos y banner
supabase/
  migrations/20261111_cheffsys_pass_inicial.sql   (ya aplicada)
  migrations/20261113_usuarios_config_y_log.sql    (ya aplicada)
  functions/pass-del-dia/        → index.ts, formula.ts, formula_test.ts
  functions/admin-usuarios/      → index.ts
.github/workflows/deploy-edge-function.yml
docs/                            → guía de despliegue (PDF y Word)
wrangler.jsonc
```

## Estado (13 nov 2026)

| Elemento | Estado |
|---|---|
| Esquema, bucket `fotos` y bitácoras en `CheffsysPass` | Aplicado |
| Edge Functions `pass-del-dia` y `admin-usuarios` | Desplegadas |
| App en `https://cheffsys-pass.mcrayor.workers.dev` | Publicada |
| Dominio propio (`pass.cheffsys.com` sugerido) | Pendiente — ver guía, sección «Dominio propio» |

## Usuarios

Se administran en la app: pestaña **Configuración → Usuarios** (solo rol admin). Alta con foto, correo y celular; edición; baja (bloquea el inicio de sesión); eliminación; contraseña temporal con envío por WhatsApp. Cada cambio queda en **Configuración → Log**.

Solo el **primer** administrador se crea desde Supabase:

```sql
-- Tras crear el usuario en Authentication → Users → Add user (se crea su perfil con rol soporte):
update public.perfiles set rol = 'admin', nombre = 'Nombre Apellido' where email = 'correo@empresa.com';

-- Bitácora últimos 7 días
select created_at at time zone 'America/Mexico_City' as hora, usuario_email, fecha_pass, accion
from public.bitacora_pass where created_at > now() - interval '7 days' order by created_at desc;
```

## Supuestos de la fórmula aún no validados

Diciembre (mes+1 = `13`), sábado (`06`/`07`) y domingo (`00`/`01`). Validado contra Glide: 10 y 11 de noviembre de 2026. Cada caso nuevo se agrega a `formula_test.ts`.
