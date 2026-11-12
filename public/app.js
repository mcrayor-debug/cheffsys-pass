// Contraseña del día · CheffSys — cliente.
// El navegador NO conoce la fórmula: pide la contraseña a la Edge Function pass-del-dia.
(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  var FUNCION = "pass-del-dia";
  var ZONA = "America/Mexico_City";

  var $ = function (id) { return document.getElementById(id); };
  var estado = { fecha: null, hoy: null, password: "", puedeCambiar: false };

  var fmtLargo = new Intl.DateTimeFormat("es-MX", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  var aUTC = function (f) { var p = f.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  var hoyLocal = function () {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  };
  var sumarDias = function (f, n) { var d = aUTC(f); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  function mostrar(vista) {
    ["cargando", "login", "pass"].forEach(function (v) { $("vista-" + v).hidden = v !== vista; });
    $("salir").hidden = vista !== "pass";
  }

  function avisar(msg, esError) {
    var s = $("estado");
    s.style.color = esError ? "var(--rojo)" : "";
    s.textContent = msg;
    clearTimeout(avisar.t);
    if (!esError) avisar.t = setTimeout(function () { s.textContent = ""; }, 2500);
  }

  async function llamar(cuerpo) {
    var r = await sb.functions.invoke(FUNCION, { body: cuerpo });
    if (r.error) {
      var msg = "No se pudo obtener la contraseña. Revisa tu conexión.";
      var status = r.error.context && r.error.context.status;
      try { var j = await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* sin cuerpo */ }
      var err = new Error(msg); err.status = status; throw err;
    }
    return r.data;
  }

  function registrarEvento(tipo) {
    llamar({ accion: "evento", fecha: estado.fecha, tipo: tipo }).catch(function () {});
  }

  function pintar(d) {
    estado.fecha = d.fecha; estado.hoy = d.hoy; estado.password = d.password; estado.puedeCambiar = d.puede_cambiar_fecha;
    $("fecha").textContent = fmtLargo.format(aUTC(d.fecha));
    var c = $("codigo");
    c.innerHTML = d.segmentos.map(function (s) { return "<span>" + s + "</span>"; }).join("");
    c.classList.remove("nuevo"); void c.offsetWidth; c.classList.add("nuevo");
    $("aviso-otra-fecha").hidden = d.fecha === d.hoy;
    $("selector").hidden = !d.puede_cambiar_fecha;
    $("elegir-fecha").value = d.fecha;
    $("hoy").disabled = d.fecha === d.hoy;
    mostrar("pass");
  }

  async function cargar(fecha) {
    try {
      pintar(await llamar({ accion: "obtener", fecha: fecha || undefined }));
    } catch (e) {
      if (e.status === 401) { await sb.auth.signOut(); mostrar("login"); return; }
      mostrar("pass");
      $("codigo").textContent = "—";
      avisar(e.message, true);
    }
  }

  function mensaje() {
    return "Contraseña CheffSys del " + fmtLargo.format(aUTC(estado.fecha)) + ": " + estado.password;
  }

  async function copiar() {
    if (!estado.password) return;
    var ok = false;
    try { await navigator.clipboard.writeText(estado.password); ok = true; } catch (e) {
      var ta = document.createElement("textarea");
      ta.value = estado.password; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      document.body.removeChild(ta);
    }
    if (ok) { avisar("Copiada: " + estado.password); registrarEvento("copia"); }
    else avisar("No se pudo copiar. Mantén presionado el número para copiarlo.", true);
  }

  // ---------- eventos ----------
  $("form-login").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var email = $("email").value.trim(), password = $("password").value;
    $("error-login").textContent = "";
    if (!email || !password) { $("error-login").textContent = "Escribe tu correo y contraseña."; return; }
    $("entrar").disabled = true; $("entrar").textContent = "Entrando…";
    var r = await sb.auth.signInWithPassword({ email: email, password: password });
    $("entrar").disabled = false; $("entrar").textContent = "Entrar";
    if (r.error) { $("error-login").textContent = "Correo o contraseña incorrectos."; return; }
    $("password").value = "";
    mostrar("cargando"); cargar();
  });

  $("salir").addEventListener("click", async function () {
    await sb.auth.signOut();
    estado.password = ""; $("codigo").textContent = "";
    mostrar("login");
  });

  $("copiar").addEventListener("click", copiar);
  $("codigo").addEventListener("click", copiar);

  $("whatsapp").addEventListener("click", function () {
    if (!estado.password) return;
    window.open("https://wa.me/?text=" + encodeURIComponent(mensaje()), "_blank", "noopener");
    registrarEvento("whatsapp");
  });

  if (navigator.share) {
    $("compartir").hidden = false;
    $("compartir").addEventListener("click", function () {
      if (!estado.password) return;
      navigator.share({ text: mensaje() }).then(function () { registrarEvento("compartir"); }).catch(function () {});
    });
  }

  $("anterior").addEventListener("click", function () { cargar(sumarDias(estado.fecha, -1)); });
  $("siguiente").addEventListener("click", function () { cargar(sumarDias(estado.fecha, 1)); });
  $("hoy").addEventListener("click", function () { cargar(); });
  $("elegir-fecha").addEventListener("change", function (e) { if (e.target.value) cargar(e.target.value); });

  // Al volver a la app después de medianoche (CDMX), actualizar a la contraseña del nuevo día.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && estado.hoy && estado.fecha === estado.hoy && hoyLocal() !== estado.hoy) cargar();
  });

  // ---------- arranque ----------
  sb.auth.getSession().then(function (r) {
    if (r.data && r.data.session) cargar(); else mostrar("login");
  });
})();
