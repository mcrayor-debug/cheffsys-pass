# Contraseña del día · CheffSys

> Guía de despliegue paso a paso: documento independiente «Guía de despliegue · Contraseña del día CheffSys» (Claude Doc), exportable a Word o PDF.

App web móvil (instalable como PWA) para que el personal autorizado consulte, copie y comparta la contraseña diaria de CheffSys. Sigue la arquitectura de **Registro de Visitantes**: Cloudflare (frontend) + Supabase (Auth, base de datos y Edge Functions) + GitHub (código y despliegue).

Uso interno HIXSA. Powered by HIXSA.

## Arquitectura

```
Celular (PWA)                 Cloudflare Worker             Supabase · hixsa-visitantes
──────────────                ─────────────────             ───────────────────────────
index.html / app.js  ◄──────  cheffsys-pass                 Auth (mismos usuarios)
      │                       (solo archivos estáticos,     perfiles / roles
      │                        deploy automático desde       ├─ sección cheffsys_pass
      │                        GitHub)                       └─ sección cheffsys_pass_fechas
      │  login (Supabase Auth)                               bitacora_pass  (RLS, sin políticas)
      └─ POST /functions/v1/pass-del-dia  ─────────────────► Edge Function pass-del-dia
                                                              valida sesión + rol, calcula,
                                                              registra en bitácora
```

Decisiones:

- **La fórmula vive solo en el servidor** (`supabase/functions/pass-del-dia/formula.ts`). Si estuviera en el navegador, cualquiera con el enlace podría generar contraseñas de cualquier fecha.
- **Mismo proyecto Supabase que Registro de Visitantes**: se reutilizan usuarios, roles, perfiles y el flujo de alta de usuarios. Alternativa: proyecto propio (aislamiento total, pero duplica la gestión de usuarios y el plan gratuito ya tiene 2 proyectos activos).
- **Permisos por sección**, igual que visitantes: `cheffsys_pass` (solo hoy) y `cheffsys_pass_fechas` (otras fechas). SUPERADMIN tiene todo.
- **CORS propio** (`PASS_ALLOWED_ORIGINS`) para no tocar `ALLOWED_ORIGIN`, que usan las funciones de visitantes con un solo origen.
- **Bitácora** de cada consulta, copia y envío por WhatsApp/compartir: quién, cuándo y de qué fecha.
- La fecha "de hoy" se calcula en hora de Ciudad de México.

## Estructura

```
public/                         → Cloudflare (estáticos)
  index.html, styles.css, app.js
  config.js                     → URL y llave publishable de Supabase
  manifest.webmanifest, _headers
  img/                          → logotipos (ver img/LEEME.md)
supabase/
  migrations/20261111_cheffsys_pass.sql
  functions/pass-del-dia/       → index.ts, formula.ts, formula_test.ts
.github/workflows/deploy-edge-function.yml
wrangler.jsonc
```

## Implementación

### 1. Logotipos e imágenes

Ya incluidos en `public/img/`:

| Archivo | Uso |
|---|---|
| `favicon.ico` | Favicon del navegador (original de CheffSys) |
| `icon-192.png`, `icon-512.png` | Ícono de la app instalada en el celular |
| `cheffsys-marca.png` | Ícono del chef: recuadro del encabezado y botón Copiar |
| `cheffsys-texto.png` | Palabra "Cheffsys" del logotipo |
| `logo-cheffsys.jpg` | Logotipo completo (respaldo) |
| `banner-pos4.jpg` | Banner del encabezado (optimizado a 1200 px) |
| `logo-hixsa.webp` | Powered by HIXSA |

Colores tomados de los logotipos: rojo del logo `#FF1E18` (acentos), rojo del favicon `#D31D1B` (botones), verde WhatsApp `#25D366`.

### 2. Supabase (proyecto `hixsa-visitantes`)

1. SQL Editor → ejecutar `supabase/migrations/20261111_cheffsys_pass.sql`. Crea `bitacora_pass`, el rol `SOPORTE CHEFFSYS` y agrega los permisos a ADMIN.
2. Edge Functions → Secrets → agregar `PASS_ALLOWED_ORIGINS` con el dominio final, p. ej. `https://pass.tudominio.com` (separar con comas si hay varios; agregar `http://localhost:8787` solo durante pruebas).
3. Desplegar la función (manual la primera vez o con el workflow del paso 3):
   ```bash
   supabase functions deploy pass-del-dia --project-ref ziqfcmgufkeydulgtnvl --no-verify-jwt
   ```
   `--no-verify-jwt` es igual que en las funciones de visitantes: la función valida la sesión por su cuenta.
4. Project Settings → API Keys → copiar la **publishable key** a `public/config.js`. Nunca la `service_role`.
5. Authentication → URL Configuration → agregar el dominio nuevo en *Redirect URLs* (necesario si después se habilita recuperación de contraseña).

### 3. GitHub

1. Crear repositorio privado `cheffsys-pass` en la organización de HIXSA y subir este código.
2. Settings → Secrets → Actions: `SUPABASE_ACCESS_TOKEN` y `SUPABASE_PROJECT_ID`.
3. Cada push a `main` que toque la función corre las pruebas de la fórmula y la despliega. Si las pruebas fallan, no se despliega.

### 4. Cloudflare

1. Workers & Pages → Create → Import a repository → elegir `cheffsys-pass`.
2. Build command: vacío. Deploy command: `npx wrangler deploy` (lee `wrangler.jsonc`).
3. Settings → Domains & Routes → dominio personalizado.
4. Opcional, capa extra: Cloudflare Access (Zero Trust) delante del dominio para que solo correos de la empresa vean siquiera la pantalla de login.

`public/_headers` aplica CSP y cabeceras de seguridad. Si cambia el proyecto de Supabase, actualizar `connect-src`.

### 5. Usuarios

Desde la app de Registro de Visitantes (Configuración → Usuarios), con SUPERADMIN o ADMIN:

- Personal que solo necesita la contraseña → rol **SOPORTE CHEFFSYS**.
- ADMIN / SUPERADMIN ya tienen acceso y pueden consultar otras fechas.
- Otro rol existente → agregar la sección `cheffsys_pass` (ver comentario al final de la migración).

Nota: un usuario SOPORTE CHEFFSYS también puede iniciar sesión en Registro de Visitantes, pero no verá secciones porque su rol no tiene ninguna de esa app.

### 6. Verificación

- [ ] `deno test supabase/functions/pass-del-dia/formula_test.ts` pasa.
- [ ] Usuario sin la sección → "Tu usuario no tiene acceso…".
- [ ] SOPORTE CHEFFSYS ve solo la de hoy; no aparece el selector de fecha.
- [ ] ADMIN ve el selector y la marca "No es la contraseña de hoy" en otras fechas.
- [ ] Copiar, WhatsApp y Compartir funcionan en Android e iOS, y quedan en `bitacora_pass`.
- [ ] Instalar en pantalla de inicio (Android: menú → Instalar app; iOS: Compartir → Agregar a inicio).
- [ ] Comparar con Glide un **sábado, un domingo y el 1 de diciembre** y agregar esos casos a `formula_test.ts`.

## Supuestos de la fórmula aún no validados

| Caso | Valor actual | Riesgo |
|---|---|---|
| Diciembre | mes+1 = `13` | Si CheffSys usa `01`, falla todo diciembre |
| Domingo | segmentos `00` / `01` | Si la semana inicia en lunes, cambia |
| Sábado | segmentos `06` / `07` | Ídem |

Validado contra Glide: 10 y 11 de noviembre de 2026.

## Consultas útiles

```sql
-- Quién consultó o compartió la contraseña en los últimos 7 días
select created_at at time zone 'America/Mexico_City' as hora, usuario_email, fecha_pass, accion
from public.bitacora_pass
where created_at > now() - interval '7 days'
order by created_at desc;
```
