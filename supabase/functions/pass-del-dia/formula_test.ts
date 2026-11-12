// Ejecutar: deno test supabase/functions/pass-del-dia/formula_test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.13";
import { hoyCDMX, passDelDia } from "./formula.ts";

// Valores confirmados contra la app Glide de Cheffsys.
// Agregar aquí cada caso nuevo que se verifique (domingo, sábado, diciembre).
const CONFIRMADOS: Array<[string, string]> = [
  ["2026-11-10", "02120346336"],
  ["2026-11-11", "03120446337"],
];

Deno.test("coincide con los valores confirmados en Glide", () => {
  for (const [fecha, esperado] of CONFIRMADOS) assertEquals(passDelDia(fecha), esperado, fecha);
});

Deno.test("rechaza fechas inválidas", () => {
  assertThrows(() => passDelDia("2026-02-30"));
  assertThrows(() => passDelDia("11/11/2026"));
});

Deno.test("la fecha de hoy usa la hora de CDMX", () => {
  // 2026-11-12 03:00 UTC = 2026-11-11 21:00 en CDMX
  assertEquals(hoyCDMX(new Date("2026-11-12T03:00:00Z")), "2026-11-11");
});
