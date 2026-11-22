// Status forms that do not rely on color (plan 0050, issue #35). The red night
// theme is one hue, so a status is told apart by its form: a pass is quiet text
// with a check, "cannot check" is a dashed outline with a dash, a warning is a
// solid outline with a triangle, a failure is a filled badge with an octagon.
// The day theme uses the same forms. Pure data, no DOM; statusBadge.js draws it.

export const LEVELS = ['pass', 'cannot', 'warning', 'fail']

// The kinds the app already uses for a result, mapped to a level.
const KIND_LEVEL = {
  ok: 'pass',
  pass: 'pass',
  cannot: 'cannot',
  incomplete: 'cannot',
  note: 'cannot',
  warning: 'warning',
  fail: 'fail',
  'over rating': 'fail',
  error: 'fail'
}

// The level of a kind, or null for a kind that has no status form.
export function levelOf (kind) {
  return Object.prototype.hasOwnProperty.call(KIND_LEVEL, kind) ? KIND_LEVEL[kind] : null
}

// Path data in a 12 by 12 box. `stroke` parts are drawn as a line in the
// current color, `fill` parts as a solid shape, `cut` parts as a line in the
// color of what is behind the shape (so the cross shows in a filled octagon).
const MARKS = {
  check: { form: 'quiet', parts: [{ role: 'stroke', d: 'M2 6.5l3 3 5-6' }] },
  dash: { form: 'dashed', parts: [{ role: 'stroke', d: 'M3 6h6' }] },
  triangle: {
    form: 'outline',
    parts: [
      { role: 'stroke', d: 'M6 1.6L11 10.4H1Z' },
      { role: 'stroke', d: 'M6 5v2.4M6 9v.1' }
    ]
  },
  octagon: {
    form: 'filled',
    parts: [
      { role: 'fill', d: 'M4 1h4l3 3v4l-3 3H4L1 8V4z' },
      { role: 'cut', d: 'M4.3 4.3l3.4 3.4M7.7 4.3L4.3 7.7' }
    ]
  }
}

const LEVEL_MARK = { pass: 'check', cannot: 'dash', warning: 'triangle', fail: 'octagon' }

// What to draw for a level: { level, mark, form, parts }.
export function markFor (level) {
  const mark = LEVEL_MARK[level]
  if (!mark) return null
  return { level, mark, form: MARKS[mark].form, parts: MARKS[mark].parts }
}

// The words each level reads as in a legend or a screen reader hint.
export const LEVEL_WORDS = { pass: 'passed', cannot: 'cannot be checked', warning: 'warning', fail: 'failed' }

// ---- Live state forms (a floorplan marker keeps its role shape) ----

// on is a solid shape, off a hollow outline, unknown a dashed outline.
export const LIVE_FORMS = { on: 'solid', off: 'hollow', unknown: 'dashed' }
