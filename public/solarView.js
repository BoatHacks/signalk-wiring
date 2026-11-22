import { html, useState, useEffect } from './vendor/preact-standalone.module.js'
import { hashForState } from './router.js'
import { useLive } from './live.js'
import { LoadError } from './loadError.js'
import { StatusBadge } from './statusBadge.js'
import {
  arrayTitle, missingText, stringsText, allArrays, fmtV, fmtA, fmtW, pvReading, pvPathsToWatch, LEVEL_LABELS
} from './solar.js'

const BASE = '/plugins/signalk-wiring'
const RESOURCE_BASE = '/signalk/v2/api/resources'

async function getJson (url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`)
  return res.json()
}

function useSolarData () {
  const [state, setState] = useState({ loading: true, error: null, devices: [], arrays: [] })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setState((s) => (s.error ? { ...s, loading: true, error: null } : s))
    let cancelled = false
    Promise.all([getJson(`${RESOURCE_BASE}/wiringDevices`), getJson(`${BASE}/derived`)])
      .then(([map, derived]) => {
        if (!cancelled) setState({ loading: false, error: null, devices: Object.values(map), arrays: (derived && derived.arrays) || [] })
      })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, devices: [], arrays: [] }) })
    return () => { cancelled = true }
  }, [attempt])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

function DeviceLink ({ id, deviceById }) {
  const d = deviceById.get(id)
  return html`<a class="route-link" href=${hashForState({ tab: 'devices', id })}>${(d && d.name) || id}</a>`
}

function Stat ({ label, value, testid }) {
  return html`<div class="bank-stat"><div class="bank-stat-label">${label}</div><div class="bank-stat-value" data-testid=${testid}>${value}</div></div>`
}

function ArrayCard ({ array, deviceById, values }) {
  const incomplete = missingText(array, deviceById)
  const strings = stringsText(array, deviceById)
  const controllers = array.controllerIds.map((id) => deviceById.get(id)).filter(Boolean)
  const live = values ? controllers.map((c) => pvReading(c, values)).filter(Boolean).join('; ') : null
  return html`
    <div class="bank" data-testid="array-card">
      <div class="card bank-card">
        <h3 class="bank-title">${arrayTitle(array, deviceById)}${array.layout ? html` <span class="badge" data-testid="array-layout">${array.layout.label}</span>` : null}</h3>
        <ul class="bank-batteries">
          ${(array.strings && array.strings.length ? array.strings.flat() : array.panelIds).map((id) => html`<li key=${id}><${DeviceLink} id=${id} deviceById=${deviceById} /></li>`)}
        </ul>
        ${strings && html`<div class="meta bank-strings">Strings: ${strings}</div>`}
        <div class="bank-stats">
          <${Stat} label="Open circuit (Voc)" value=${fmtV(array.voc)} testid="array-voc" />
          <${Stat} label=${array.vocCold === null ? 'Voc, cold' : `Voc at ${array.coldTemperatureC} C`} value=${fmtV(array.vocCold)} testid="array-voc-cold" />
          <${Stat} label="At max power (Vmp)" value=${fmtV(array.vmp)} testid="array-vmp" />
          <${Stat} label="Short circuit (Isc)" value=${fmtA(array.iscA)} testid="array-isc" />
          <${Stat} label="At max power (Imp)" value=${fmtA(array.impA)} testid="array-imp" />
          <${Stat} label="Rated power" value=${fmtW(array.powerW)} testid="array-power" />
        </div>
        ${incomplete && html`<div class="meta bank-incomplete" data-testid="array-incomplete">Incomplete: ${incomplete}. No totals are shown until it is filled in.</div>`}
        ${array.assumedCoeff && array.vocCold !== null && html`<div class="meta" data-testid="array-assumed">Cold voltage assumes a Voc temperature coefficient of -0.30 %/C where none is entered.</div>`}
        <div class="bank-line"><span class="bank-line-label">Charge controller</span> ${controllers.length === 0 ? 'none found' : controllers.map((c, i) => html`<span key=${c.id}>${i > 0 ? ', ' : ''}<${DeviceLink} id=${c.id} deviceById=${deviceById} /></span>`)}</div>
        ${array.checks.map((c, i) => html`<div class=${'array-check array-check-' + c.level} key=${i} data-testid="array-check"><${StatusBadge} kind=${c.level} text=${LEVEL_LABELS[c.level] || c.level} /> ${c.message}</div>`)}
        ${values && html`<div class="bank-live" data-testid="array-live"><span class="bank-line-label">Live</span> ${live || 'no values yet'}</div>`}
      </div>
      ${array.warnings.map((w, i) => html`<div class="warning-banner" key=${i}>${w.message}</div>`)}
    </div>
  `
}

export function SolarTab () {
  const { loading, error, retry, devices, arrays } = useSolarData()
  const [liveOn, setLiveOn] = useState(false)
  const nameOf = (id) => { const d = devices.find((x) => x.id === id); return (d && d.name) || id }
  const paths = pvPathsToWatch(devices)
  const live = useLive(liveOn && paths.length > 0, 0, nameOf, { extraPaths: paths })
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const cards = allArrays(devices, arrays)
  return html`
    <div>
      <p class="meta">One card per solar array. Panels joined by a link on a cable form an array; a panel with no links is an array of one. The checks against the charge controller are advisory.</p>
      ${paths.length > 0 && html`
        <div class="battery-live">
          <button type="button" class=${liveOn ? 'active' : ''} data-testid="solar-live" onClick=${() => setLiveOn((v) => !v)}>${liveOn ? 'Live: on' : 'Live'}</button>
          ${liveOn && html`<span class="meta live-status">${live.error ? live.error : live.connected ? 'Connected to the SignalK stream.' : 'Connecting to the SignalK stream…'}</span>`}
        </div>
      `}
      ${loading && html`<div class="empty-state">Loading…</div>`}
      <${LoadError} message=${error} what="solar arrays" onRetry=${retry} />
      ${!loading && !error && cards.length === 0 && html`<div class="empty-state">No solar panels yet. Add a device of type Solar panel.</div>`}
      ${cards.map((array) => html`<${ArrayCard} key=${array.panelIds.join(',')} array=${array} deviceById=${deviceById} values=${liveOn ? live.values : null} />`)}
    </div>
  `
}
