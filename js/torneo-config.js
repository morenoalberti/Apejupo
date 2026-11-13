// Desarrollo local. La dirección pública se configurará al autorizar la publicación.
window.APEJUPO_TORNEOS_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8789'
  : '';
