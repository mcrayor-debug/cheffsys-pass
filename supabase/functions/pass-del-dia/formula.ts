// =====================================================================
// Fórmula de la contraseña del día de Cheffsys (réplica de la app Glide).
//   díaSemana (Dom=0) + (mes + 1) + (díaSemana + 1) + serial de fecha tipo Excel
// Ejemplo 2026-11-11 (miércoles) → 03 12 04 46337 → "03120446337"
// Vive SOLO en el servidor: el navegador nunca recibe la fórmula.
// =====================================================================

export const ZONA = "America/Mexico_City";
export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Fecha de hoy (YYYY-MM-DD) según la hora de Ciudad de México. */
export function hoyCDMX(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ahora);
}

/** Devuelve los 4 segmentos de la contraseña para una fecha YYYY-MM-DD. */
export function segmentosDelDia(fecha: string): [string, string, string, string] {
  if (!FECHA_RE.test(fecha)) throw new Error("Fecha inválida");
  const [y, m, d] = fecha.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const dt = new Date(utc);
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error("Fecha inválida");
  const diaSemana = dt.getUTCDay(); // 0 = domingo
  const serial = Math.round((utc - Date.UTC(1899, 11, 30)) / 86_400_000); // serial de Excel
  return [pad2(diaSemana), pad2(m + 1), pad2(diaSemana + 1), String(serial)];
}

export const passDelDia = (fecha: string) => segmentosDelDia(fecha).join("");
