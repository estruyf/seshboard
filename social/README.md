# Social posts

Images and texts for announcing Switchboard features on social media. Each post has its own folder:

| File | What it is |
|---|---|
| `index.html` | The image as a 1200×630 page. It links `../shared/base.css` and uses the real icons from `apps/`. |
| `image.png` | The rendered image (2400×1260). |
| `posts.md` | The texts for X, Bluesky, Mastodon and LinkedIn, the links and the alt text. |

`shared/base.css` holds the look every image shares (the app's dark theme, copy on the left, a mockup on the right, Switchboard's message box). `_template/` is a starting point for a new post.

To render a post after changing its `index.html`:

```bash
social/render.sh vscode-companion
```

It needs Google Chrome (or set `CHROME` to another Chromium binary). The `social-post` skill in `.claude/skills/` walks through making a new one.

| Post | About |
|---|---|
| [vscode-companion](vscode-companion/posts.md) | The VS Code companion extension |
| [worktrees](worktrees/posts.md) | The project page and its Worktrees tab (overview and clean-up) |
| [release-0.0.14](release-0.0.14/posts.md) | Release 0.0.14: Windows, memory, branches and worktrees, the website |
| [release-0.0.15](release-0.0.15/posts.md) | Release 0.0.15: Auto model and the Usage view |
| [release-0.0.16](release-0.0.16/posts.md) | Release 0.0.16: side questions, Up next and Steer, pull requests |
| [github-preview](github-preview/index.html) | GitHub social preview, 1280×640 (upload under Settings → General → Social preview) |
| [release-0.0.18](release-0.0.18/posts.md) | Release 0.0.18: Remote on your phone, Catch-up, Ask, Agents panel |
| [try-switchboard](try-switchboard/posts.md) | Switchboard in general, to get people to try it (real screenshots, any time) |
| [release-0.0.21](release-0.0.21/posts.md) | Release 0.0.21: Run and send, Commands panel, Claude Code mods |
| [release-0.0.23](release-0.0.23/posts.md) | Release 0.0.23: saved prompts and token costs at API prices |
| [release-1.0.0](release-1.0.0/posts.md) | Release 1.0.0: the milestone (two weeks, 24 releases, what Switchboard is) |
| [linux-beta](linux-beta/posts.md) | Switchboard on Linux in the 1.1.0 beta (texts for your own Omarchy screenshot) |
| [coming-1.1](coming-1.1/posts.md) | Preview of 1.1 while in beta: schedules, triggers, pipelines, Upcoming |
| [release-1.1.0](release-1.1.0/posts.md) | Release 1.1.0: schedules, triggers, pipelines and Upcoming (Claude Code that starts on its own) |
| [release-1.1.0-more](release-1.1.0-more/index.html) | Second image for 1.1.0: Linux, #, previews, reading mode, app icons (texts in release-1.1.0) |
