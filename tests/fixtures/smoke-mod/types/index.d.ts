export type Presses = number

declare module 'claude-code' {
  interface PluginState {
    'smoke-mod': { presses: Presses }
  }
}
