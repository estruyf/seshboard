/** @type {import('extension').FileConfig} */
// A profile of its own for each browser, kept between runs so the extension stays signed in to its pages.
// Chrome reads native messaging hosts from the profile's folder: `npm run dev` copies Seshboard's there first
// (scripts/dev-host.mjs). Firefox reads them from one folder for every profile.
const profile = (name) => `./dist/extension-profile-${name}`

export default {
  // The extension calls browser.*: Chromium before 148 gets it from the polyfill.
  commands: {
    dev: {polyfill: true},
    start: {polyfill: true},
    build: {polyfill: true}
  },
  browser: {
    chrome: {profile: profile('chrome')},
    chromium: {profile: profile('chromium')},
    edge: {profile: profile('edge')},
    firefox: {profile: profile('firefox')},
    'chromium-based': {profile: profile('chromium-based')},
    'gecko-based': {profile: profile('gecko-based')}
  }
}
