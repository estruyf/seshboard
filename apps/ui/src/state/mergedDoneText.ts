/** The toast's line: one session by its title and pull request, more by how many. */
export function mergedDoneText(sessions: readonly { title: string; pr: number }[]): string {
  if (sessions.length === 1) {
    const { title, pr } = sessions[0]!;
    return `“${title.length > 50 ? `${title.slice(0, 49).trimEnd()}…` : title}” moved to Done, #${pr} merged`;
  }
  return `${sessions.length} sessions moved to Done, PR merged`;
}
