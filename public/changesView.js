// The Changes tab (plan 0033): what changed lately across the whole system,
// grouped by record, newest activity first. The words come from changes.js;
// the data from GET /changelog.
import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js'
import { DeviceLabel } from './deviceIcon.js'
import { hashForState } from './router.js'
import {
  KIND_LABELS, KIND_ORDER, RANGES, DEFAULT_RANGE, describeEntry, buildQuery, recordRoute,
  appendGroups, replaceGroup, moreLabel, kindName
} from './changes.js'

const PAGE = 20

function when (iso) {
  return new Date(iso).toLocaleString()
}

async function load (routesBase, query) {
  const res = await fetch(`${routesBase}/changelog${query}`)
  if (!res.ok) {
    throw new Error(res.status === 401
      ? 'You need to be logged into the SignalK admin UI to see the changes.'
      : `Request failed (server responded ${res.status}).`)
  }
  return res.json()
}

function GroupHeader ({ group, device }) {
  const route = recordRoute(group)
  const label = group.kind === 'device' && device
    ? html`<${DeviceLabel} device=${device} name=${group.name} size=${20} tone="text" />`
    : group.name || `Unnamed ${kindName(group.kind)}`
  return html`
    <div class="changes-head">
      <span class="changes-kind">${kindName(group.kind)}</span>
      <h3 class="changes-name">
        ${route
          ? html`<a class="route-link" href=${hashForState(route)}>${label}</a>`
          : html`<span>${label}</span>`}
      </h3>
      ${group.status === 'removed' && html`<span class="badge removed">removed</span>`}
      ${group.status === 'purged' && html`<span class="badge removed changes-purged">permanently deleted</span>`}
      <span class="changes-latest meta">${when(group.latest)}</span>
    </div>
  `
}

function GroupCard ({ group, device, names, onShowMore, busy }) {
  const ctx = { names, units: group.units }
  return html`
    <section class="card changes-group" data-testid="changes-group" data-kind=${group.kind}>
      <${GroupHeader} group=${group} device=${device} />
      <ul class="changes-entries">
        ${group.entries.map((entry) => {
          const d = describeEntry(group.kind, entry, ctx)
          return html`
            <li key=${entry.id} class="changes-entry changes-${d.tone}">
              <div class="changes-entry-head">
                <span class="changes-title">${d.title}</span>
                <span class="changes-time">${when(entry.timestamp)}</span>
              </div>
              ${d.lines.length > 0 && html`<ul class="changes-lines">${d.lines.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>`}
            </li>
          `
        })}
      </ul>
      ${group.more > 0 && html`
        <button type="button" class="link-btn changes-more" disabled=${busy} onClick=${() => onShowMore(group)}>${moreLabel(group)}</button>
      `}
    </section>
  `
}

export function ChangesTab ({ devices = [], routesBase }) {
  const [range, setRange] = useState(DEFAULT_RANGE)
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [kinds, setKinds] = useState([])
  const [text, setText] = useState('')
  const [applied, setApplied] = useState('')
  const [state, setState] = useState({ loading: true, error: null, groups: [], next: null })
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  // The text filter waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setApplied(text), 250)
    return () => clearTimeout(t)
  }, [text])

  const filters = { range, custom, kinds, text: applied }
  const key = JSON.stringify(filters)
  useEffect(() => {
    const mine = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    load(routesBase, buildQuery({ ...filters, limit: PAGE }))
      .then((data) => { if (mine === seq.current) setState({ loading: false, error: null, groups: data.groups, next: data.nextCursor }) })
      .catch((err) => { if (mine === seq.current) setState({ loading: false, error: err.message, groups: [], next: null }) })
  }, [key])

  const nextPage = async () => {
    setBusy(true)
    try {
      const data = await load(routesBase, buildQuery({ ...filters, limit: PAGE, cursor: state.next }))
      setState((s) => ({ ...s, groups: appendGroups(s.groups, data.groups), next: data.nextCursor }))
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }))
    } finally { setBusy(false) }
  }

  const showMore = async (group) => {
    setBusy(true)
    try {
      const data = await load(routesBase, buildQuery({ ...filters, id: group.id, entries: 1000 }))
      const full = data.groups.find((g) => g.kind === group.kind && g.id === group.id)
      if (full) setState((s) => ({ ...s, groups: replaceGroup(s.groups, full) }))
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }))
    } finally { setBusy(false) }
  }

  const toggleKind = (k) => setKinds((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]))
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const names = new Map(devices.map((d) => [d.id, d.name]))

  return html`
    <div class="changes-tab">
      <div class="changes-filters card">
        <div class="changes-filter-row" role="group" aria-label="Date range">
          ${RANGES.map((r) => html`
            <button key=${r.key} type="button" class="chip ${range === r.key ? 'active' : ''}" aria-pressed=${range === r.key}
              onClick=${() => setRange(r.key)}>${r.label}</button>
          `)}
          ${range === 'custom' && html`
            <label class="form-field compact"><span>From</span>
              <input type="date" value=${custom.from} max=${custom.to || undefined} onInput=${(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label class="form-field compact"><span>To</span>
              <input type="date" value=${custom.to} min=${custom.from || undefined} onInput=${(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          `}
        </div>
        <div class="changes-filter-row" role="group" aria-label="Kinds">
          ${KIND_ORDER.map((k) => html`
            <button key=${k} type="button" class="chip ${kinds.includes(k) ? 'active' : ''}" aria-pressed=${kinds.includes(k)}
              title=${k === 'circuit' ? 'Circuits follow the cables by themselves, so they are hidden unless picked' : undefined}
              onClick=${() => toggleKind(k)}>${KIND_LABELS[k]}</button>
          `)}
        </div>
        <label class="form-field compact search-field"><span>Search</span>
          <input type="search" value=${text} placeholder="Name or what happened" aria-label="Search the changes"
            onInput=${(e) => setText(e.target.value)} />
        </label>
      </div>
      ${state.error && html`<div class="error-banner">${state.error}</div>`}
      ${state.loading && state.groups.length === 0 && html`<div class="empty-state">Loading changes…</div>`}
      ${!state.loading && !state.error && state.groups.length === 0 && html`
        <div class="empty-state">Nothing changed in this range.</div>
      `}
      ${state.groups.map((g) => html`
        <${GroupCard} key=${g.kind + ':' + g.id} group=${g} device=${deviceById.get(g.id)} names=${names}
          onShowMore=${showMore} busy=${busy} />
      `)}
      ${state.next && html`
        <div class="changes-next"><button type="button" disabled=${busy} onClick=${nextPage}>Show more records</button></div>
      `}
    </div>
  `
}
