// =====================================================================
// Edge Function: pass-del-dia
// Proyecto Supabase propio (CheffsysPass), independiente de otras apps.
//   verify_jwt = false: la función valida la sesión y el rol por su cuenta
//   con el cliente service_role, y deja rastro en bitácora.
//
// Roles (tabla perfiles.rol):
//   soporte → ver, copiar y compartir la contraseña de HOY
//   admin   → además, consultar otras fechas
//
// Acciones (POST JSON):
//   { accion: "obtener", fecha?: "YYYY-MM-DD" }
//   { accion: "evento", fecha: "YYYY-MM-DD", tipo: "copia" | "compartir" | "whatsapp" }
// =====================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { FECHA_RE, hoyCDMX, segmentosDelDia } from "./formula.ts";

// Orígenes permitidos separados por coma, p. ej. "https://pass.cheffsys.com,http://localhost:8787".
// Sin la variable se permite cualquier origen: configurarla en producción.
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

const EVENTOS = new Set(["copia", "compartir", "whatsapp"]);

interface Perfil {
  id: string;
  email: string;
  nombre: string;
  rol: string;
  activo: boolean;
}

async function usuarioActivo(req: Request, db: SupabaseClient): Promise<Perfil | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: perfil } = await db.from("perfiles")
    .select("id, email, nombre, rol, activo")
    .eq("id", data.user.id).maybeSingle();
  return perfil && perfil.activo ? (perfil as unknown as Perfil) : null;
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

  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (yo.rol !== "admin" && yo.rol !== "soporte") return json({ error: "Tu usuario no tiene acceso a la contraseña del día." }, 403);
  const otrasFechas = yo.rol === "admin";

  let p: { accion?: string; fecha?: string; tipo?: string } = {};
  try { p = await req.json(); } catch { /* cuerpo vacío */ }

  const hoy = hoyCDMX();
  const fecha = p.fecha ?? hoy;
  if (!FECHA_RE.test(fecha)) return json({ error: "Fecha inválida." }, 422);
  if (fecha !== hoy && !otrasFechas) return json({ error: "Solo puedes consultar la contraseña de hoy." }, 403);

  let segmentos: string[];
  try { segmentos = segmentosDelDia(fecha); } catch { return json({ error: "Fecha inválida." }, 422); }

  const registrar = (accion: string) =>
    db.from("bitacora_pass").insert({ usuario_id: yo.id, usuario_email: yo.email, fecha_pass: fecha, accion });

  if (p.accion === "obtener" || !p.accion) {
    await registrar("consulta");
    return json({ fecha, hoy, password: segmentos.join(""), segmentos, puede_cambiar_fecha: otrasFechas, usuario: yo.nombre });
  }

  if (p.accion === "evento") {
    if (!p.tipo || !EVENTOS.has(p.tipo)) return json({ error: "Evento desconocido." }, 422);
    await registrar(p.tipo);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida." }, 400);
});
