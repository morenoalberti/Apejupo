// Quiénes somos: ficha de inscripción (nombre, teléfono y email).
// La ficha llega a contacto@apejupo.com (reenviado al administrador) a través de Web3Forms.
// Sin clave, o si el servicio no responde, se ofrece enviarla desde el correo del visitante.
(function () {
  var WEB3FORMS_KEY = "b536daaa-75e3-4a40-9c8a-60e8b601def5"; // clave de acceso de web3forms.com: es pública por diseño (solo permite enviar a contacto@apejupo.com)
  var dlg = document.getElementById("insc"), form = document.getElementById("insc-f");
  if (!dlg || !form) return;
  var hecho = document.getElementById("insc-hecho"), err = document.getElementById("insc-err");
  var boton = form.querySelector(".insc-enviar");
  var DESTINO = "contacto" + "@" + "apejupo.com";

  function abrir() {
    form.hidden = false; hecho.hidden = true; err.hidden = true;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    setTimeout(function () { form.elements.nombre.focus(); }, 50);
  }
  function cerrar() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }

  Array.prototype.forEach.call(document.querySelectorAll("[data-inscribete]"), function (b) { b.addEventListener("click", abrir); });
  if (location.hash === "#inscribete") abrir(); // viene del botón «Inscríbete» de la portada
  dlg.addEventListener("click", function (e) {
    if (e.target.closest("[data-cerrar]") || e.target === dlg) cerrar(); // también al pulsar fuera de la ficha
    var c = e.target.closest("[data-por-correo]");
    if (c) { e.preventDefault(); porCorreo(); }
  });

  function fallo(msg, campo, conCorreo) {
    err.innerHTML = "";
    err.appendChild(document.createTextNode(msg));
    if (conCorreo) {
      var a = document.createElement("a"); a.href = "#"; a.setAttribute("data-por-correo", ""); a.textContent = "enviarla por correo";
      err.appendChild(document.createTextNode(" También puedes ")); err.appendChild(a); err.appendChild(document.createTextNode("."));
    }
    err.hidden = false;
    if (campo) campo.focus();
  }
  function listo(enviada) {
    hecho.querySelector("h2").textContent = enviada ? "¡Inscripción enviada!" : "¡Ya casi está!";
    hecho.querySelector(".insc-hecho-txt").hidden = !enviada;
    hecho.querySelector(".insc-hecho-mail").hidden = enviada;
    form.hidden = true; hecho.hidden = false;
    if (enviada) form.reset();
  }
  function datos() {
    var f = form.elements;
    return { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), email: f.email.value.trim(), acepto: f.acepto.checked, botcheck: f.botcheck && f.botcheck.checked };
  }
  // Alternativa: abre el correo del visitante con la ficha escrita
  function porCorreo() {
    var d = datos();
    var cuerpo = "Hola, quiero inscribirme en Apejupo Chess Club.\n\n" +
      "Nombre: " + d.nombre + "\nTeléfono: " + d.telefono + "\nEmail: " + d.email + "\n\n" +
      "He leído y acepto la política de privacidad (https://apejupo.com/privacidad.html).";
    location.href = "mailto:" + DESTINO + "?subject=" + encodeURIComponent("Inscripción: " + d.nombre) + "&body=" + encodeURIComponent(cuerpo);
    listo(false);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = form.elements, d = datos();
    if (d.nombre.length < 2) return fallo("Escribe tu nombre.", f.nombre);
    if (!/^[+0-9 ()-]{9,20}$/.test(d.telefono) || d.telefono.replace(/\D/g, "").length < 9) return fallo("Revisa el teléfono: debe tener al menos 9 cifras.", f.telefono);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return fallo("Revisa el email: parece que no es correcto.", f.email);
    if (!d.acepto) return fallo("Para enviar la ficha tienes que aceptar la política de privacidad.", f.acepto);
    err.hidden = true;
    if (d.botcheck) return listo(true); // casilla trampa marcada: es un robot, no se envía nada
    if (!WEB3FORMS_KEY) return porCorreo();

    boton.disabled = true; var txt = boton.innerHTML; boton.textContent = "Enviando…";
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: "Nueva inscripción en Apejupo: " + d.nombre,
        from_name: "Web de Apejupo Chess Club",
        replyto: d.email,
        Nombre: d.nombre, "Teléfono": d.telefono, Email: d.email,
        Privacidad: "Ha aceptado la política de privacidad"
      })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok && j.success; }); })
      .catch(function () { return false; })
      .then(function (ok) {
        boton.disabled = false; boton.innerHTML = txt;
        if (ok) return listo(true);
        fallo("No se ha podido enviar ahora mismo. Inténtalo de nuevo en un momento.", null, true);
      });
  });
})();
