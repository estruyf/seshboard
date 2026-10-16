import type { Register } from 'claude-code'

// A made-up mod for the website's screenshots (scripts/website-screenshots.ts): a pull request's state as a status.

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.status('PR #142 · 2 reviews requested')

    return next(e)
  })
}
