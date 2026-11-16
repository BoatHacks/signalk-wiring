// The parts of list sorting that draw something (plan 0040): the remembered
// sort of one list, a clickable column header and the sort control of the card
// lists. The rules are in sort.js.
import { html, useState } from './vendor/preact-standalone.module.js'
import { nextSort, flipSort, readSort, writeSort, sortItems } from './sort.js'

// [sort, setSort, sorted]: the list's remembered sort and a function that sorts
// the items with it. `columns` maps a key to the value to sort by.
export function useSort (listKey, columns) {
  const [sort, setSortState] = useState(() => readSort(listKey, columns))
  const setSort = (value) => { setSortState(value); writeSort(listKey, value) }
  return [sort, setSort, (items) => sortItems(items, columns, sort)]
}

// A table header that sorts by its column when clicked: ascending, descending,
// then back to the default order.
export function SortHeader ({ label, k, sort, onSort }) {
  const active = sort && sort.key === k
  const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'
  return html`
    <th aria-sort=${active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" class="sort-header ${active ? 'active' : ''}" data-sort-key=${k}
        title=${`Sort by ${label}`} onClick=${() => onSort(nextSort(sort, k))}>${label}<span class=${'sort-arrow' + (active ? '' : ' idle')} aria-hidden="true">${arrow}</span></button>
    </th>
  `
}

// "Sort by" select and an ascending/descending button, for the card lists.
// `options` is [{ key, label }].
export function SortControl ({ options, sort, onChange }) {
  return html`
    <span class="sort-control">
      <label class="form-field compact"><span>Sort by</span>
        <select value=${sort ? sort.key : ''} data-testid="sort-select"
          onChange=${(e) => onChange(e.target.value ? { key: e.target.value, dir: sort ? sort.dir : 'asc' } : null)}>
          <option value="">Default order</option>
          ${options.map((o) => html`<option value=${o.key} key=${o.key}>${o.label}</option>`)}
        </select>
      </label>
      <button type="button" class="sort-direction" data-testid="sort-direction" disabled=${!sort}
        aria-label=${sort && sort.dir === 'desc' ? 'Descending' : 'Ascending'}
        title=${!sort ? 'Choose what to sort by first' : sort.dir === 'desc' ? 'Descending, click for ascending' : 'Ascending, click for descending'}
        onClick=${() => onChange(flipSort(sort))}>${sort && sort.dir === 'desc' ? '▼' : '▲'}</button>
    </span>
  `
}
