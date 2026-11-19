import { fideFederations } from './federaciones-fide.js';

const names = new Intl.DisplayNames('es', { type: 'region' });
const specialNames = { ENG: 'Inglaterra', SCO: 'Escocia', TPE: 'China Taipéi', WLS: 'Gales' };
// Ranking abierto FIDE del 1 de noviembre de 2026.
// https://ratings.fide.com/top_federations.phtml
const topCodes = ['USA', 'IND', 'CHN', 'RUS', 'FRA', 'AZE', 'UZB', 'GER', 'UKR', 'ARM'];
const searchKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const federations = fideFederations.map(([code, region], index) => {
  const name = specialNames[code] ?? names.of(region);
  return { code, name, index, search: searchKey(`${name} ${code}`) };
}).sort((a, b) => a.name.localeCompare(b.name, 'es'));
const topFederations = topCodes.map(code => federations.find(federation => federation.code === code));
const otherFederations = federations.filter(federation => !topCodes.includes(federation.code));

function federationLabel(federation) {
  const flag = document.createElement('span');
  flag.className = 'to-federation-flag';
  flag.setAttribute('aria-hidden', 'true');
  flag.style.backgroundPosition = `${-(federation.index % 12) * 24}px ${-Math.floor(federation.index / 12) * 16}px`;
  const name = document.createElement('span');
  name.className = 'to-federation-name';
  name.textContent = federation.name;
  const code = document.createElement('span');
  code.className = 'to-federation-code';
  code.textContent = federation.code;
  return [flag, name, code];
}

export function createFederationPicker(value, trigger) {
  const dialog = document.createElement('dialog');
  dialog.id = 'to-federation-dialog';
  dialog.className = 'to-dialog to-federation-dialog';
  dialog.setAttribute('aria-labelledby', 'to-federation-title');
  dialog.innerHTML = `<header><h2 id="to-federation-title">Federación FIDE</h2><button type="button" class="btn-ghost" aria-label="Cerrar federaciones">×</button></header>
    <input id="to-federation-search" type="search" role="combobox" aria-label="Buscar federación" aria-autocomplete="list" aria-expanded="true" aria-controls="to-federation-options" placeholder="Buscar por nombre o código" autocomplete="off">
    <div id="to-federation-options" role="listbox" aria-label="Federaciones FIDE">
      <div id="to-federation-top" role="group" aria-labelledby="to-federation-top-title"><p id="to-federation-top-title">Top 10 FIDE</p></div>
      <div id="to-federation-others" role="group" aria-labelledby="to-federation-others-title"><p id="to-federation-others-title">Otras federaciones</p></div>
    </div>
    <p class="muted" role="status" hidden>No se encontraron federaciones.</p>`;
  document.body.append(dialog);
  const search = dialog.querySelector('input');
  const list = dialog.querySelector('[role="listbox"]');
  const empty = dialog.querySelector('[role="status"]');
  let visible = [], active = -1;
  const groups = [topFederations, otherFederations].map((entries, index) => {
    const element = list.children[index];
    const options = entries.map(federation => {
      const option = document.createElement('div');
      option.id = `to-federation-option-${federation.code}`;
      option.dataset.code = federation.code;
      option.setAttribute('role', 'option');
      option.append(...federationLabel(federation));
      return { option, federation };
    });
    element.append(...options.map(({ option }) => option));
    return { element, options };
  });

  function set(code) {
    value.value = code || 'ESP';
    const federation = federations.find(f => f.code === value.value);
    trigger.replaceChildren(...(federation ? federationLabel(federation) : [value.value]));
    trigger.setAttribute('aria-label', `Federación, ${federation?.name ?? value.value} (${value.value})`);
  }

  function highlight(index, scroll = true) {
    visible[active]?.classList.remove('is-active');
    active = index;
    const option = visible[active];
    if (option) {
      option.classList.add('is-active');
      search.setAttribute('aria-activedescendant', option.id);
      if (scroll) option.scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  }

  function filter() {
    highlight(-1);
    const query = searchKey(search.value);
    visible = groups.flatMap(({ element, options }) => {
      const matches = [];
      for (const { option, federation } of options) {
        option.hidden = !federation.search.includes(query);
        option.setAttribute('aria-selected', String(federation.code === value.value));
        if (!option.hidden) matches.push(option);
      }
      element.hidden = matches.length === 0;
      return matches;
    });
    list.classList.toggle('has-both', groups.every(group => !group.element.hidden));
    list.hidden = visible.length === 0;
    empty.hidden = visible.length > 0;
    list.scrollTop = 0;
    highlight(visible.length ? 0 : -1, false);
  }

  function choose(option) {
    if (!option) return;
    set(option.dataset.code);
    dialog.close();
  }

  trigger.addEventListener('click', () => {
    search.value = '';
    dialog.showModal();
    search.focus();
    filter();
  });
  dialog.addEventListener('close', () => trigger.focus());
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  list.addEventListener('click', event => choose(event.target.closest('[role="option"]')));
  search.addEventListener('input', () => filter());
  search.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(visible[active]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (visible.length) highlight(Math.max(0, Math.min(visible.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
    }
  });
  set(value.value);
  return { set };
}
