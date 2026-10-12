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
| [github-preview](github-preview/index.html) | GitHub social preview, 1280×640 (upload under Settings → General → Social preview) |
