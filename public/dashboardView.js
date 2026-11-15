// The Dashboard page (plan 0038): the first screen. Statistics, what needs
// attention, live power in and out, battery banks and the switches that are on.
// All the working out is in dashboard.js; this file reads the data, keeps the
// one shared live stream and draws the cards. It sends nothing but GET requests.

import { html, useState, useEffect } from './vendor/preact-standalone.module.js'
import { hashForState } from './router.js'
import { useSettingsLoaded } from './settings.js'
import { limitsFrom } from './cableCheckView.js'
import { useLive } from './live.js'
import { useHistory, sparkline, sparklinePath } from './history.js'
import {
  dashboardStats, dashboardChecks, dashboardPaths, liveFlows, batteryCards, switchesOn, historyPaths,
  formatWatts, formatMetres, percentText, netText, readLivePref, writeLivePref
} from './dashboard.js'
import { fmtKwh, fmtAh } from './batteries.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'
const ROUTES_BASE = '/plugins/signalk-wiring'
const LIVE_PERIOD_MS = 5000
const RESOURCES = {
  devices: 'wiringDevices', cables: 'wiringWireRuns', circuits: 'wiringCircuits', conduits: 'wiringConduits',
  zones: 'wiringZones', schematics: 'wiringSchematics', plans: 'wiringPlans', backbones: 'wiringBackbones'
}

async function getJson (url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

// Every list the page counts, plus the banks (GET /derived) and the bus checks
// (GET /buses). The two plugin routes may be refused to some visitors: then
// the banks and bus checks are simply missing, never an error banner.
function useDashboardData () {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  useEffect(() => {
    let cancelled = false
    const lists = Object.entries(RESOURCES).map(([key, type]) =>
      getJson(`${RESOURCE_BASE}/${type}`).then((map) => [key, Object.values(map)]))
    const extra = [
      getJson(`${ROUTES_BASE}/derived`).then((d) => ['banks', d.banks || []]).catch(() => ['banks', []]),
      getJson(`${ROUTES_BASE}/buses`).then((b) => ['buses', b]).catch(() => ['buses', null])
    ]
    Promise.all([...lists, ...extra])
      .then((pairs) => { if (!cancelled) setState({ loading: false, error: null, data: Object.fromEntries(pairs) }) })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, data: null }) })
    return () => { cancelled = true }
  }, [])
  return state
}

function Link ({ href, children, ...rest }) {
  return html`<a class="route-link dash-link" href=${href} ...${rest}>${children}</a>`
}

function Spark ({ points }) {
  const s = sparkline(points, 100, 28)
  if (!s) return html`<span class="dash-spark empty" aria-hidden="true"></span>`
  return html`
    <svg class="dash-spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img"
      aria-label=${`Last hour, from ${s.min} to ${s.max}`}>
      <path d=${sparklinePath(s.runs)} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
    </svg>`
}

const STATUS_TEXT = { stale: 'stale', nodata: 'no data', novoltage: 'no voltage' }

// One entry of the power card: label, sparkline, value.
function FlowRow ({ entry, series, showSpark }) {
  const unit = entry.unit === 'A' ? ' A' : ' W'
  const counted = entry.status === 'ok'
  const value = entry.status === 'nodata' || entry.status === 'novoltage'
    ? html`<span class="dash-status">${STATUS_TEXT[entry.status]}</span>`
    : html`<span class="dash-value">${entry.unit === 'A' && entry.status !== 'ok' ? `${Math.round(entry.raw * 100) / 100}${unit}` : formatWatts(entry.watts)}</span>${entry.status === 'stale' ? html` <span class="dash-status">stale</span>` : ''}`
  const label = entry.deviceId
    ? html`<${Link} href=${hashForState({ tab: 'devices', id: entry.deviceId })}>${entry.label}<//>`
    : html`<span class="dash-label">${entry.label}</span>`
  return html`
    <li class=${'dash-row' + (counted ? '' : ' dim')} data-testid="flow-row" data-status=${entry.status}>
      ${label}
      ${showSpark && html`<${Spark} points=${series} />`}
      <span class="dash-reading">${value}</span>
    </li>`
}

function FlowColumn ({ title, side, history, testid }) {
  const total = side.totalW
  const stale = side.entries.filter((e) => e.status === 'stale').length
  const missing = side.entries.filter((e) => e.status === 'novoltage').length
  return html`
    <div class="dash-flow" data-testid=${testid}>
      <h3>${title}</h3>
      <div class="dash-total" data-testid=${testid + '-total'}>${total === null ? html`<span class="dash-none">no live data</span>` : formatWatts(total)}</div>
      ${stale > 0 && html`<div class="meta">${stale} stale, not counted</div>`}
      ${missing > 0 && html`<div class="meta">${missing} in amps with no voltage, not counted</div>`}
      <ul class="dash-list">
        ${side.entries.map((e) => html`<${FlowRow} key=${e.path} entry=${e} series=${history.series.get(e.path)} showSpark=${history.available} />`)}
      </ul>
      ${side.entries.length === 0 && html`<div class="meta">Nothing is metered here yet. Set a meter path on a device, or list sources in the plugin configuration.</div>`}
      <div class="meta">${side.mode === 'configured' ? 'From the list in the plugin configuration.' : 'Worked out from the meters on devices.'}</div>
    </div>`
}

// The numbers behind the net reading: each bank's voltage, current and power,
// and the difference between input and output where both are known.
function BatteryNumbers ({ cards, netW, flows }) {
  const rows = (cards || []).filter((c) => c.hasData && !c.stale && (c.voltage !== null || c.current !== null))
  const inW = flows.inputs.totalW
  const outW = flows.outputs.totalW
  return html`
    <div data-testid="battery-numbers">
      <ul class="dash-list">
        ${rows.map((c) => html`
          <li key=${c.key} class="dash-row dash-bnum"><span>${c.title}</span>
            <span class="meta">${[
              c.voltage !== null ? c.voltage.toFixed(2) + ' V' : null,
              c.current !== null ? `${Math.abs(c.current).toFixed(2)} A ${c.current > 0 ? 'out' : c.current < 0 ? 'in' : ''}`.trim() : null,
              c.powerW !== null ? formatWatts(Math.abs(c.powerW)) : null
            ].filter(Boolean).join(', ')}</span></li>`)}
      </ul>
      ${netW !== null && html`<div class="meta">Net: ${netW > 0 ? '' : netW < 0 ? '-' : ''}${formatWatts(Math.abs(netW)) || '0 W'}${netW > 0 ? ' out of' : netW < 0 ? ' into' : ' from'} the batteries.</div>`}
      ${inW !== null && outW !== null && html`<div class="meta">In ${formatWatts(inW) || '0 W'} minus out ${formatWatts(outW) || '0 W'} = ${formatWatts(Math.abs(inW - outW)) || '0 W'} ${inW - outW >= 0 ? 'surplus' : 'deficit'}.</div>`}
    </div>`
}

function LivePower ({ flows, battery, history, liveOn, liveError }) {
  if (!liveOn) return html`<div class="empty-state" data-testid="live-off">Live is off. Turn it on to see power in and out.</div>`
  const net = netText(battery.netW)
  return html`
    <div>
      ${liveError && html`<div class="meta" data-testid="live-error">${liveError}</div>`}
      <div class="dash-flows">
        <${FlowColumn} title="In" side=${flows.inputs} history=${history} testid="flow-in" />
        <${FlowColumn} title="Out" side=${flows.outputs} history=${history} testid="flow-out" />
        <div class="dash-flow" data-testid="flow-battery">
          <h3>Battery</h3>
          <div class="dash-total">${net === null ? html`<span class="dash-none">no live data</span>` : net}</div>
          <${BatteryNumbers} cards=${battery.cards} netW=${battery.netW} flows=${flows} />
          <div class="meta">Current times voltage from the battery monitor. It should roughly be input minus output.</div>
        </div>
      </div>
    </div>`
}

function Stat ({ label, value, href, note }) {
  const body = html`<span class="dash-stat-value">${value}</span><span class="dash-stat-label">${label}</span>${note && html`<span class="meta">${note}</span>`}`
  return href
    ? html`<${Link} href=${href} class="route-link dash-link dash-stat" data-testid="stat">${body}<//>`
    : html`<div class="dash-stat" data-testid="stat">${body}</div>`
}

const plural = (n, word) => (n === 1 ? word : word + 's')

const ROLE_WORDS = { consumer: 'consumers', source: 'sources', storage: 'storage', distribution: 'distribution', converter: 'converters', enclosure: 'enclosures' }

function Statistics ({ stats }) {
  const tab = (t) => hashForState({ tab: t })
  const len = stats.cableLength
  const roles = Object.entries(stats.devices.byRole).map(([r, n]) => `${n} ${ROLE_WORDS[r] || r}`).join(', ')
  const c = stats.completeness
  const b = stats.battery
  const missing = []
  if (c.cablesNoGauge) missing.push(`${c.cablesNoGauge} ${plural(c.cablesNoGauge, 'cable')} without gauge`)
  if (c.cablesNoLength) missing.push(`${c.cablesNoLength} without length`)
  if (c.cablesNoVoltage) missing.push(`${c.cablesNoVoltage} without voltage`)
  if (c.consumersUnrated) missing.push(`${c.consumersUnrated} ${plural(c.consumersUnrated, 'consumer')} without rating`)
  if (c.protectorsNoRating) missing.push(`${c.protectorsNoRating} ${plural(c.protectorsNoRating, 'fuse or breaker')} without rating`)
  return html`
    <div>
      <div class="dash-stats">
        <${Stat} label="devices" value=${stats.devices.total} href=${tab('devices')} note=${roles} />
        <${Stat} label="cables" value=${stats.cables} href=${tab('cables')} />
        <${Stat} label="circuits" value=${stats.circuits} href=${tab('circuits')} note=${`${stats.protection.protected} protected, ${stats.protection.unprotected} not`} />
        <${Stat} label="cable length" value=${formatMetres(len.totalM) || '0 m'} href=${tab('cables')}
          note=${len.none > 0 ? `${len.none} ${len.none === 1 ? 'cable has' : 'cables have'} no length` : len.measured > 0 ? `${len.measured} measured on the plan` : 'all recorded'} />
        <${Stat} label="conduits" value=${stats.conduits} href=${tab('conduits')} />
        <${Stat} label="buses" value=${stats.backbones} href=${tab('buses')} />
        <${Stat} label="zones" value=${stats.zones} href=${tab('zones')} />
        <${Stat} label="schematic pages" value=${stats.schematics} href=${tab('schematics')} />
        <${Stat} label="floorplans" value=${stats.floorplans} href=${tab('floorplan')} />
        <${Stat} label="battery capacity" value=${b.banks ? `${fmtAh(b.ah)}, ${fmtKwh(b.wh)}` : '-'} href=${tab('batteries')}
          note=${b.assumed12 > 0 ? `${b.assumed12} ${plural(b.assumed12, 'bank')} counted at 12 V` : b.unknown > 0 ? `${b.unknown} ${plural(b.unknown, 'bank')} without capacity` : null} />
        <${Stat} label="consumer load, summed" value=${formatWatts(stats.consumerLoad.watts) || '0 W'} href=${tab('load')}
          note=${stats.consumerLoad.unrated > 0 ? `${stats.consumerLoad.unrated} ${plural(stats.consumerLoad.unrated, 'consumer')} without rating` : null} />
      </div>
      <h3>Completeness</h3>
      <ul class="dash-list" data-testid="completeness">
        <li class="dash-plain">${missing.length ? missing.join(', ') + '.' : 'Cables and ratings are complete.'}</li>
        <li class="dash-plain">Devices on a floorplan: ${c.onFloorplan.count} of ${c.onFloorplan.of} (${percentText(c.onFloorplan.share)}).</li>
        <li class="dash-plain">Devices on a schematic: ${c.onSchematic.count} of ${c.onSchematic.of} (${percentText(c.onSchematic.share)}).</li>
      </ul>
    </div>`
}

const VERDICT_CLASS = { fail: 'check-fail', warning: 'check-warning', cannot: 'check-cannot' }
const VERDICT_WORDS = { fail: 'fail', warning: 'warning', cannot: 'cannot check' }

function Checks ({ checks }) {
  const c = checks
  const cableLine = [
    c.cables.fail && `${c.cables.fail} too small`,
    c.cables.warning && `${c.cables.warning} with a high voltage drop`,
    c.cables.cannot && `${c.cables.cannot} cannot be checked`
  ].filter(Boolean)
  const busLine = [
    c.buses.fail && `${c.buses.fail} failing`,
    c.buses.warning && `${c.buses.warning} with a warning`,
    c.buses.cannot && `${c.buses.cannot} cannot be checked`
  ].filter(Boolean)
  const group = (title, items, render) => items.length > 0 && html`
    <div class="dash-group"><h3>${title} (${items.length})</h3>
      <ul class="dash-list">${items.slice(0, 5).map(render)}</ul>
      ${items.length > 5 && html`<div class="meta">and ${items.length - 5} more</div>`}
    </div>`
  const nothing = c.attention === 0
  return html`
    <div>
      <p class="meta">Advisory only: this is not a safety guarantee. Check against the makers' data and the rules for your boat.</p>
      ${nothing && html`<div class="dash-ok" data-testid="checks-clear">Nothing needs attention.</div>`}
      ${cableLine.length > 0 && html`<p data-testid="cable-checks">Cables: ${cableLine.join(', ')}; ${c.cables.ok} ok.</p>`}
      ${c.worstCables.length > 0 && html`
        <ul class="dash-list" data-testid="worst-cables">
          ${c.worstCables.map((w) => html`
            <li key=${w.id} class="dash-row dash-check"><${Link} href=${w.href}>${w.label}<//>
              <span class=${'badge check-badge ' + VERDICT_CLASS[w.verdict]}>${w.text}</span>
              ${w.reason && html`<div class="meta dash-reason" data-testid="reason">${w.reason}</div>`}</li>`)}
        </ul>`}
      ${busLine.length > 0 && html`<p data-testid="bus-checks">Buses: ${busLine.join(', ')}; ${c.buses.ok} ok.</p>`}
      ${c.worstBuses.length > 0 && html`
        <ul class="dash-list" data-testid="worst-buses">
          ${c.worstBuses.map((b) => html`
            <li key=${b.id} class="dash-row dash-check"><${Link} href=${b.href}>${b.name}<//>
              <span class=${'badge check-badge ' + VERDICT_CLASS[b.verdict]}>${VERDICT_WORDS[b.verdict]}</span>
              ${(b.reasons || []).length > 0 && html`<ul class="dash-reasons" data-testid="reason">${b.reasons.map((r, i) => html`<li key=${i} class="meta">${r.title}: ${VERDICT_WORDS[r.verdict]}${r.text ? ', ' + r.text : ''}</li>`)}</ul>`}</li>`)}
        </ul>`}
      ${group('Circuits with no protection', c.unprotected, (x) => html`<li key=${x.id} class="dash-row"><${Link} href=${x.href}>${x.name}<//></li>`)}
      ${group('Cables in no circuit', c.noCircuit, (x) => html`<li key=${x.id} class="dash-row"><${Link} href=${x.href}>${x.label}<//></li>`)}
      ${group('Devices not placed on a plan or a schematic', c.unplaced, (x) => html`<li key=${x.id} class="dash-row"><${Link} href=${x.href}>${x.name}<//></li>`)}
      ${group('Schematic pages with overlapping devices', c.overlaps, (x) => html`<li key=${x.id} class="dash-row"><${Link} href=${x.href}>${x.name}<//></li>`)}
    </div>`
}

function Batteries ({ cards, history, liveOn }) {
  if (cards.length === 0) return html`<div class="empty-state">No batteries yet.</div>`
  return html`
    <ul class="dash-list dash-banks" data-testid="battery-cards">
      ${cards.map((c) => html`
        <li key=${c.key} class=${'dash-bank' + (c.stale || !c.hasData ? ' dim' : '')} data-testid="battery-card">
          <${Link} href=${c.href}>${c.title}<//>
          ${!liveOn || !c.hasData
            ? html`<div class="meta">${liveOn ? 'no live data' : 'Live is off'}</div>`
            : html`
              <div class="dash-bank-main">
                <span class="dash-big">${c.soc !== null ? percentText(c.soc) : c.voltage !== null ? c.voltage.toFixed(1) + ' V' : '-'}</span>
                ${history.available && c.socPath && html`<${Spark} points=${history.series.get(c.socPath)} />`}
              </div>
              <div class="meta">
                ${[
                  c.soc !== null && c.voltage !== null ? c.voltage.toFixed(1) + ' V' : null,
                  c.current !== null ? `${Math.abs(c.current).toFixed(1)} A ${c.current > 0 ? 'out' : c.current < 0 ? 'in' : ''}`.trim() : null,
                  c.timeText
                ].filter(Boolean).join(', ')}${c.stale ? ' (stale)' : ''}
              </div>`}
        </li>`)}
    </ul>`
}

function SwitchesOn ({ sw, liveOn }) {
  if (!liveOn) return html`<div class="empty-state">Live is off.</div>`
  if (sw.on.length === 0 && sw.off === 0 && sw.unknown === 0) return html`<div class="empty-state" data-testid="switches-none">No switchable consumers, or no live data.</div>`
  return html`
    <div>
      ${sw.on.length === 0 ? html`<div class="meta" data-testid="switches-none">Nothing is switched on.</div>` : html`
        <ul class="dash-list" data-testid="switches-on">
          ${sw.on.map((s) => html`
            <li key=${s.id} class="dash-row"><${Link} href=${s.href}>${s.name}<//>${s.via ? html`<span class="meta">via ${s.via}</span>` : ''}</li>`)}
        </ul>`}
      <div class="meta">${sw.on.length} on, ${sw.off} off${sw.unknown > 0 ? `, ${sw.unknown} unknown` : ''}.</div>
    </div>`
}

function liveStatus (liveOn, live) {
  if (!liveOn) return { text: 'Live is off', cls: 'off' }
  if (live.error) return { text: 'No live data', cls: 'error' }
  if (live.paused) return { text: 'Paused while this tab is hidden', cls: 'paused' }
  if (live.connected) return { text: 'Live', cls: 'on' }
  return { text: 'Connecting', cls: 'connecting' }
}

export function DashboardTab () {
  const { loading, error, data } = useDashboardData()
  const { settings, loaded } = useSettingsLoaded()
  const [liveOn, setLiveOn] = useState(() => readLivePref())
  const devices = (data && data.devices) || []
  const nameById = new Map(devices.map((d) => [d.id, d.name]))
  const extraPaths = dashboardPaths({ settings, live: null, devices })
  const live = useLive(liveOn && loaded && !loading, 0, (id) => nameById.get(id) || id, {
    extraPaths, period: LIVE_PERIOD_MS, pauseWhenHidden: true
  })
  const toggleLive = () => { const next = !liveOn; setLiveOn(next); writeLivePref(next) }

  const ready = !loading && !error && loaded && data
  const values = liveOn ? live.values : new Map()
  const stamps = live.stamps
  const now = live.now
  const flows = ready ? liveFlows({ settings, live: live.live, devices, circuits: data.circuits, values, stamps, now }) : null
  const battery = ready ? batteryCards(devices, data.banks, live.live, values, stamps, now) : null
  const history = useHistory(ready ? historyPaths(flows, battery.cards) : [], Boolean(ready))
  const status = liveStatus(liveOn, live)

  const stats = ready ? dashboardStats(data) : null
  const checks = ready ? dashboardChecks({ ...data, limits: limitsFrom(settings) }) : null
  const switches = ready ? switchesOn(live.live, values, devices) : null

  return html`
    <div class="dashboard" data-testid="dashboard">
      <div class="dash-head">
        <p class="meta">How the wiring stands, what needs attention and what the boat is doing now.</p>
        <div class="dash-live">
          <span class=${'dash-live-state ' + status.cls} data-testid="live-indicator" role="status"><i class="dash-dot"></i>${status.text}</span>
          <button type="button" class=${'dash-live-switch' + (liveOn ? ' active' : '')} data-testid="live-switch" aria-pressed=${liveOn} onClick=${toggleLive}>
            ${liveOn ? 'Turn live off' : 'Turn live on'}
          </button>
        </div>
      </div>
      ${error && html`<div class="error-banner">${error}</div>`}
      ${(loading || !loaded) && !error && html`<div class="empty-state">Loading…</div>`}
      ${ready && html`
        <div class="dash-grid">
          <section class="card dash-card dash-wide" data-testid="card-live">
            <h2>Live power</h2>
            <${LivePower} flows=${flows} battery=${battery} history=${history} liveOn=${liveOn} liveError=${live.error} />
            ${liveOn && history.available === false && html`<div class="meta" data-testid="no-history">No history provider is installed, so there are no last-hour graphs.</div>`}
          </section>
          <section class="card dash-card" data-testid="card-batteries">
            <h2>Battery banks</h2>
            <${Batteries} cards=${battery.cards} history=${history} liveOn=${liveOn} />
          </section>
          <section class="card dash-card" data-testid="card-switches">
            <h2>Switches on</h2>
            <${SwitchesOn} sw=${switches} liveOn=${liveOn} />
          </section>
          <section class="card dash-card" data-testid="card-checks">
            <h2>Needs attention</h2>
            <${Checks} checks=${checks} />
          </section>
          <section class="card dash-card" data-testid="card-stats">
            <h2>Statistics</h2>
            <${Statistics} stats=${stats} />
          </section>
        </div>`}
    </div>`
}
