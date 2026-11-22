# Acceso alternativo a torneos

Puerta HTTP y WebSocket al Worker existente de Apejupo. Permite servir las peticiones de torneos, cuentas y retos desde otro proveedor cuando las direcciones públicas de Cloudflare no responden desde una red. No copia almacenamiento, no registra contraseñas ni crea una segunda base de datos. Las sesiones y los permisos los sigue comprobando el Worker original.

El destino es fijo; solo se admiten las rutas del servicio y los orígenes de la web. La conexión con el Worker conserva HTTPS y la verificación de certificados. No se sustituyen direcciones IP en los ordenadores de los visitantes.

Publicado en `https://apejupo-conexion.onrender.com`. `render.yaml` configura el servicio gratuito, que sigue la rama `codex/tournament-gateway`. Pruebas: `npm ci` y `npm test` en esta carpeta. Antes de cambiar el destino de la web se comprobaron HTTP, preflight CORS, las sesiones rechazadas sin autenticación y WebSocket con los torneos conservados y el servicio de retos.

El plan gratuito de Render se suspende tras 15 minutos sin tráfico y puede tardar aproximadamente un minuto en arrancar de nuevo. La web espera hasta 75 segundos y reintenta solo la lectura del listado durante el arranque; las operaciones de escritura nunca se repiten automáticamente. El Worker ve a Render como origen de las peticiones: los límites por IP se comparten entre quienes usen esta puerta; no se confía en IPs declaradas por el navegador. Para grupos grandes será necesario validar de forma autenticada la IP que recibe el proxy, o usar un dominio y alojamiento propios para el servicio.
