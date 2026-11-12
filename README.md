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

Umami (`https://metricas.chessrival.net`) y PulseMetrics (`https://pulsemetrics.chessrival.net`) tienen registrado el sitio **Apejupo**, dominio `apejupo.com`.

Las 25 páginas incluyen `js/analytics.js`. El cargador solo actúa por HTTPS en `apejupo.com` y `www.apejupo.com`, respeta Do Not Track y Global Privacy Control, evita cargas duplicadas y excluye parámetros y fragmentos de las páginas. Solo contiene identificadores públicos; las claves administrativas permanecen en el servidor.

PulseMetrics recupera la lista actual de sitios y las estadísticas al abrir el programa con la conexión guardada. Las visitas anteriores a instalar el seguimiento no se pueden reconstruir. Las pruebas locales deben interceptar la recogida para no generar estadísticas ficticias; la comprobación final usa visitas reales a la web publicada.

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
