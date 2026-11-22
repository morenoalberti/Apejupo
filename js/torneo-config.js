// Torneos, cuentas y retos. Render conecta con el Worker original, que conserva todos los datos.
window.APEJUPO_TORNEOS_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8789'
  : 'https://apejupo-conexion.onrender.com';
// El servicio gratuito puede necesitar alrededor de un minuto en la primera conexión.
window.APEJUPO_TORNEOS_TIMEOUT = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 15000 : 75000;
