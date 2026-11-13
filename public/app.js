// Contraseña del día · CheffSys — cliente.
// El navegador NO conoce la fórmula: pide la contraseña a la Edge Function pass-del-dia.
// Configuración (usuarios y log) usa la Edge Function admin-usuarios, solo para administradores.
(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  var ZONA = "America/Mexico_City";

  var $ = function (id) { return document.getElementById(id); };
  var estado = { fecha: null, hoy: null, password: "", esAdmin: false };
  var usuarios = [], yoId = null, editando = null, fotoNueva = null, quitarFoto = false, temporal = null;
  var log = { cursor: null };

  // ---------- utilidades ----------
  var fmtLargo = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  var fmtHora = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ZONA });
  var fmtCorta = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  var aUTC = function (f) { var p = f.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  var hoyLocal = function () {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  };
  var sumarDias = function (f, n) { var d = aUTC(f); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var esc = function (t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var iniciales = function (n) {
    return (n || "?").trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join("").toUpperCase();
  };
  var celularBonito = function (c) {
    if (!c) return "";
    var d = c.replace(/^\+?52/, "");
    return d.length === 10 ? d.slice(0, 2) + " " + d.slice(2, 6) + " " + d.slice(6) : c;
  };
  var celularWa = function (c) {
    if (!c) return "";
    var d = c.replace(/\D/g, "");
    return d.length === 10 ? "52" + d : d;
  };

  async function copiarTexto(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      var ta = document.createElement("textarea");
      ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      document.body.removeChild(ta); return ok;
    }
  }

  function avisar(id, msg, esError) {
    var s = $(id);
    s.style.color = esError ? "var(--rojo)" : "";
    s.textContent = msg;
    clearTimeout(avisar[id]);
    if (!esError && msg) avisar[id] = setTimeout(function () { s.textContent = ""; }, 2800);
  }

  async function llamar(funcion, cuerpo) {
    var r = await sb.functions.invoke(funcion, { body: cuerpo });
    if (r.error) {
      var msg = "No se pudo conectar. Revisa tu conexión.";
      var status = r.error.context && r.error.context.status;
      try { var j = await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* sin cuerpo */ }
      var err = new Error(msg); err.status = status; throw err;
    }
    return r.data;
  }

  // ---------- navegación ----------
  function mostrar(vista) {
    ["cargando", "login", "pass", "config"].forEach(function (v) { $("vista-" + v).hidden = v !== vista; });
    document.body.dataset.vista = vista;
    $("salir").hidden = vista === "login" || vista === "cargando";
    $("pestanas").hidden = !(estado.esAdmin && (vista === "pass" || vista === "config"));
    $("subtitulo").textContent = vista === "config" ? "Configuración" : "Contraseña del día";
    document.querySelectorAll(".pestana").forEach(function (b) {
      var activa = b.dataset.ir === vista;
      b.classList.toggle("activa", activa);
      if (activa) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }

  document.querySelectorAll(".pestana").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.ir === "config") { mostrar("config"); cargarUsuarios(); }
      else mostrar("pass");
    });
  });

  document.querySelectorAll(".subpestana").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".subpestana").forEach(function (o) {
        var a = o === b; o.classList.toggle("activa", a); o.setAttribute("aria-selected", a ? "true" : "false");
      });
      $("panel-usuarios").hidden = b.dataset.panel !== "usuarios";
      $("panel-log").hidden = b.dataset.panel !== "log";
      if (b.dataset.panel === "log") cargarLog(true); else cargarUsuarios();
    });
  });

  // ---------- contraseña del día ----------
  function pintar(d) {
    estado.fecha = d.fecha; estado.hoy = d.hoy; estado.password = d.password;
    estado.esAdmin = d.rol === "admin" || d.puede_cambiar_fecha === true;
    $("fecha").textContent = fmtLargo.format(aUTC(d.fecha));
    var c = $("codigo");
    c.innerHTML = d.segmentos.map(function (s) { return "<span>" + esc(s) + "</span>"; }).join("");
    c.classList.remove("nuevo"); void c.offsetWidth; c.classList.add("nuevo");
    $("aviso-otra-fecha").hidden = d.fecha === d.hoy;
    $("selector").hidden = !d.puede_cambiar_fecha;
    $("elegir-fecha").value = d.fecha;
    $("hoy").disabled = d.fecha === d.hoy;
    mostrar("pass");
  }

  async function cargar(fecha) {
    try {
      pintar(await llamar("pass-del-dia", { accion: "obtener", fecha: fecha || undefined }));
    } catch (e) {
      if (e.status === 401) { await sb.auth.signOut(); mostrar("login"); return; }
      mostrar("pass");
      $("codigo").textContent = "—";
      avisar("estado", e.message, true);
    }
  }

  var registrarEvento = function (tipo) {
    llamar("pass-del-dia", { accion: "evento", fecha: estado.fecha, tipo: tipo }).catch(function () {});
  };
  var mensaje = function () {
    return "Contraseña CheffSys del " + fmtLargo.format(aUTC(estado.fecha)) + ": " + estado.password;
  };

  async function copiar() {
    if (!estado.password) return;
    if (await copiarTexto(estado.password)) { avisar("estado", "Copiada: " + estado.password); registrarEvento("copia"); }
    else avisar("estado", "No se pudo copiar. Mantén presionado el número para copiarlo.", true);
  }
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

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && estado.hoy && estado.fecha === estado.hoy &&
        hoyLocal() !== estado.hoy && document.body.dataset.vista === "pass") cargar();
  });

  // ---------- sesión ----------
  $("form-login").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var email = $("email").value.trim(), password = $("password").value;
    $("error-login").textContent = "";
    if (!email || !password) { $("error-login").textContent = "Escribe tu correo y contraseña."; return; }
    $("entrar").disabled = true; $("entrar").textContent = "Entrando…";
    var r = await sb.auth.signInWithPassword({ email: email, password: password });
    $("entrar").disabled = false; $("entrar").textContent = "Entrar";
    if (r.error) {
      $("error-login").textContent = /banned/i.test(r.error.message) ? "Tu usuario está dado de baja." : "Correo o contraseña incorrectos.";
      return;
    }
    $("password").value = "";
    mostrar("cargando"); cargar();
  });

  $("salir").addEventListener("click", async function () {
    await sb.auth.signOut();
    estado = { fecha: null, hoy: null, password: "", esAdmin: false };
    usuarios = []; $("codigo").textContent = ""; $("lista-usuarios").innerHTML = ""; $("lista-log").innerHTML = "";
    mostrar("login");
  });

  // Cambiar mi contraseña
  $("cambiar-mi-pass").addEventListener("click", function () {
    $("form-mi-pass").reset(); $("mi-pass-error").textContent = ""; $("dialogo-mi-pass").showModal();
  });
  $("form-mi-pass").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var a = $("mi-pass-1").value, b = $("mi-pass-2").value;
    if (a.length < 8) { $("mi-pass-error").textContent = "Usa al menos 8 caracteres."; return; }
    if (a !== b) { $("mi-pass-error").textContent = "Las contraseñas no coinciden."; return; }
    var r = await sb.auth.updateUser({ password: a });
    if (r.error) { $("mi-pass-error").textContent = "No se pudo cambiar. Intenta con otra contraseña."; return; }
    $("dialogo-mi-pass").close();
    avisar("estado", "Contraseña actualizada.");
  });

  // ---------- configuración: usuarios ----------
  function avatarHtml(u) {
    return u.foto_url ? '<img src="' + esc(u.foto_url) + '" alt="">' : esc(iniciales(u.nombre));
  }

  function pintarUsuarios() {
    var activos = usuarios.filter(function (u) { return u.activo; }).length;
    $("conteo-usuarios").textContent = activos + " activo" + (activos === 1 ? "" : "s") + " de " + usuarios.length;
    $("lista-usuarios").innerHTML = usuarios.length ? usuarios.map(function (u, i) {
      return '<li><button class="usuario' + (u.activo ? "" : " inactivo") + '" data-i="' + i + '">' +
        '<span class="avatar">' + avatarHtml(u) + "</span>" +
        '<span class="u-datos"><p class="u-nombre">' + esc(u.nombre || u.email) +
        (u.rol === "admin" ? ' <span class="etiqueta admin">ADMIN</span>' : "") +
        (u.activo ? "" : ' <span class="etiqueta baja">BAJA</span>') +
        (u.id === yoId ? ' <span class="etiqueta">TÚ</span>' : "") + "</p>" +
        '<p class="u-linea">' + esc(u.email) + "</p>" +
        (u.celular ? '<p class="u-linea">' + esc(celularBonito(u.celular)) + "</p>" : "") +
        "</span></button></li>";
    }).join("") : '<li class="vacio">Sin usuarios.</li>';
  }

  async function cargarUsuarios() {
    try {
      var d = await llamar("admin-usuarios", { accion: "listar" });
      usuarios = d.usuarios; yoId = d.yo; pintarUsuarios();
    } catch (e) {
      if (e.status === 401) { await sb.auth.signOut(); mostrar("login"); return; }
      avisar("estado-config", e.message, true);
    }
  }

  $("lista-usuarios").addEventListener("click", function (ev) {
    var b = ev.target.closest(".usuario"); if (b) abrirEditor(usuarios[Number(b.dataset.i)]);
  });
  $("nuevo-usuario").addEventListener("click", function () { abrirEditor(null); });

  function pintarAvatarEditor(url, nombre) {
    $("editor-avatar").innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : esc(iniciales(nombre));
    $("editor-quitar-foto").hidden = !url;
  }

  function abrirEditor(u) {
    editando = u; fotoNueva = null; quitarFoto = false;
    $("form-usuario").reset(); $("editor-error").textContent = "";
    $("editor-titulo").textContent = u ? "Editar usuario" : "Nuevo usuario";
    $("u-nombre").value = u ? u.nombre : "";
    $("u-email").value = u ? u.email : "";
    $("u-celular").value = u ? celularBonito(u.celular) : "";
    $("u-rol").value = u ? u.rol : "soporte";
    $("editor-guardar").textContent = u ? "Guardar cambios" : "Crear usuario";
    $("acciones-edicion").hidden = !u;
    if (u) {
      var soyYo = u.id === yoId;
      $("editor-estado").textContent = u.activo ? "Dar de baja" : "Reactivar";
      $("editor-estado").disabled = soyYo && u.activo;
      $("editor-eliminar").disabled = soyYo;
    }
    pintarAvatarEditor(u && u.foto_url, u ? u.nombre : "");
    $("editor").showModal();
  }

  // Reduce la foto a 320 px (JPEG) antes de enviarla.
  function reducirFoto(archivo) {
    return new Promise(function (ok, mal) {
      var img = new Image(), url = URL.createObjectURL(archivo);
      img.onload = function () {
        var lado = Math.min(img.width, img.height), t = 320;
        var c = document.createElement("canvas"); c.width = t; c.height = t;
        c.getContext("2d").drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, t, t);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); mal(new Error("No se pudo leer la imagen.")); };
      img.src = url;
    });
  }

  $("editor-foto").addEventListener("change", async function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      var dataUrl = await reducirFoto(f);
      fotoNueva = { base64: dataUrl.split(",")[1], tipo: "image/jpeg" }; quitarFoto = false;
      pintarAvatarEditor(dataUrl, $("u-nombre").value);
    } catch (err) { $("editor-error").textContent = err.message; }
    e.target.value = "";
  });
  $("editor-quitar-foto").addEventListener("click", function () {
    fotoNueva = null; quitarFoto = true; pintarAvatarEditor(null, $("u-nombre").value);
  });

  function mostrarTemporal(password, u) {
    temporal = { password: password, u: u };
    $("temporal-texto").textContent = "Para " + u.nombre + " (" + u.email + "):";
    $("temporal-valor").textContent = password;
    $("temporal-whatsapp").hidden = !u.celular;
    $("dialogo-temporal").showModal();
  }
  $("temporal-copiar").addEventListener("click", async function () {
    if (temporal && await copiarTexto(temporal.password)) this.textContent = "Copiada ✓";
  });
  $("temporal-whatsapp").addEventListener("click", function () {
    if (!temporal) return;
    var t = "Hola " + temporal.u.nombre + ", tu acceso a CheffSys · Contraseña del día:\n" + location.origin +
      "\nUsuario: " + temporal.u.email + "\nContraseña temporal: " + temporal.password +
      "\nCámbiala al entrar en «Cambiar mi contraseña».";
    window.open("https://wa.me/" + celularWa(temporal.u.celular) + "?text=" + encodeURIComponent(t), "_blank", "noopener");
  });
  $("dialogo-temporal").addEventListener("close", function () { temporal = null; $("temporal-copiar").textContent = "Copiar"; });

  $("form-usuario").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var datos = {
      nombre: $("u-nombre").value.trim(), email: $("u-email").value.trim(),
      celular: $("u-celular").value.trim(), rol: $("u-rol").value,
    };
    if (datos.nombre.length < 2) { $("editor-error").textContent = "Escribe el nombre."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) { $("editor-error").textContent = "Correo inválido."; return; }
    var cel = datos.celular.replace(/[\s\-().]/g, "");
    if (cel && !/^\+?[0-9]{10,15}$/.test(cel)) { $("editor-error").textContent = "El celular debe tener 10 dígitos."; return; }
    var b = $("editor-guardar"); b.disabled = true;
    try {
      if (editando) {
        await llamar("admin-usuarios", Object.assign({ accion: "editar", id: editando.id, foto: fotoNueva, quitar_foto: quitarFoto }, datos));
        $("editor").close(); avisar("estado-config", "Cambios guardados.");
      } else {
        var r = await llamar("admin-usuarios", Object.assign({ accion: "crear", foto: fotoNueva }, datos));
        $("editor").close();
        mostrarTemporal(r.password_temporal, { nombre: datos.nombre, email: datos.email.toLowerCase(), celular: cel });
      }
      cargarUsuarios();
    } catch (e) { $("editor-error").textContent = e.message; }
    b.disabled = false;
  });

  $("editor-password").addEventListener("click", async function () {
    if (!editando || !confirm("¿Generar una contraseña temporal nueva para " + editando.nombre + "? La actual dejará de funcionar.")) return;
    try {
      var r = await llamar("admin-usuarios", { accion: "password", id: editando.id });
      var u = editando; $("editor").close(); mostrarTemporal(r.password_temporal, u);
    } catch (e) { $("editor-error").textContent = e.message; }
  });

  $("editor-estado").addEventListener("click", async function () {
    if (!editando) return;
    var activar = !editando.activo;
    if (!activar && !confirm("¿Dar de baja a " + editando.nombre + "? Ya no podrá iniciar sesión.")) return;
    try {
      await llamar("admin-usuarios", { accion: "estado", id: editando.id, activo: activar });
      $("editor").close(); avisar("estado-config", activar ? "Usuario reactivado." : "Usuario dado de baja."); cargarUsuarios();
    } catch (e) { $("editor-error").textContent = e.message; }
  });

  $("editor-eliminar").addEventListener("click", async function () {
    if (!editando || !confirm("¿Eliminar definitivamente a " + editando.nombre + "? No se puede deshacer. Su historial en el log se conserva.")) return;
    try {
      await llamar("admin-usuarios", { accion: "eliminar", id: editando.id });
      $("editor").close(); avisar("estado-config", "Usuario eliminado."); cargarUsuarios();
    } catch (e) { $("editor-error").textContent = e.message; }
  });

  document.querySelectorAll("[data-cerrar]").forEach(function (b) {
    b.addEventListener("click", function () { b.closest("dialog").close(); });
  });

  // ---------- configuración: log ----------
  var ACCIONES = {
    consulta: "Consultó la contraseña", copia: "Copió la contraseña", whatsapp: "Envió por WhatsApp", compartir: "Compartió la contraseña",
    alta: "Dio de alta", edicion: "Editó", baja: "Dio de baja", reactivacion: "Reactivó", eliminacion: "Eliminó", password: "Restableció la contraseña de",
  };
  var CAMPOS = { email: "correo", nombre: "nombre", celular: "celular", rol: "rol", foto: "foto" };

  function filaLog(r, tipo) {
    var cabeza = '<p class="r-cabeza"><span>' + esc(fmtHora.format(new Date(r.created_at))) + "</span>";
    if (tipo === "pass") {
      return '<li class="registro">' + cabeza + "<span>Pass del " + esc(fmtCorta.format(aUTC(r.fecha_pass))) + "</span></p>" +
        '<p class="r-accion">' + esc(ACCIONES[r.accion] || r.accion) + '</p><p class="r-detalle">' + esc(r.usuario_email) + "</p></li>";
    }
    var det = r.detalle && r.detalle.campos && r.detalle.campos.length
      ? " · " + r.detalle.campos.map(function (c) { return CAMPOS[c] || c; }).join(", ")
      : r.detalle && r.detalle.rol ? " · rol " + r.detalle.rol : "";
    return '<li class="registro">' + cabeza + "<span>" + esc(r.actor_email) + "</span></p>" +
      '<p class="r-accion">' + esc(ACCIONES[r.accion] || r.accion) + '</p><p class="r-detalle">' + esc(r.objetivo_email + det) + "</p></li>";
  }

  async function cargarLog(reiniciar) {
    if (reiniciar) { log.cursor = null; $("lista-log").innerHTML = ""; }
    var tipo = $("log-tipo").value;
    try {
      var d = await llamar("admin-usuarios", { accion: "bitacora", tipo: tipo, dias: Number($("log-dias").value), cursor: log.cursor || undefined });
      var html = d.registros.map(function (r) { return filaLog(r, d.tipo); }).join("");
      if (reiniciar && !html) html = '<li class="vacio">Sin movimientos en este periodo.</li>';
      $("lista-log").insertAdjacentHTML("beforeend", html);
      log.cursor = d.cursor; $("log-mas").hidden = !d.cursor;
    } catch (e) { avisar("estado-config", e.message, true); }
  }
  $("log-tipo").addEventListener("change", function () { cargarLog(true); });
  $("log-dias").addEventListener("change", function () { cargarLog(true); });
  $("log-mas").addEventListener("click", function () { cargarLog(false); });

  // ---------- arranque ----------
  sb.auth.getSession().then(function (r) {
    if (r.data && r.data.session) cargar(); else mostrar("login");
  });
})();
