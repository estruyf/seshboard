import type { Register } from 'claude-code'

// A made-up mod for the website's screenshots (scripts/website-screenshots.ts): three agents that never change.

const PANE = 'agents'
const AGENTS = [
  { what: 'Explore: sidebar rows', took: '12m', tokens: '41k tokens' },
  { what: 'Review: catch-up card', took: '4m', tokens: '18k tokens' },
  { what: 'Test runner', took: '1m', tokens: '3k tokens' },
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The session starts with this command, answered here: the screenshots cost nothing.
    await $.command.register({ name: 'agent-watch', description: 'Show the running agents' })
    $.ui.status('3/3')
    void $.ui.open({ id: PANE, title: 'Agents', closeOnEscape: true })

    return next(e)
  })

  on('command.run', { command: 'agent-watch' }, async () => ({ text: 'Three agents are running.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box gap={2} alignItems="center">
        <Text color="yellow" bold>3 of 3 agents running</Text>
        <Text dimColor>Next start waits until one finishes.</Text>
        <Box flexGrow={1} />
        <Button key="show" label="Show agents" onPress={() => $.ui.open({ id: PANE, title: 'Agents', focus: true })} />
        <Button key="raise" label="Raise limit" onPress={() => $.ui.toast('The limit is 3 agents per session.')} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Running agents</Text>
        {AGENTS.map(agent => (
          <Box borderStyle="round" paddingX={1} alignItems="center" gap={1}>
            <Text color="yellow">●</Text>
            <Box flexDirection="column" flexGrow={1}>
              <Text>{agent.what}</Text>
              <Text dimColor>
                {agent.took} · {agent.tokens}
              </Text>
            </Box>
            <Button key={`stop:${agent.what}`} label="Stop" onPress={() => $.ui.toast(`${agent.what} keeps running in this demo.`)} />
          </Box>
        ))}
      </Box>
    )
  })
}
