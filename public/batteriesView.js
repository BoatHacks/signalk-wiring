import { html, useState, useEffect } from './vendor/preact-standalone.module.js'
import { hashForState } from './router.js'
import {
  CHEMISTRY_LABELS, PURPOSE_LABELS, bankTitle, fmtAh, fmtKwh, fmtVolts, incompleteText, stringsText, allBanks
} from './batteries.js'

const BASE = '/plugins/signalk-wiring'
const RESOURCE_BASE = '/signalk/v2/api/resources'

async function getJson (url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`)
  return res.json()
}

function useBatteryData () {
  const [state, setState] = useState({ loading: true, error: null, devices: [], banks: [] })
  useEffect(() => {
    let cancelled = false
    Promise.all([getJson(`${RESOURCE_BASE}/wiringDevices`), getJson(`${BASE}/derived`)])
      .then(([map, derived]) => {
        if (!cancelled) setState({ loading: false, error: null, devices: Object.values(map), banks: (derived && derived.banks) || [] })
      })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, devices: [], banks: [] }) })
    return () => { cancelled = true }
  }, [])
  return state
}

function DeviceLink ({ id, deviceById }) {
  const d = deviceById.get(id)
  return html`<a class="route-link" href=${hashForState({ tab: 'devices', id })}>${(d && d.name) || id}</a>`
}

function LinkList ({ ids, deviceById, empty }) {
  if (!ids || ids.length === 0) return empty
  return ids.map((id, i) => html`<span key=${id}>${i > 0 ? ', ' : ''}<${DeviceLink} id=${id} deviceById=${deviceById} /></span>`)
}

function BatteryLine ({ id, deviceById }) {
  const d = deviceById.get(id) || {}
  const bits = [d.chemistry && (CHEMISTRY_LABELS[d.chemistry] || d.chemistry), d.purpose && (PURPOSE_LABELS[d.purpose] || d.purpose),
    typeof d.capacityAh === 'number' ? fmtAh(d.capacityAh) : null].filter(Boolean)
  return html`<li><${DeviceLink} id=${id} deviceById=${deviceById} />${bits.length ? html` <span class="meta">${bits.join(', ')}</span>` : null}</li>`
}

function Stat ({ label, value, testid }) {
  return html`<div class="bank-stat"><div class="bank-stat-label">${label}</div><div class="bank-stat-value" data-testid=${testid}>${value}</div></div>`
}

function BankCard ({ bank, deviceById }) {
  const incomplete = incompleteText(bank, deviceById)
  const strings = stringsText(bank, deviceById)
  const chem = bank.chemistries.map((c) => CHEMISTRY_LABELS[c] || c).join(', ') || '-'
  return html`
    <div class="bank" data-testid="bank-card">
      <div class="card bank-card">
        <h3 class="bank-title">${bankTitle(bank, deviceById)}${bank.layout ? html` <span class="badge">${bank.layout.label}</span>` : null}</h3>
        <ul class="bank-batteries">
          ${bank.batteryIds.map((id) => html`<${BatteryLine} key=${id} id=${id} deviceById=${deviceById} />`)}
        </ul>
        ${strings && html`<div class="meta bank-strings">Strings: ${strings}</div>`}
        <div class="bank-stats">
          <${Stat} label="Voltage" value=${fmtVolts(bank.voltage)} testid="bank-voltage" />
          <${Stat} label="Capacity" value=${fmtAh(bank.capacityAh)} testid="bank-capacity" />
          <${Stat} label="Usable" value=${fmtAh(bank.usableAh)} testid="bank-usable" />
          <${Stat} label="Energy" value=${fmtKwh(bank.energyWh)} testid="bank-energy" />
          <${Stat} label="Usable energy" value=${fmtKwh(bank.usableEnergyWh)} testid="bank-usable-energy" />
        </div>
        ${incomplete && html`<div class="meta bank-incomplete" data-testid="bank-incomplete">Incomplete: ${incomplete}. No totals are shown until it is filled in.</div>`}
        <div class="bank-line"><span class="bank-line-label">Chemistry</span> ${chem}</div>
        <div class="bank-line"><span class="bank-line-label">Monitor</span> <${LinkList} ids=${bank.monitorDeviceIds} deviceById=${deviceById} empty="none" /></div>
        <div class="bank-line"><span class="bank-line-label">Protected by</span> <${LinkList} ids=${bank.protectedBy} deviceById=${deviceById} empty="none recorded" /></div>
        <!-- Step 5 shows live voltage, state of charge and time remaining here. -->
        <div class="bank-live" data-testid="bank-live"></div>
      </div>
      ${bank.warnings.map((w, i) => html`<div class="warning-banner" key=${i}>${w.message}</div>`)}
    </div>
  `
}

export function BatteriesTab () {
  const { loading, error, devices, banks } = useBatteryData()
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const cards = allBanks(devices, banks)
  return html`
    <div>
      <p class="meta">One card per battery bank. Batteries joined by a link on a cable form a bank; a battery with no links is a bank of one.</p>
      ${loading && html`<div class="empty-state">Loading&hellip;</div>`}
      ${error && html`<div class="error-banner">${error}</div>`}
      ${!loading && !error && cards.length === 0 && html`<div class="empty-state">No batteries yet. Add a device with the Storage role.</div>`}
      ${cards.map((bank) => html`<${BankCard} key=${bank.batteryIds.join(',')} bank=${bank} deviceById=${deviceById} />`)}
    </div>
  `
}
