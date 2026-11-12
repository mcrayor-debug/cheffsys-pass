// Configuración pública del cliente. La llave publishable es segura en el navegador:
// los datos están protegidos por RLS y la Edge Function valida sesión y rol.
// NUNCA poner aquí la service_role key.
window.APP_CONFIG = {
  SUPABASE_URL: "https://ahynbrpnltagwqofelht.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "PEGAR_AQUI_sb_publishable_...", // Supabase → Project Settings → API Keys
};
