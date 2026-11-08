// The Calibrate load dialog (plan 0017): measure what a device really draws,
// by switching it on and off while a meter is read (delta), or by watching
// it run (watch). The run itself executes in the plugin, so it goes on if
// this page closes; the dialog polls its progress.

import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js'
import { fetchLive, confirmText } from './live.js'

const ROUTES_BASE = '/plugins/signalk-wiring'

// ---- Pure ----

export const TIMING_FIELDS = {
  delta: [
    { key: 'baselineS', label: 'Resting reading (s)', def: 5 },
    { key: 'settleS', label: 'Settle after switching (s)', def: 5 },
    { key: 'measureS', label: 'Measure while on (s)', def: 5 },
    { key: 'repeats', label: 'Repeats', def: 3 }
  ],
  watch: [
    { key: 'baselineS', label: 'Resting reading (s)', def: 5 },
    { key: 'watchS', label: 'Watch for (s)', def: 120 }
  ]
}

export function defaultTimings (method) {
  return Object.fromEntries(TIMING_FIELDS[method].map((f) => [f.key, f.def]))
}

const WARNINGS = {
  noisy: 'The readings jump around or the repeats disagree, so the result is uncertain.',
  drift: 'The resting reading moved while the device was being measured, which blurs the result.',
  'small-step': 'The change is small compared with the noise on the meter. Use a meter closer to the device, or a longer run.',
  'no-step': 'The meter showed no change.',
  'few-cycles': 'Fewer than two usable repeats.',
  'few-samples': 'Very few readings were taken. Watch for longer.',
  'no-data': 'No readings were taken.'
}

export function warningText (code) { return WARNINGS[code] || code }

const fmt = (n) => (n == null || !Number.isFinite(n) ? '-' : Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10))

// The result of a finished run as lines of text.
export function describeResult (run) {
  if (!run) return []
  const lines = []
  lines.push(`Average ${fmt(run.avgW)} W, peak ${fmt(run.peakW)} W`)
  if (run.dutyCycle != null && run.dutyCycle < 0.995) lines.push(`On ${Math.round(run.dutyCycle * 100)}% of the time`)
  if (run.method === 'delta' && run.details && run.details.spread != null) {
    lines.push(`Spread between repeats: ${fmt(run.details.spread)} ${run.meterUnit || ''}`.trim())
  }
  lines.push(`Confidence: ${run.confidence || 'unknown'}`)
  if (run.estimate) lines.push('An estimate: amps times the circuit voltage, assuming a power factor of 1. A watt meter would be exact.')
  if (run.consumerIds && run.consumerIds.length > 1) lines.push('A shared switch was used, so the figure covers every consumer on it together.')
  return lines
}

export function progressPercent (status) {
  if (!status || !status.progress || !status.progress.total) return 0
  return Math.max(0, Math.min(100, Math.round((status.progress.done / status.progress.total) * 100)))
}

// The body of POST /calibration/runs from the dialog's choices.
export function buildStartBody ({ deviceId, method, hand, meter, voltage, timings, autoContinue, confirmed }) {
  const body = { deviceId, method, hand: Boolean(hand), meter: { path: meter.path, unit: meter.unit, source: meter.source }, timings, autoContinue, confirmed: Boolean(confirmed) }
  if (voltage !== '' && voltage != null && Number.isFinite(Number(voltage))) body.voltage = Number(voltage)
  const numeric = {}
  for (const [k, v] of Object.entries(timings || {})) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) numeric[k] = n
  }
  body.timings = numeric
  return body
}

// What a meter option says in the list.
export function meterLabel (meter, nameOf) {
  const where = meter.source === 'circuit' ? 'circuit meter' : nameOf(meter.deviceId)
  return `${where}: ${meter.path} (${meter.unit === 'W' ? 'watts' : 'amps'})${meter.lowConfidence ? ' - covers other loads too, less accurate' : ''}`
}

// ---- Browser ----

async function call (method, path, body) {
  const res = await fetch(`${ROUTES_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try { data = await res.json() } catch (e) { data = null }
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Calibrating needs a read-write login to SignalK.'), { status: res.status })
  return { status: res.status, body: data || {} }
}

export function CalibrateDialog ({ device, nameOf, onClose, onChanged }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('delta')
  const [hand, setHand] = useState(false)
  const [meterIndex, setMeterIndex] = useState(0)
  const [voltage, setVoltage] = useState('')
  const [timings, setTimings] = useState(defaultTimings('delta'))
  const [autoContinue, setAutoContinue] = useState(true)
  const [status, setStatus] = useState(null)
  const [result, setResult] = useState(null)
  const [threshold, setThreshold] = useState('')
  const [busy, setBusy] = useState(false)
  const runId = useRef(null)

  // What the plugin knows about this device, and whether a run is already going.
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchLive(), call('GET', '/calibration/status')])
      .then(([live, st]) => {
        if (cancelled) return
        const consumer = live.consumers[device.id]
        setInfo({ consumer, live })
        if (consumer && consumer.voltage != null) setVoltage(String(consumer.voltage))
        if (consumer && !consumer.switchable) setHand(true)
        if (st.body.state === 'running') {
          if (st.body.deviceId === device.id || (consumer && consumer.switchDeviceId === st.body.deviceId)) {
            runId.current = st.body.runId
            setStatus(st.body)
            setMode(st.body.method)
          } else {
            setError('Another calibration run is in progress. Wait for it to finish or cancel it first.')
          }
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [device.id])

  // Poll while a run goes on; when it ends, load its result.
  const running = status && status.state === 'running'
  useEffect(() => {
    if (!running) return undefined
    let stopped = false
    const tick = async () => {
      try {
        const { body } = await call('GET', '/calibration/status')
        if (stopped) return
        setStatus(body)
        if (body.state === 'done' || body.state === 'failed') await loadResult(body.runId)
      } catch (err) { if (!stopped) setError(err.message) }
    }
    const timer = setInterval(tick, 1000)
    return () => { stopped = true; clearInterval(timer) }
  }, [running])

  async function loadResult (id) {
    const { body } = await call('GET', `/calibration/runs?deviceId=${encodeURIComponent(device.id)}`)
    let runs = Array.isArray(body) ? body : []
    if (!runs.some((r) => r.id === id) && info && info.consumer && info.consumer.switchDeviceId) {
      runs = runs.concat((await call('GET', `/calibration/runs?deviceId=${encodeURIComponent(info.consumer.switchDeviceId)}`)).body || [])
    }
    const run = runs.find((r) => r.id === id)
    if (run) {
      setResult(run)
      if (run.method === 'watch' && run.details && run.details.threshold != null) setThreshold(String(run.details.threshold))
    }
  }

  const consumer = info && info.consumer
  const meters = (consumer && consumer.meters) || []
  const meter = meters[meterIndex]
  const auto = mode === 'delta' && !hand && consumer && consumer.switchable && !consumer.neverRemote
  const group = auto && consumer.sharedWith.length > 0
  const needVoltage = meter && meter.unit === 'A'

  const changeMode = (m) => { setMode(m); setTimings(defaultTimings(m)) }

  const start = async () => {
    setError(null)
    setBusy(true)
    try {
      let confirmed = false
      if (auto && consumer.confirm) {
        const names = [device.name, ...consumer.sharedWith.map(nameOf)]
        if (!window.confirm(confirmText({ switchDeviceName: nameOf(consumer.switchDeviceId), consumerNames: names }, true) + ' It will be switched on and off several times.')) { setBusy(false); return }
        confirmed = true
      }
      const body = buildStartBody({ deviceId: device.id, method: mode, hand: hand || !auto, meter, voltage, timings, autoContinue, confirmed })
      const { status: code, body: reply } = await call('POST', '/calibration/runs', body)
      if (code !== 201) throw new Error(reply.error || `The run could not be started (${code}).`)
      runId.current = reply.run.id
      setResult(null)
      setStatus({ state: 'running', runId: reply.run.id, phase: 'starting', message: 'Starting', progress: { done: 0, total: 1 }, method: mode })
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const act = async (path, body) => {
    setBusy(true)
    try { await call('POST', path, body || {}) } catch (err) { setError(err.message) }
    setBusy(false)
  }

  const review = async (verdict) => {
    setBusy(true)
    setError(null)
    try {
      if (verdict === 'accept' && result.method === 'watch' && result.details && String(result.details.threshold) !== threshold && threshold !== '') {
        const r = await call('POST', `/calibration/runs/${result.id}/recompute`, { threshold: Number(threshold) })
        if (r.status !== 200) throw new Error(r.body.error || 'The threshold could not be applied.')
      }
      const r = await call('POST', `/calibration/runs/${result.id}/${verdict}`)
      if (r.status !== 200) throw new Error(r.body.error || `The run could not be ${verdict}ed.`)
      setResult(r.body)
      if (onChanged) onChanged()
      if (verdict === 'reject') setStatus(null)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  const recompute = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await call('POST', `/calibration/runs/${result.id}/recompute`, { threshold: Number(threshold) })
      if (r.status !== 200) throw new Error(r.body.error || 'The threshold could not be applied.')
      setResult(r.body)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  const again = () => { setStatus(null); setResult(null); setError(null) }

  const finished = status && (status.state === 'done' || status.state === 'failed' || status.state === 'cancelled')
  const prompt = status && status.prompt

  return html`
    <div class="card calibrate-dialog" data-testid="calibrate-dialog">
      <h3>Calibrate load: ${device.name}</h3>
      ${error && html`<div class="error-banner" data-testid="calibrate-error">${error}</div>`}
      ${!info && !error && html`<p class="meta">Loading…</p>`}
      ${info && !consumer && html`<p class="meta">Only a consumer can be calibrated.</p>`}

      ${consumer && !status && html`
        <div class="form-field">
          <span>Method</span>
          <div class="row-actions">
            <button type="button" class=${mode === 'delta' ? 'active' : ''} data-testid="mode-delta" onClick=${() => changeMode('delta')}>Switch on and off (delta)</button>
            <button type="button" class=${mode === 'watch' ? 'active' : ''} data-testid="mode-watch" onClick=${() => changeMode('watch')}>Watch it run</button>
          </div>
          <small class="hint">
            ${mode === 'delta'
              ? 'The device is switched on and off several times and the difference on the meter is its load. Best for steady loads such as lamps, pumps and fans.'
              : 'You switch the device on by hand and the meter is watched for a while. Gives the average, the peak and the share of time it draws power. Best for loads that cycle, such as a kettle, induction hob, microwave or blender, and for AC devices.'}
          </small>
        </div>

        ${mode === 'delta' && html`
          <div class="form-field">
            <span>Switching</span>
            ${consumer.switchable && !consumer.neverRemote && html`
              <label class="check-row"><input type="radio" name="how" checked=${!hand} onChange=${() => setHand(false)} data-testid="how-auto" /> Switch it for me through ${nameOf(consumer.switchDeviceId)}</label>
            `}
            <label class="check-row"><input type="radio" name="how" checked=${hand || !consumer.switchable || consumer.neverRemote} onChange=${() => setHand(true)} data-testid="how-hand" /> I will switch it by hand</label>
            ${consumer.neverRemote && html`<small class="hint">This device is set to never be switched remotely, so it has to be switched by hand.</small>`}
            ${!consumer.switchable && html`<small class="hint">Nothing in the wiring can switch it remotely, so it has to be switched by hand.</small>`}
            ${group && html`<small class="hint warn">${nameOf(consumer.switchDeviceId)} also feeds ${consumer.sharedWith.map(nameOf).join(', ')}. They all switch together, so the result is recorded for the whole group.</small>`}
          </div>
        `}

        <div class="form-field">
          <span>Meter</span>
          ${meters.length === 0 && html`<small class="hint warn" data-testid="no-meter">No meter is set on this device or upstream of it. Give a shunt, a relay channel or the circuit a meter path (amps or watts) first.</small>`}
          ${meters.length > 0 && html`
            <select value=${String(meterIndex)} onChange=${(e) => setMeterIndex(Number(e.target.value))} data-testid="meter-select">
              ${meters.map((m, i) => html`<option value=${String(i)} key=${i}>${meterLabel(m, nameOf)}</option>`)}
            </select>
          `}
        </div>

        ${needVoltage && html`
          <label class="form-field"><span>Circuit voltage (V)</span>
            <input type="number" step="any" value=${voltage} onInput=${(e) => setVoltage(e.target.value)} data-testid="voltage" />
            <small class="hint">The meter reads amps, so watts are amps times this voltage, assuming a power factor of 1. The result is marked as an estimate.</small>
          </label>
        `}

        <details class="form-field">
          <summary>Timing</summary>
          <div class="timing-grid">
            ${TIMING_FIELDS[mode].map((f) => html`
              <label class="form-field compact" key=${f.key}><span>${f.label}</span>
                <input type="number" step="any" min="1" value=${timings[f.key]} onInput=${(e) => setTimings({ ...timings, [f.key]: e.target.value })} />
              </label>
            `)}
          </div>
        </details>

        ${(mode === 'watch' || !auto) && html`
          <label class="check-row"><input type="checkbox" checked=${autoContinue} onChange=${(e) => setAutoContinue(e.target.checked)} />
            Continue by itself when the meter shows a clear change</label>
        `}

        <div class="form-actions">
          <button type="button" onClick=${start} disabled=${busy || !meter || (needVoltage && !(Number(voltage) > 0))} data-testid="calibrate-start">Start</button>
          <button type="button" onClick=${onClose}>Close</button>
        </div>
      `}

      ${status && status.state === 'running' && html`
        <div data-testid="calibrate-running">
          <p><strong>${prompt ? "Waiting for you" : (status.message || status.phase)}</strong>${status.cycle && status.method === 'delta' ? html` <span class="meta">(repeat ${status.cycle} of ${status.cycles})</span>` : ''}</p>
          <div class="progress" aria-label="progress"><div class="progress-bar" style=${`width: ${progressPercent(status)}%`}></div></div>
          ${status.live && html`<p class="live-reading-big" data-testid="calibrate-live">Reading now: <strong>${fmt(status.live.value)} ${status.live.unit}</strong></p>`}
          ${prompt && html`
            <div class="prompt-box" data-testid="calibrate-prompt">
              <p>${prompt.text}</p>
              ${prompt.stepDetected && html`<p class="meta">The meter changed clearly${prompt.autoContinue ? ', continuing by itself.' : '. Press Continue when you are ready.'}</p>`}
              <button type="button" onClick=${() => act('/calibration/continue')} disabled=${busy} data-testid="calibrate-continue">Continue</button>
            </div>
          `}
          ${status.phase === 'watching' && html`
            <p class="meta">Watched ${status.watched || 0} s${status.watchS ? ` of ${status.watchS} s` : ''}.</p>
            <button type="button" onClick=${() => act('/calibration/finish')} disabled=${busy} data-testid="calibrate-finish">Stop now and keep what was seen</button>
          `}
          <div class="form-actions">
            <button type="button" onClick=${() => act('/calibration/cancel')} disabled=${busy} data-testid="calibrate-cancel">Cancel run</button>
          </div>
          <p class="meta">The run continues on the server if you close this page.</p>
        </div>
      `}

      ${finished && status.state !== 'done' && html`
        <div data-testid="calibrate-failed">
          <p>${status.state === 'cancelled' ? 'The run was cancelled.' : html`<strong>The run failed.</strong> ${status.error || ''}`}</p>
          <div class="form-actions"><button type="button" onClick=${again}>Try again</button><button type="button" onClick=${onClose}>Close</button></div>
        </div>
      `}

      ${finished && status.state === 'done' && result && html`
        <div data-testid="calibrate-result">
          <h4>Result</h4>
          ${describeResult(result).map((l, i) => html`<div class=${i === 0 ? 'measured-line' : 'meta'} key=${i}>${l}</div>`)}
          ${(result.details && result.details.warnings || []).map((w) => html`<div class="error-banner" key=${w}>${warningText(w)}</div>`)}
          ${result.method === 'watch' && html`
            <label class="form-field compact"><span>"On" threshold (${result.meterUnit})</span>
              <input type="number" step="any" value=${threshold} onInput=${(e) => setThreshold(e.target.value)} data-testid="threshold" />
              <small class="hint">The device counts as on while the reading is above this. The default is 10% of the peak and clearly above the resting noise. Change it and press Apply to see the effect before accepting.</small>
            </label>
            <button type="button" onClick=${recompute} disabled=${busy || threshold === ''} data-testid="threshold-apply">Apply threshold</button>
          `}
          ${result.review === 'pending' && html`
            <div class="form-actions">
              <button type="button" onClick=${() => review('accept')} disabled=${busy} data-testid="calibrate-accept">Accept</button>
              <button type="button" onClick=${() => review('reject')} disabled=${busy} data-testid="calibrate-reject">Reject</button>
              <button type="button" onClick=${again} disabled=${busy} data-testid="calibrate-repeat">Repeat</button>
            </div>
          `}
          ${result.review === 'accepted' && html`
            <p class="meta" data-testid="calibrate-accepted">Accepted. The load check now uses these figures for ${device.name}.</p>
            <div class="form-actions"><button type="button" onClick=${again}>Repeat</button><button type="button" onClick=${onClose}>Close</button></div>
          `}
        </div>
      `}
      ${finished && status.state === 'done' && !result && html`<p class="meta">Loading the result…</p>`}
    </div>
  `
}
