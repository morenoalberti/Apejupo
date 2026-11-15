# Torneos propios de Apejupo

Implementación local de la sección **Torneo**, en `jugar-torneo.html`. Este servicio es independiente de `worker/wrangler.toml`.

## Arranque local (Windows)

Desde la raíz del proyecto, en una terminal:

```powershell
python scripts/dev_server.py 8087
```

En otra terminal:

```powershell
cd worker/tournaments
npm ci
# Solo desarrollo: crear .dev.vars a partir de la plantilla si aún no existe.
if (-not (Test-Path .dev.vars)) { Copy-Item .dev.vars.example .dev.vars }
npm run dev
```

Abrir `http://127.0.0.1:8087/jugar-torneo.html`. `.dev.vars.example` muestra todas las variables; cambia sus claves, que solo sirven para el servidor local. `.dev.vars` está excluido de Git. No reutilizar esas claves al publicar. La configuración también permite la web en el puerto 8080.

## Organizar torneos

Crear un torneo pide la sesión de una cuenta con el correo confirmado. El torneo queda unido a esa cuenta: si su organizador lo abre desde otro dispositivo con la sesión iniciada, recibe allí los controles (empezar, editar, borrar). Las pruebas crean una cuenta de organizador nueva con `test/organizador.js`.

## Funciones

- Listado público. Como en Lichess, organiza cualquier cuenta con el correo confirmado (como mucho 5 torneos cada 24 horas por cuenta); inicio manual o programado.
- Entre 2 y 128 jugadores; inscripción por nombre o alias, sin cuentas ni correo. La identidad es una credencial aleatoria de 256 bits guardada en el navegador; el servidor solo conserva su SHA-256.
- Sistema suizo de club, entre 1 y 9 rondas, ajustado a los inscritos. Aproxima puntuaciones y colores, busca emparejamientos sin repeticiones y reparte descansos. Si las retiradas obligan a repetir un enfrentamiento, lo comunica. No es un emparejador homologado FIDE.
- Ritmos 1, 2, 3, 5, 10 y 15 minutos; incrementos de 0, 2, 3, 5 y 10 segundos. Arena de 3 minutos a 2 horas.
- Jugadas validadas por chess.js 1.4.0 en el servidor. Jaque mate, ahogado, material insuficiente, enroque, captura al paso, promoción a las cuatro piezas y tablas automáticas por triple repetición o 50 movimientos.
- Relojes controlados por el servidor. Una alarma agenda el próximo vencimiento; no necesita jugadores conectados ni un proceso ejecutándose cada segundo.
- Tablas ofrecidas/aceptadas/rechazadas, abandono y retirada de futuras rondas.
- Siguiente ronda automática tras 30 segundos. Puntos, Buchholz, Sonneborn-Berger, victorias y número de sorteo como desempates; los descansos valen 1 punto y no aportan puntos de rival al Buchholz.
- Espectadores, selección de tableros y rondas, giro de tablero, interacción por casillas, arrastre con ratón y navegación con teclado.
- Reconexión y recarga desde el mismo navegador, revisión de posiciones terminadas y descarga PGN. Las partidas activas no se exportan desde la API.
- Recuperación de los controles de organización con su clave, retiradas de inscritos antes de comenzar y cancelación con confirmación.

No hay cuentas verificadas, clasificación Elo, premios, chat ni detección automática de trampas. No se garantiza una identidad por persona: borrar datos o cambiar de navegador crea otra identidad. El análisis con motor no está integrado en esta sección; las partidas terminadas se revisan en el tablero o se exportan.

## Retos entre jugadores

`retar.html` (menú Torneos → Retar) permite retar por su nick a otro jugador **que esté conectado en ese momento**. Hace falta cuenta con el correo confirmado.

- `ChallengeHub` (Durable Object `RETOS`): cada pestaña con sesión abre un WebSocket a `/api/retos/socket` y manda la sesión en el primer mensaje. Así se sabe quién está en línea (ping cada 30 s).
- Al retado le aparece en cualquier página un cuadro centrado «X te reta a una partida» con el ritmo, su color y una barra de 60 s. Si no responde, el reto caduca. Un reto nuevo sustituye al anterior del mismo jugador.
- Al aceptar se crea una sala de torneo de dos jugadores y una ronda (`t.challenge`), sin pasar por el listado. Cada navegador recibe su credencial de jugador y va solo a `jugar-torneo.html?id=…`. La partida empieza en cuanto los dos tienen el tablero abierto, o a los 30 s si alguno no llega. El color es el que eligió quien reta, o al azar.
- En la sala de un reto solo se ve el tablero bajo la cabecera de la web, y al lado el **marcador entre los dos** (victorias de cada uno y tablas). Se guarda en `AccountStore` (tabla `duels`, cada partida una sola vez) y sigue sumando en las revanchas y en los retos futuros. Si se borra una cuenta, se borran sus marcadores.
- Al terminar, los dos tienen el botón **Revancha**: manda un reto con el mismo ritmo y los colores cambiados, que el rival ve como «X te pide la revancha».

Prueba: `npm run test:retos` (dos clientes: reto a desconectado, rechazo, aceptación, colores, inicio automático y revancha).

## Administración de usuarios

`admin-usuarios.html` (sin enlace en el menú y fuera de los buscadores) lista las cuentas registradas: nick, correo, si está confirmada, fecha de alta, última actividad y sesiones abiertas, con totales, búsqueda, filtros y descarga en CSV. Desde ahí se puede confirmar una cuenta a mano, reenviar el correo de confirmación o borrar una cuenta.

Todo pide la clave `CUENTAS_ADMIN` (secreto del Worker, mínimo 12 caracteres), que viaja en la cabecera `Authorization`. Diez claves erróneas en 15 minutos desde la misma IP bloquean el acceso un rato. Sin el secreto configurado, la página responde que la administración no está disponible. En local se lee de `.dev.vars`; al publicar: `npx wrangler secret put CUENTAS_ADMIN`, con una clave distinta de la local.

La «última actividad» se apunta al crear la cuenta, al entrar y al abrir la web con la sesión iniciada (como mucho una vez por hora). Las cuentas creadas antes de este cambio aparecen sin actividad hasta que vuelvan a entrar. Prueba: `npm run test:admin`.

## Arquitectura y consumo

- `TournamentDirectory`: registro de hasta 30 torneos creados en los últimos 30 días y limitación de intentos fallidos de organización (8 cada 15 minutos por huella IP).
- `TournamentRoom`: un Durable Object SQLite por torneo; estado y alarma guardados juntos. Hasta 160 conexiones por sala entre participantes, espectadores y pestañas.
- WebSockets con hibernación y respuesta automática a ping/pong. El navegador dibuja los relojes a partir del estado autoritativo; no envía actualizaciones por segundo.
- Las acciones de una sala se serializan. El número de jugada impide que un reenvío duplique movimientos. No se acepta el reloj, el resultado ni el rol que declare el cliente.
- Tokens por WebSocket en el primer mensaje, nunca en la URL. Orígenes permitidos explícitos, peticiones de hasta 4 KB y mensajes de hasta 2 KB. Límite de 24 acciones por conexión cada 5 segundos.
- Las partidas terminadas caducan a los 30 días; el directorio solo lista torneos creados en los últimos 30 días. Los torneos en espera también caducan. No se guardan IP sin procesar en el estado de las salas.

El límite de 128 jugadores (y 400 conexiones por torneo, entre jugadores, espectadores y pestañas de tableros) sale de una prueba de carga local con suizos de 32 a 512 jugadores. Como en Lichess, una jugada normal viaja sola (unos 1,1 KB) a todas las conexiones; el estado completo solo se manda al cambiar algo de fondo (resultados, emparejamientos, inscripciones), se agrupa en un envío cada 300 ms como mucho y su parte común se calcula una sola vez. Con 128 jugadores y 32 espectadores, una jugada llega a todos en unos 50 ms y el cambio de ronda tarda menos de 1 s (más los 30 s de descanso). Con 256 cada jugada cuesta unos 25-30 ms de servidor, la mitad en guardar el torneo entero: para pasar de 128 habría que guardar cada partida por separado. Las pruebas locales no miden cuotas ni latencia de Cloudflare: antes de un torneo grande conviene revisar el consumo en la cuenta.

## Verificación

Con los dos servidores locales activos:

```powershell
cd worker/tournaments
npm test
npm run test:integration
npm run test:browser
npm run check
```

- Unitarias: reglas, permisos, relojes, persistencia lógica, retiradas, 32 jugadores/5 rondas y descansos impares.
- Integración: 32 clientes WebSocket, 16 tableros simultáneos, espectador, jugadas, reconexión, controles de acceso y PGN.
- Navegador: Microsoft Edge instalado; cinco contextos independientes, dos rondas, desconexión y recarga, tablas, abandono, revisión y descarga. Siete anchos entre 320 y 1440 px en temas claro y oscuro. Artefactos en `build/torneo-qa`.
- `check` es únicamente un empaquetado con `--dry-run`; no publica.

Las pruebas crean torneos y jugadores de prueba únicamente en el almacenamiento local de Wrangler. No acceden a la web ni al Worker publicados.

## Publicación

Publicado en `https://apejupo-torneos.chessrival-worker.workers.dev` (`npx wrangler deploy` desde esta carpeta). La web lo usa desde `js/torneo-config.js`. Secretos necesarios (`npx wrangler secret put NOMBRE`): `CUENTAS_ADMIN` (admin-usuarios.html) y `RESEND_API_KEY` (correos de confirmación y recuperación, con el dominio apejupo.com verificado en Resend). Nunca configurar `CUENTAS_DESARROLLO` en producción. `TORNEOS_CLAVE` y `TORNEOS_SIN_CLAVE` ya no se usan: organizar pide una cuenta.

Referencias: [WebSockets y hibernación](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [alarmas](https://developers.cloudflare.com/durable-objects/api/alarms/), [cuotas](https://developers.cloudflare.com/durable-objects/platform/pricing/), [chess.js](https://jhlywa.github.io/chess.js/).

## Cuentas de jugador

Opcionales, al estilo Lichess: nick + contraseña, con el correo para confirmar la cuenta y recuperar la contraseña (`src/accounts.js`, Durable Object `AccountStore` con SQLite).

- Contraseñas con PBKDF2-SHA256 (100.000 iteraciones y sal); sesiones (90 días) y enlaces de correo (24 h para confirmar, 1 h para recuperar) guardados solo como huella SHA-256.
- Sin confirmar el correo no se puede entrar. Al recuperar la contraseña se cierran todas las sesiones.
- Frenos: 5 registros por IP y hora, 20 intentos de entrada por IP y 10 por cuenta cada 15 minutos, 3 correos por cuenta y hora.
- Mismo mensaje si el nick no existe o la contraseña falla, y misma respuesta al pedir recuperación exista o no el correo.
- En un torneo, con la sesión abierta se juega con el nick de la cuenta y se recupera la plaza desde cualquier dispositivo; sin sesión, el alias no puede coincidir con el nick de una cuenta.
- Rutas: `POST /api/cuentas/{registro,entrar,reenviar,confirmar,recuperar,restablecer,yo,salir,borrar}`; la sesión va en `Authorization: Bearer`.
- Web: `js/cuenta.js` (botón de cabecera y ventana de entrar/registrarse), `cuenta.html` + `js/cuenta-pagina.js` (enlaces del correo, datos, salir y borrar la cuenta).

Antes de publicar: crear la cuenta de Resend, verificar el dominio apejupo.com (registros DNS que indica Resend) y guardar la clave con `npx wrangler secret put RESEND_API_KEY`. El remitente es `cuentas@apejupo.com` (se cambia con la variable `CORREO_REMITENTE`). Sin esa clave los correos solo se escriben en la consola. En local, `CUENTAS_DESARROLLO="1"` en `.dev.vars` devuelve el enlace del correo en la respuesta y relaja los frenos; nunca debe estar en producción.

Pruebas: `node --test test/accounts.integration.js` (con el servidor local en marcha).
