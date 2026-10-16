import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// Switchboard's smoke run starts a session with this folder in CLAUDE_CODE_PLUGIN_DIRS and checks each surface:
// the band above the message box, the pane, the status chip, a toast, and that a press reaches the mod.

const PANE = 'smoke-pane'
const presses = atom({ plugin: 'smoke-mod', key: 'presses' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A command answered here, without the model: the smoke run starts its session with it, so it costs nothing.
    await $.command.register({ name: 'smoke-ping', description: 'Answers pong, without the model' })
    $.ui.status('ready')
    void $.ui.open({ id: PANE, title: 'Smoke pane' })

    return next(e)
  })

  on('command.run', { command: 'smoke-ping' }, async () => ({ text: 'pong' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const count = await read($, presses)

    return (
      <Box gap={1} alignItems="center">
        <Text color="yellow">Smoke band: pressed {count}</Text>
        <Button
          key="press"
          label="Press"
          onPress={async () => {
            const next = (await read($, presses)) + 1
            await update($, presses, () => next)
            $.ui.status(`pressed ${next}`)
            $.ui.toast('Smoke toast')
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold>Smoke pane</Text>
        <Text dimColor>Drawn by smoke-mod.</Text>
      </Box>
    )
  })
}
