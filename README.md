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

## Tamaño de los tableros

El control de `torneo.html` permite reducir y ampliar la tarjeta completa de cada partida: tablero, piezas, nombres, Elo, banderas, relojes y resultado. Los menús, ventanas y botones de la página conservan su tamaño. La escala va del 75 % al 150 %, con límite según el ancho disponible, se recuerda en este navegador y se puede restablecer al 100 %.

El componente está aislado en `js/board-size.js` y `css/board-size.css`. El arrastre de tarjetas conserva su escala. Los controles de ronda, clasificación y emparejamientos están en la barra inmediatamente anterior a los tableros. Comprobación local con datos simulados: `node scripts/test_board_size.cjs`.

La elección de español o inglés se conserva al abrir menús y navegar, incluso cuando falla el servicio de traducción. El diccionario local incluye los controles y avisos de los tableros; los textos dinámicos restantes usan el traductor. Comprobación sin conexiones externas: `node scripts/test_language.cjs` (ambos idiomas, atributos de accesibilidad, errores de red/HTTP y recuperación del servicio).

En las partidas de `jugar-torneo.html`, las pantallas táctiles de poca altura usan un ajuste automático. En horizontal, nombres, relojes y acciones quedan junto al tablero; en vertical se conserva su distribución habitual. Las casillas mantienen un tamaño mínimo según el ancho disponible. Al cambiar de orientación la vista se sitúa en la partida y al volver se recupera la posición anterior, sin recolocar la página con cada jugada. Comprobación aislada: `node scripts/test_playing_mobile.cjs` (19 tamaños, arena y suizo, ambos idiomas, Chromium y WebKit si está instalado, pulsaciones y arrastre táctil).

## Comentaristas en ventana flotante

En `torneo.html`, un único botón abre la emisión asociada al torneo que se está viendo. Si no hay una emisión programada en ese momento, el botón queda gris y debajo aparece la próxima hora de emisión en Madrid; si solo se conoce el inicio de la ronda, se identifica como tal. Sin horario publicado se indica «por confirmar». La lista de torneos invita a abrir un torneo, sin tarjetas ni selectores de canales genéricos.

La asociación se establece por ID de torneo/ronda, nombre exacto, vídeo concreto publicado en la descripción del torneo o relaciones comprobadas en `APEJUPO.commentary` (`js/data.js`). Un canal genérico por sí solo no identifica qué torneo se está comentando. El calendario aporta los horarios, no una comprobación en tiempo real de la señal del emisor. El Worker conserva el canal de Kick y los identificadores del evento. Solo se admiten los reproductores de YouTube, Twitch y Kick.

El reproductor flotante se mueve con ratón, dedo o flechas del teclado. Permite cambiar de tamaño, minimizar (conserva el sonido), volver a la página y cerrar (detiene la reproducción). Mover, minimizar o acoplar conserva el mismo reproductor. Cambiar de ronda detiene el vídeo anterior.

`js/streams.js` conserva el consentimiento para contenidos de terceros de `js/util.js`. Estilos en `css/streams.css`. Comprobación local: `node scripts/test_stream_window.cjs` (Playwright y Chrome/Edge); sustituye las emisiones por un vídeo de prueba y no genera visitas de analítica. También comprueba que la lista de partidas mantiene blancas, negras y resultados en columnas.

La cabecera de los tableros muestra el inicio de la ronda publicado por Lichess en `Europe/Madrid`, con fecha y cambio de horario de verano automático. Si falta el horario, indica «por confirmar». La ronda, el intervalo de fechas, el formato, el ritmo y el resumen de jugadores/Elo/países llevan versiones explícitas en español e inglés, sin depender del traductor automático para esas líneas. El colector de emisiones se comprueba con `node scripts/test_event_streams.mjs`.

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
