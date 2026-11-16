// The error shown when a list fails to load (plan 0041): a plain sentence, a
// Retry button, and the technical text in a smaller second line.
import { html } from './vendor/preact-standalone.module.js'
import { loadErrorSentence } from './wording.js'

export function LoadError ({ message, what, onRetry }) {
  if (!message) return null
  return html`
    <div class="error-banner load-error" role="alert" data-testid="load-error">
      <div class="load-error-main">
        <span>${loadErrorSentence(what, message)}</span>
        ${onRetry && html`<button type="button" class="load-error-retry" data-testid="load-retry" onClick=${onRetry}>Retry</button>`}
      </div>
      <div class="load-error-detail">${message}</div>
    </div>
  `
}
