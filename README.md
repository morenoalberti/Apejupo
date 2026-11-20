# Apejupo

Web del equipo de ajedrez Apejupo: directos de Lichess, noticias automáticas, calendario y equipo.

## Probar en local

```bash
python scripts/update_news.py
python -m http.server 8080
```

Abre http://localhost:8080.

## Editar contenido

- Jugadores y eventos: `js/data.js`
- Fuentes de noticias: `FEEDS` en `scripts/update_news.py`

## Publicar gratis (GitHub Pages)

1. Crea un repositorio vacío en GitHub (por ejemplo `apejupo`).
2. Sube el proyecto:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/apejupo.git
   git push -u origin main
   ```
3. En el repositorio: Settings → Pages → Source: **GitHub Actions**.
4. Listo. El workflow `.github/workflows/deploy.yml` se ejecuta en cada push y cada 30 minutos:
   descarga las noticias y vuelve a publicar la web. La URL será `https://TU_USUARIO.github.io/apejupo/`.

Los directos de Lichess se cargan en el navegador de cada visitante, así que siempre están al día.

## Estadísticas de visitas

El seguimiento usa **Cloudflare Web Analytics**, con instalación manual para **Apejupo**, dominio `apejupo.com` (incluido `www.apejupo.com`). La web sigue alojada en GitHub Pages; este servicio de estadísticas no necesita un servidor propio.

Las páginas incluyen `js/analytics.js`. El cargador solo actúa por HTTPS en `apejupo.com` y `www.apejupo.com`, respeta Do Not Track y Global Privacy Control y evita cargar el beacon dos veces. No se carga analítica en local ni en dominios de pruebas. Cloudflare mide visitas y rendimiento sin cookies ni identificadores persistentes en el navegador.

Activación: en Cloudflare → Web Analytics → Añadir sitio, registrar `apejupo.com` y copiar el valor público `token` del bloque `data-cf-beacon` de «Gestionar sitio» en la variable `token` de `js/analytics.js`. Un token vacío o inválido desactiva el seguimiento. Usar la instalación manual y evitar la inyección automática para que las preferencias de privacidad se apliquen desde este cargador. No introducir claves API ni credenciales de Cloudflare en el código.

Las estadísticas nuevas se consultan en Cloudflare → Web Analytics. El historial de los servicios anteriores no se migra automáticamente. Las pruebas deben interceptar el beacon y la recogida para no generar visitas ficticias. Retirar el seguimiento de Apejupo no cancela el servidor compartido ni modifica las estadísticas de otras webs.

## Servidor auxiliar

El Worker `worker/src/index.js` sirve las fuentes que no permiten lectura directa desde el navegador. `?players=ID` obtiene los jugadores y la clasificación pública de un torneo de Lichess, con CORS y caché de 60 segundos. Solo admite identificadores alfanuméricos de ocho caracteres. Para publicar cambios del Worker: `npx wrangler deploy --config worker/wrangler.toml`.

## Galería de fotos

`fotos.html` permite arrastrar fotos; el navegador las reduce a 2000 px en WebP, crea una miniatura y las envía al Worker, que las guarda en el bucket R2 `apejupo-fotos`. Ver la galería es público; subir pide la clave del club y borrar, la de administración. Las claves son secretos del Worker (`FOTOS_CLAVE` y `FOTOS_ADMIN`) y nunca van en el repositorio; en local se leen de `worker/.dev.vars`.

Puesta en marcha (una sola vez): activar R2 en el panel de Cloudflare y después

```bash
npx wrangler r2 bucket create apejupo-fotos
npx wrangler secret put FOTOS_CLAVE --config worker/wrangler.toml
npx wrangler secret put FOTOS_ADMIN --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

## Dominio propio (opcional)

Settings → Pages → Custom domain. Un dominio `.es` cuesta unos 8 € al año.
