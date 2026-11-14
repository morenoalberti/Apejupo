// Servidor de torneos, cuentas y retos: en local, el de «npm run dev»; publicado, el Worker de Cloudflare.
window.APEJUPO_TORNEOS_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8789'
  : 'https://apejupo-torneos.chessrival-worker.workers.dev';
