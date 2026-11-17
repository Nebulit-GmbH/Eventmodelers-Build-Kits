---
name: product-walkthrough
description: Record a commentable walkthrough of a running product. Opens a real browser with a toolbar (Comment / Record / Done); the person clicks through the product, places comments and presses Record per step. Each recorded screenshot becomes an image SCREEN in a new standalone chapter (one screen per column, in recorded order), and the comments become screen bubbles on it. Use for "record a walkthrough of our app", "make a commentable product tour", "let me comment on the product and capture screens". Not for walking through the event model itself (that is `walkthrough`) and not for an agent-driven crawl of an app (that is `discover-storyboard`).
---

# Product walkthrough — record, comment, land on the board

> **The very first thing — before `connect`, before anything else — is to get the URL.** If `$ARGUMENTS` / the message holds no URL to start from, **ask for it and end the turn** (one short message: "Which URL should I open to start the walkthrough?"). Nothing is read, installed or created until there is one. Only then invoke the `connect` skill — if not already connected — to resolve `BOARD_ID`. Prefer `mcp__eventmodelers__*` tools.

The **person** drives a real browser window; the recorder captures what they see; **you** put each screenshot on the board as an image screen and convert the comments into bubbles. Not `discover-storyboard`: nothing is crawled, the person decides what a step is.

**Rules that shape everything below**
- **One step = one image `SCREEN`** showing that step's own screenshot (`step-N.jpg`), uploaded as it is.
- **Standalone chapter** — never into an existing chapter, never touching the model.
- **Bubbles** are `node.data.screenBubbles = {items: [{id, pageIndex: 0, x, y, text}]}` on the step's own screen (frontend `screenBubbles/bubbleModel.ts`: ≤ 100 per screen, text ≤ 500). On an image screen `x`/`y` are **fractions of the picture in 1/10000** (0–10000), not pixels; `pageIndex` is always 0.

## Step 1 — Inputs

From `$ARGUMENTS`: the start `url` (required — already asked for above; never guess one) and a `title` for the walkthrough (default: the page title of the first step).

The recorder needs the agent to have been started with **`--browser`** (without it the locked-down agent refuses `record.mjs`) and the `playwright` package plus Chromium where the kit can find them (the CLI checks both on start with `--browser` and offers to install). If the run is refused with "runs only when the agent was started with `--browser`", or exits with "playwright is not installed", tell the person exactly that (restart with `--browser` / accept the install offer) and stop — don't work around it, and don't ask them to run it by hand and send a file.

## Step 2 — Run the recorder (background)

Run the kit's own script **in the background** (`run_in_background`), exactly in this form — the locked-down shell allows nothing else:

```
node .claude/skills/product-walkthrough/assets/record.mjs --url <url> --out /tmp/walkthrough-<short id>
```

- **Do not copy the script, `cd` into its folder, add redirections (`>`, `2>&1`), or use other flags** (`--check`, `--headless`…) — each is refused. `--out` is a fresh directory under `/tmp`; the background task's own output is the log. `--width` / `--height` (numbers) are the only optional flags — leave them at the default: the screenshots are deliberately small (1x scale, JPEG quality 60, ~1280×800), so they stay cheap to store; a bigger window makes bigger files.

Tell the person once: "Browser is open. **Comment** → click a spot → type → Add. **● Record** captures what's on screen with the comments you placed since the last Record (scroll and Record again for the next part of a long page — the toolbar says so too). **Done** when finished." Then wait for the process to exit — do not poll. A comment placed after the last Record has no step to live on and is dropped (the recorder prints a `WARN`; mention it).

Output in `<out>`: `step-N.jpg` (what the person saw, the window only — the screenshot is exactly the viewport, so a viewport pixel maps straight onto the picture) and `steps.json`:
`[{title, url, image, viewport:{w,h}, bubbles:[{text,x,y,target:{tag,text}}]}]` — all x/y in viewport pixels. Zero steps → say so and stop (no empty chapter).

## Step 3 — Build the chapter

1. `create_chapter { boardId, title: <walkthrough title>, columns: <steps.length> }`. The response carries every column and lane id — don't read the board back.
2. **One upload per step, in order** — the screenshot becomes an image screen in the Interaction-lane cell of column *i*. Generate each `nodeId` (`uuidgen`) yourself so the next step needs no lookup:
   ```
   curl -sS -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/image-nodes/<nodeId>" \
     -H "x-token: <TOKEN>" \
     -F "file=@<out>/step-<N>.jpg" -F "chapterId=<chapterId>" -F "cellName=<Interaction-lane cell of column i>" -F "title=<step title>"
   ```
   `204` = done. Anything else: report that step's status/body and carry on with the rest — don't resend a step that succeeded. A walkthrough is not a flow of the model: nothing is connected.
3. **Bubbles**, one batched `submit_node_events` (an array — one POST for all screens) with a `node:changed` per screen that has comments. Convert each recorded comment: `x = round(bubble.x / viewport.w * 10000)`, `y = round(bubble.y / viewport.h * 10000)`, clamped to 0–10000:
   ```
   { "id": "<fresh uuid>", "eventType": "node:changed", "nodeId": "<id>", "changedAttributes": ["data.screenBubbles"],
     "meta": { "type": "SCREEN" },
     "node": { "id": "<id>", "data": { "screenBubbles": { "items": [
        { "id": "<uuid>", "pageIndex": 0, "x": 3219, "y": 1200, "text": "…" } ] } } } }
   ```
   Number order = array order (bubbles are numbered by it).
4. **Verify one screen** with `get_node`: `data.screenBubbles` is present and the screen still shows its picture. If not, stop and report it — don't paper over.

## Step 4 — Report

Chapter title and how many screens/bubbles; any dropped late comments or failed uploads; and that the movie strip of the chapter is the player. Nothing else is written — no scenarios, no model elements.

## Verify when changing this
- If a bubble drifts from the spot it was placed on, check the conversion (`bubble.x / viewport.w * 10000`) and that `viewport` is the recorded window size, not the image's pixel size — `ImageScreenBubbles.tsx` in `miro-eventmodeling/src/components/screenBubbles/` draws them as fractions of the picture.
