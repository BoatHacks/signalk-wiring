import { html, useState } from './vendor/preact-standalone.module.js'
import { OTHER, gaugeOptions, keepGaugeForUnit } from './gauge.js'

// The gauge controls of a cable form: a size dropdown for the chosen unit
// (AWG or mm²), a number field after picking "Other", and the unit select.
// Changing the unit swaps the list and keeps the value only when the new list
// has it. With no unit chosen there is no list, so a plain number field shows.
//   value: text of the stored number; unit: 'AWG', 'mm2' or ''.
//   onValue(text), onUnit(unit). noneLabel names the empty choice of the unit
//   select ("(unchanged)" in the bulk form).
export function GaugeField ({ value, unit, onValue, onUnit, noneLabel = '-', testid = 'gauge' }) {
  const [other, setOther] = useState(false)
  const shown = value === null || value === undefined ? '' : String(value)

  const pickSize = (e) => {
    const v = e.target.value
    if (v === OTHER) { setOther(true); onValue(''); return }
    setOther(false)
    onValue(v)
  }
  const pickUnit = (e) => {
    const next = e.target.value
    setOther(false)
    onUnit(next)
    onValue(next ? keepGaugeForUnit(shown, next) : shown)
  }

  const listed = unit !== ''
  return html`
    ${listed && html`
      <select data-testid=${testid + '-size'} aria-label="Gauge size" value=${other ? OTHER : shown} onChange=${pickSize}>
        <option value="">-</option>
        ${gaugeOptions(unit, shown).map((o) => html`<option value=${o.value} key=${o.value}>${o.label}</option>`)}
      </select>
    `}
    ${(!listed || other) && html`
      <input type="number" step="any" class="short" data-testid=${testid + '-other'} aria-label="Gauge"
        value=${shown} onInput=${(e) => onValue(e.target.value)} />
    `}
    <select data-testid=${testid + '-unit'} aria-label="Gauge unit" value=${unit} onChange=${pickUnit}>
      <option value="">${noneLabel}</option><option value="AWG">AWG</option><option value="mm2">mm²</option>
    </select>
  `
}
