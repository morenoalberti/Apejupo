// Las pruebas locales usan dominios reservados; sus cuentas no aparecen como rivales.
export function registeredPlayerNicks(users) {
  return users.filter(user => !/(?:^|@|\.)(?:example\.(?:com|org|net)|test|invalid|localhost)$/i.test(String(user.email || '').trim()))
    .map(user => user.nick);
}
