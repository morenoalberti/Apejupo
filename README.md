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

## Dominio propio (opcional)

Settings → Pages → Custom domain. Un dominio `.es` cuesta unos 8 € al año.
