// Las pruebas locales usan dominios reservados; sus cuentas no aparecen como rivales ni en la clasificación.
const testAccount = user => /(?:^|@|\.)(?:example\.(?:com|org|net)|test|invalid|localhost)$/i.test(String(user.email || '').trim());

export function registeredPlayerNicks(users) {
  return users.filter(user => !testAccount(user)).map(user => user.nick);
}

// Clasificación pública del club (página ELO): solo nick, ELO, partidas y foto; nunca el correo.
// Orden: ELO de mayor a menor y, con el mismo ELO, por nick.
export function clubRanking(users, eloStart = 1500) {
  return users.filter(user => !testAccount(user))
    .map(user => ({
      nick: user.nick,
      elo: Number.isInteger(user.elo) ? user.elo : eloStart,
      games: Number(user.games) || 0,
      photo: user.photo_at ? `${user.id}?v=${user.photo_at}` : null
    }))
    .sort((a, b) => b.elo - a.elo || a.nick.localeCompare(b.nick, 'es', { sensitivity: 'base' }));
}
