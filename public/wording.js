// Small shared wording helpers (plan 0041): plurals, the load error sentence
// and the quiet status marker rule. Pure, so the rules are tested.

// "1 cable", "2 cables". `many` defaults to the singular plus "s".
export function plural (count, one, many) {
  return `${count} ${Number(count) === 1 ? one : (many || one + 's')}`
}

// The sentence shown when a list could not be loaded. `what` is the plain name
// of the list ("devices"); `message` is the technical text of the failure,
// "failed to load wiringDevices: 500" when the server answered with an error
// status, anything else (a network failure) when it did not answer at all.
export function loadErrorSentence (what, message) {
  const answered = /:\s*\d{3}\s*$/.test(String(message || ''))
  return `Could not load the ${what}. ${answered ? 'The server answered with an error.' : 'The server could not be reached.'}`
}
