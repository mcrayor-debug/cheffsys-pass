// =====================================================================
// Edge Function: admin-usuarios  (proyecto CheffsysPass)
// Solo usuarios con rol "admin" y activos. verify_jwt = false: valida por su cuenta.
//
// Acciones (POST JSON { accion, ... }):
//   listar
//   crear     { email, nombre, celular?, rol, foto? }          → devuelve password_temporal
//   editar    { id, email, nombre, celular?, rol, foto?, quitar_foto? }
//   estado    { id, activo }                                   → baja / reactivación
//   password  { id }                                           → nueva contraseña temporal
//   eliminar  { id }
//   bitacora  { tipo: "pass" | "admin", dias: 1 | 7 | 30, cursor? }
// foto = { base64, tipo: "image/jpeg" | "image/png" | "image/webp" }
// =====================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const ORIGENES = (Deno.env.get("PASS_ALLOWED_ORIGINS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function cabeceras(req: Request): Record<string, string> {
  const origen = req.headers.get("Origin") ?? "";
  const permitido = ORIGENES.length === 0 ? "*" : ORIGENES.includes(origen) ? origen : ORIGENES[0];
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

const BUCKET = "fotos";
const ROLES = new Set(["admin", "soporte"]);
const TIPOS_FOTO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_FOTO = 512 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CEL_RE = /^\+?[0-9]{10,15}$/;
const ID_RE = /^[0-9a-f-]{36}$/i;

class ErrorApp extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

interface Perfil { id: string; email: string; nombre: string; rol: string; activo: boolean; celular: string | null; foto_path: string | null }

function passwordTemporal(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const n = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(n, (x) => abc[x % abc.length]).join("");
}

function limpiarCelular(v: unknown): string | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const c = String(v).replace(/[\s\-().]/g, "");
  if (!CEL_RE.test(c)) throw new ErrorApp("El celular debe tener entre 10 y 15 dígitos.", 422);
  return c;
}

function validarBase(p: Record<string, unknown>) {
  const email = String(p.email ?? "").trim().toLowerCase();
  const nombre = String(p.nombre ?? "").trim();
  const rol = String(p.rol ?? "soporte");
  if (!EMAIL_RE.test(email)) throw new ErrorApp("Correo inválido.", 422);
  if (nombre.length < 2 || nombre.length > 80) throw new ErrorApp("Escribe el nombre (2 a 80 caracteres).", 422);
  if (!ROLES.has(rol)) throw new ErrorApp("Rol inválido.", 422);
  return { email, nombre, rol, celular: limpiarCelular(p.celular) };
}

function decodificarFoto(f: unknown): { bytes: Uint8Array; tipo: string; ext: string } | null {
  if (!f) return null;
  const { base64, tipo } = f as { base64?: string; tipo?: string };
  if (!base64 || !tipo || !TIPOS_FOTO[tipo]) throw new ErrorApp("Formato de foto no permitido.", 422);
  const bin = atob(base64.replace(/^data:[^,]+,/, ""));
  if (bin.length > MAX_FOTO) throw new ErrorApp("La foto es demasiado grande (máx. 512 KB).", 422);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, tipo, ext: TIPOS_FOTO[tipo] };
}

async function subirFoto(db: SupabaseClient, id: string, foto: NonNullable<ReturnType<typeof decodificarFoto>>, anterior: string | null) {
  const path = `${id}/${Date.now()}.${foto.ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, foto.bytes, { contentType: foto.tipo, upsert: false });
  if (error) throw new ErrorApp("No se pudo guardar la foto.", 500);
  if (anterior) await db.storage.from(BUCKET).remove([anterior]);
  return path;
}

async function adminActivo(req: Request, db: SupabaseClient): Promise<Perfil | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: p } = await db.from("perfiles").select("*").eq("id", data.user.id).maybeSingle();
  return p && p.activo ? (p as Perfil) : null;
}

async function obtenerPerfil(db: SupabaseClient, id: unknown): Promise<Perfil> {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new ErrorApp("Usuario inválido.", 422);
  const { data } = await db.from("perfiles").select("*").eq("id", id).maybeSingle();
  if (!data) throw new ErrorApp("El usuario no existe.", 404);
  return data as Perfil;
}

async function quedaOtroAdmin(db: SupabaseClient, excepto: string) {
  const { count } = await db.from("perfiles").select("id", { count: "exact", head: true })
    .eq("rol", "admin").eq("activo", true).neq("id", excepto);
  return (count ?? 0) > 0;
}

Deno.serve(async (req) => {
  const h = cabeceras(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Configuración incompleta del servidor." }, 500);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const yo = await adminActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (yo.rol !== "admin") return json({ error: "Solo un administrador puede entrar a Configuración." }, 403);

  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { /* vacío */ }

  const log = (accion: string, objetivo: string, detalle: Record<string, unknown> = {}) =>
    db.from("bitacora_admin").insert({ actor_id: yo.id, actor_email: yo.email, accion, objetivo_email: objetivo, detalle });

  try {
    switch (p.accion) {
      case "listar": {
        const { data, error } = await db.from("perfiles")
          .select("id, email, nombre, celular, rol, activo, foto_path, created_at")
          .order("activo", { ascending: false }).order("nombre");
        if (error) throw new ErrorApp("No se pudo leer la lista de usuarios.", 500);
        const rutas = data.filter((u) => u.foto_path).map((u) => u.foto_path as string);
        const firmadas: Record<string, string> = {};
        if (rutas.length) {
          const { data: s } = await db.storage.from(BUCKET).createSignedUrls(rutas, 3600);
          (s ?? []).forEach((x) => { if (x.path && x.signedUrl) firmadas[x.path] = x.signedUrl; });
        }
        return json({
          yo: yo.id,
          usuarios: data.map(({ foto_path, ...u }) => ({ ...u, foto_url: foto_path ? firmadas[foto_path] ?? null : null })),
        });
      }

      case "crear": {
        const v = validarBase(p);
        const foto = decodificarFoto(p.foto);
        const password = passwordTemporal();
        const { data, error } = await db.auth.admin.createUser({
          email: v.email, password, email_confirm: true, user_metadata: { nombre: v.nombre },
        });
        if (error || !data.user) {
          const msg = /already|registered|exists/i.test(error?.message ?? "") ? "Ya existe un usuario con ese correo." : "No se pudo crear el usuario.";
          throw new ErrorApp(msg, 409);
        }
        const id = data.user.id;
        const foto_path = foto ? await subirFoto(db, id, foto, null) : null;
        await db.from("perfiles").upsert({
          id, email: v.email, nombre: v.nombre, celular: v.celular, rol: v.rol, activo: true, foto_path, updated_at: new Date().toISOString(),
        });
        await log("alta", v.email, { rol: v.rol });
        return json({ ok: true, id, password_temporal: password });
      }

      case "editar": {
        const actual = await obtenerPerfil(db, p.id);
        const v = validarBase(p);
        if (actual.id === yo.id && v.rol !== "admin") throw new ErrorApp("No puedes quitarte el rol de administrador.", 422);
        if (actual.rol === "admin" && v.rol !== "admin" && !(await quedaOtroAdmin(db, actual.id))) {
          throw new ErrorApp("Debe quedar al menos un administrador activo.", 422);
        }
        if (v.email !== actual.email) {
          const { error } = await db.auth.admin.updateUserById(actual.id, { email: v.email, email_confirm: true });
          if (error) throw new ErrorApp("No se pudo cambiar el correo (¿ya está en uso?).", 409);
        }
        let foto_path = actual.foto_path;
        const foto = decodificarFoto(p.foto);
        if (foto) foto_path = await subirFoto(db, actual.id, foto, actual.foto_path);
        else if (p.quitar_foto && actual.foto_path) {
          await db.storage.from(BUCKET).remove([actual.foto_path]);
          foto_path = null;
        }
        await db.from("perfiles").update({
          email: v.email, nombre: v.nombre, celular: v.celular, rol: v.rol, foto_path, updated_at: new Date().toISOString(),
        }).eq("id", actual.id);
        const cambios: string[] = (["email", "nombre", "celular", "rol"] as const).filter((k) => v[k] !== actual[k]);
        if (foto_path !== actual.foto_path) cambios.push("foto");
        await log("edicion", v.email, { campos: cambios });
        return json({ ok: true });
      }

      case "estado": {
        const actual = await obtenerPerfil(db, p.id);
        const activo = p.activo === true;
        if (!activo && actual.id === yo.id) throw new ErrorApp("No puedes darte de baja a ti mismo.", 422);
        if (!activo && actual.rol === "admin" && !(await quedaOtroAdmin(db, actual.id))) {
          throw new ErrorApp("Debe quedar al menos un administrador activo.", 422);
        }
        // Además de marcarlo inactivo, se bloquea el inicio de sesión en Auth.
        await db.auth.admin.updateUserById(actual.id, { ban_duration: activo ? "none" : "876000h" });
        await db.from("perfiles").update({ activo, updated_at: new Date().toISOString() }).eq("id", actual.id);
        await log(activo ? "reactivacion" : "baja", actual.email);
        return json({ ok: true });
      }

      case "password": {
        const actual = await obtenerPerfil(db, p.id);
        const password = passwordTemporal();
        const { error } = await db.auth.admin.updateUserById(actual.id, { password });
        if (error) throw new ErrorApp("No se pudo restablecer la contraseña.", 500);
        await log("password", actual.email);
        return json({ ok: true, password_temporal: password });
      }

      case "eliminar": {
        const actual = await obtenerPerfil(db, p.id);
        if (actual.id === yo.id) throw new ErrorApp("No puedes eliminar tu propio usuario.", 422);
        if (actual.rol === "admin" && actual.activo && !(await quedaOtroAdmin(db, actual.id))) {
          throw new ErrorApp("Debe quedar al menos un administrador activo.", 422);
        }
        if (actual.foto_path) await db.storage.from(BUCKET).remove([actual.foto_path]);
        const { error } = await db.auth.admin.deleteUser(actual.id); // borra también su perfil (cascade)
        if (error) throw new ErrorApp("No se pudo eliminar el usuario.", 500);
        await log("eliminacion", actual.email);
        return json({ ok: true });
      }

      case "bitacora": {
        const tipo = p.tipo === "admin" ? "admin" : "pass";
        const dias = [1, 7, 30].includes(Number(p.dias)) ? Number(p.dias) : 7;
        const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
        const tabla = tipo === "admin" ? "bitacora_admin" : "bitacora_pass";
        let q = db.from(tabla).select("*").gte("created_at", desde).order("id", { ascending: false }).limit(50);
        if (typeof p.cursor === "number") q = q.lt("id", p.cursor);
        const { data, error } = await q;
        if (error) throw new ErrorApp("No se pudo leer la bitácora.", 500);
        return json({ tipo, registros: data, cursor: data.length === 50 ? data[data.length - 1].id : null });
      }

      default:
        throw new ErrorApp("Acción desconocida.");
    }
  } catch (e) {
    if (e instanceof ErrorApp) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Error inesperado." }, 500);
  }
});
