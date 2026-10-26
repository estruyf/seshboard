# Website

The Open Graph image of the website (https://seshboard.app/). Render it with `social/render.sh website`, then copy it at 1200×630 to `website/public/og.png`:

```bash
social/render.sh website
node -e 'require("sharp")("social/website/image.png").resize(1200, 630).png().toFile("website/public/og.png")'
```

Alt text: Seshboard for Mac: all your Claude Code sessions in one window, next to the Home view with a session that needs you, one that is working and the queue.
