// A long list shown short: the first few items and a count of the rest, so a
// cable that is part of many circuits (a battery negative, for example) does
// not fill its row. Pure, so the rule is tested.

export const MORE_LIMIT = 3

// { shown, hidden }: the items to show now and how many are left out. With
// `open` every item is shown. A list of `limit` items or fewer is never cut:
// "and 1 more" would take as much room as the item itself.
export function splitMore (items, open = false, limit = MORE_LIMIT) {
  const list = Array.isArray(items) ? items : []
  if (open || list.length <= limit) return { shown: list, hidden: 0, canCollapse: open && list.length > limit }
  return { shown: list.slice(0, limit), hidden: list.length - limit, canCollapse: false }
}

// The text of the link: "and 4 more ..." while cut, "show fewer" when open.
export function moreLabel (split) {
  if (split.hidden > 0) return `and ${split.hidden} more ...`
  if (split.canCollapse) return 'show fewer'
  return ''
}
