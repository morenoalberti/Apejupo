# Torneos propios de Apejupo

Implementación local de la sección **Torneo**, en `jugar-torneo.html`. Este servicio es independiente de `worker/wrangler.toml`. No se ha desplegado ni se han modificado recursos en Cloudflare.

## Arranque local (Windows)

Desde la raíz del proyecto, en una terminal:

```powershell
python scripts/dev_server.py 8087
```

En otra terminal:

```powershell
cd worker/tournaments
npm ci
# Solo desarrollo: crear .dev.vars si aún no existe.
Set-Content .dev.vars 'TORNEOS_CLAVE="apejupo-local"'
npm run dev
```

Abrir `http://127.0.0.1:8087/jugar-torneo.html`. La clave del ejemplo solo sirve para el servidor local. `.dev.vars` está excluido de Git. No reutilizarla al publicar. La configuración también permite la web en el puerto 8080.

## Clave de organización durante las pruebas

Con `TORNEOS_SIN_CLAVE="1"` en `.dev.vars`, el servidor local no pide la clave para crear torneos ni para recuperar los controles, y la web oculta esos campos. Es solo para pruebas: no configurar esa variable al publicar. Sin ella, la clave es obligatoria.

## Funciones

- Listado público, creación protegida por clave de organización, inicio manual o programado.
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

## Preparación de una futura publicación

No ejecutar despliegues sin la autorización del usuario. Faltaría configurar una clave de organización real como secreto, desplegar este servicio con sus migraciones SQLite y poner la URL obtenida en `js/torneo-config.js`. Después, comprobar conexiones, persistencia, alarmas y consumo en Cloudflare antes de abrir inscripciones. La web actual se despliega al subir `main`: no hacer push de este trabajo mientras siga en revisión.

Referencias: [WebSockets y hibernación](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [alarmas](https://developers.cloudflare.com/durable-objects/api/alarms/), [cuotas](https://developers.cloudflare.com/durable-objects/platform/pricing/), [chess.js](https://jhlywa.github.io/chess.js/).
