// Datos editables del equipo. Cambia estos valores a mano.
window.APEJUPO = {
  players: [
    // Opcional: "lichess" y "chesscom" con el usuario de cada plataforma para ver su rating en vivo en la página ELO.
    // Opcional: "fide" con el número FIDE del jugador para mostrar su foto del perfil de FIDE, o "foto" con una imagen
    // propia (por ejemplo "assets/equipo/jugador1.jpg"), que tiene prioridad.
    { name: "Jugador 1", title: "Capitán", elo: 2000, lichess: "", chesscom: "" },
    { name: "Jugador 2", title: "Tablero 2", elo: 1900 },
    { name: "Jugador 3", title: "Tablero 3", elo: 1800 },
    { name: "Jugador 4", title: "Tablero 4", elo: 1700 }
  ],
  events: [
    { date: "2026-11-07", title: "Liga por equipos · Ronda 1", place: "Por confirmar" },
    { date: "2026-11-21", title: "Torneo interno Apejupo", place: "Online (Lichess)" }
  ],
  // Asociaciones comprobadas por ID del torneo/grupo de Lichess. No se usan canales genéricos.
  // Se admiten eventIds (Chess.com), aliases (nombre exacto del evento) o urls de vídeos concretos de YouTube.
  commentary: {
    // Total Chess World Championship Tour Pilot 2026, grupo oficial de Lichess.
    uMS8kYeS: { eventIds: [30683], aliases: ["Total Chess World Championship"] },
    // FIDE World Chess Championship 2026 (Gukesh D. – Sindarov), torneo oficial de Lichess.
    qfkdt8mn: { eventIds: [29212], aliases: ["Salesforce FIDE World Championship Match"] }
  }
};
// Las fuentes de noticias se configuran en scripts/update_news.py
