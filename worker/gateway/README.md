# Acceso alternativo a torneos

Puerta HTTP y WebSocket al Worker existente de Apejupo. Permite servir las peticiones de torneos, cuentas y retos desde otro proveedor cuando las direcciones públicas de Cloudflare no responden desde una red. No copia almacenamiento, no registra contraseñas ni crea una segunda base de datos. Las sesiones y los permisos los sigue comprobando el Worker original.

El destino es fijo; solo se admiten las rutas del servicio y los orígenes de la web. La conexión con el Worker conserva HTTPS y la verificación de certificados. No se sustituyen direcciones IP en los ordenadores de los visitantes.

Pruebas: `npm ci` y `npm test` en esta carpeta. `render.yaml` prepara un servicio gratuito. Después de desplegarlo, hay que comprobar HTTP, preflight CORS y WebSocket con la URL real antes de cambiar `js/torneo-config.js` y publicar la web. La web actual conserva su configuración hasta completar esa comprobación.

El plan gratuito de Render se suspende tras 15 minutos sin tráfico y puede tardar aproximadamente un minuto en arrancar de nuevo. Antes de activarlo en la web, el primer listado debe tolerar ese arranque y mostrar que se está conectando. El Worker ve a Render como origen de las peticiones: los límites por IP se comparten entre quienes usen esta puerta; no se confía en IPs declaradas por el navegador. Para grupos grandes será necesario validar de forma autenticada la IP que recibe el proxy, o usar un dominio y alojamiento propios para el servicio.
