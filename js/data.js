// Datos editables del equipo. Cambia estos valores a mano.
window.APEJUPO = {
  players: [
    { name: "Jugador 1", title: "Capitán", elo: 2000 },
    { name: "Jugador 2", title: "Tablero 2", elo: 1900 },
    { name: "Jugador 3", title: "Tablero 3", elo: 1800 },
    { name: "Jugador 4", title: "Tablero 4", elo: 1700 }
  ],
  events: [
    { date: "2026-11-07", title: "Liga por equipos · Ronda 1", place: "Por confirmar" },
    { date: "2026-11-21", title: "Torneo interno Apejupo", place: "Online (Lichess)" }
  ],
  // Streams en directo. Tipos:
  //  - twitch:  { type: "twitch", label, channel }      (twitch.tv/CANAL)
  //  - youtube: { type: "youtube", label, channelId }   (directo actual del canal; el ID empieza por UC...)
  //  - youtube: { type: "youtube", label, videoId }     (un vídeo o directo concreto)
  streams: [
    { type: "twitch", label: "Chess.com · Twitch", channel: "chess" },
    { type: "twitch", label: "Lichess · Twitch", channel: "lichess" },
    { type: "youtube", label: "Chess.com · YouTube", channelId: "UCXuU9AyEyTVQbckeEJox-6A" },
    { type: "youtube", label: "FIDE · YouTube", channelId: "UC9B47GnzCRFHTT1BIBWvStQ" }
  ]
};
// Las fuentes de noticias se configuran en scripts/update_news.py
