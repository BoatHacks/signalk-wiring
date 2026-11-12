// Hash routing: the address bar tracks the active tab and whatever is open
// there, as `#/`, `#/<tab>`, `#/circuits/<id>`, `#/devices/<id>`,
// `#/conduits/<id>`, `#/schematics/<id>` and `#/floorplan/<plan id>`. Same
// model as the stowage-mgmt plugin's hash router. Pure string and state
// functions, so they are tested without a DOM; only App touches
// window.location. Tools, forms, selections and zoom stay out of the URL.

export const TABS = ['circuits', 'cables', 'devices', 'batteries', 'conduits', 'load', 'zones', 'schematics', 'floorplan', 'changes']
export const DEFAULT_TAB = 'circuits'

// Tabs whose route may carry an id.
const ID_TABS = new Set(['circuits', 'devices', 'conduits', 'schematics', 'floorplan'])

// state: { tab, id }. An unknown tab is treated as the default tab.
export function hashForState (state) {
  const tab = state && TABS.includes(state.tab) ? state.tab : DEFAULT_TAB
  const id = state && state.id
  if (id && ID_TABS.has(tab)) return '#/' + tab + '/' + encodeURIComponent(id)
  return tab === DEFAULT_TAB ? '#/' : '#/' + tab
}

// Always returns { tab, id } with a known tab and id null or a string.
export function parseHash (hash) {
  const path = String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '')
  if (!path) return { tab: DEFAULT_TAB, id: null }
  const slash = path.indexOf('/')
  const tab = slash === -1 ? path : path.slice(0, slash)
  if (!TABS.includes(tab)) return { tab: DEFAULT_TAB, id: null }
  if (slash === -1 || !ID_TABS.has(tab)) return { tab, id: null }
  let id = path.slice(slash + 1)
  try { id = decodeURIComponent(id) } catch (err) { return { tab, id: null } }
  return { tab, id: id || null }
}
