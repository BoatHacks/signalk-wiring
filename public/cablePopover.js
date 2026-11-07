import { html, useState } from './vendor/preact-standalone.module.js'
import { CABLE_KINDS, buildCablePayload } from './cableForm.js'
import { popoverKinds, quickProblem, withKind } from './quickCable.js'

// The small popover that asks how a freshly drawn wire is made: Positive,
// Negative or Positive + negative, with optional gauge and length. Shared by
// the schematic canvas and the floorplan connect tool. "More..." hands the
// values to the full cable form.
//   start: the result of startValues(); lengthNote: text shown instead of a
//   length field when the length is measured (floorplan).
//   onCreate(payload) creates the cable; onMore(values); onCancel().
export function CablePopover ({ start, lengthNote, style, onCreate, onMore, onCancel }) {
  const [values, setValues] = useState(start.values)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const kinds = popoverKinds(start.values.kind, CABLE_KINDS)

  const create = async () => {
    const problem = quickProblem(start, values)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError(null)
    try {
      await onCreate(buildCablePayload(values))
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return html`
    <div class="cable-popover" style=${style} data-testid="cable-popover"
      onPointerDown=${(e) => e.stopPropagation()}>
      <div class="cable-popover-title">${start.from.name} to ${start.to.name}</div>
      <div class="cable-popover-kinds">
        ${kinds.map((k) => html`
          <label key=${k.value} class="radio-line">
            <input type="radio" name="quick-kind" checked=${values.kind === k.value}
              onChange=${() => setValues((v) => withKind(start, v, k.value))} />
            ${k.label}
          </label>
        `)}
      </div>
      <div class="cable-popover-row">
        <label>Gauge
          <input type="number" step="any" class="short" value=${values.gauge}
            onInput=${(e) => set('gauge', e.target.value)} />
        </label>
        <select value=${values.gaugeUnit} onChange=${(e) => set('gaugeUnit', e.target.value)}>
          <option value="">-</option><option value="AWG">AWG</option><option value="mm2">mm²</option>
        </select>
      </div>
      ${lengthNote
        ? html`<div class="meta">${lengthNote}</div>`
        : html`
          <div class="cable-popover-row">
            <label>Length
              <input type="number" step="any" class="short" value=${values.length}
                onInput=${(e) => set('length', e.target.value)} />
            </label>
            <select value=${values.lengthUnit} onChange=${(e) => set('lengthUnit', e.target.value)}>
              <option value="">-</option><option value="m">m</option><option value="ft">ft</option>
            </select>
          </div>`}
      ${error && html`<div class="error-banner">${error}</div>`}
      <div class="form-actions">
        <button type="button" data-testid="popover-create" onClick=${create} disabled=${saving}>${saving ? 'Saving…' : 'Create'}</button>
        <button type="button" onClick=${() => onMore(values)} disabled=${saving}>More…</button>
        <button type="button" onClick=${onCancel} disabled=${saving}>Cancel</button>
      </div>
    </div>
  `
}
