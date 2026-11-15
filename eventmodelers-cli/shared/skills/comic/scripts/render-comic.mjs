#!/usr/bin/env node
// Draws a comic from <dir>/storyboard.json (comic-kit.mjs), writes page-N.svg and comic.snippet.json, and optionally posts it to the
// board chat. No dependencies — plain Node (built-in fetch). The pictures are ~100 KB of base64: far too much for an agent to type
// into a tool call, so this script posts them itself.
//
//   node render-comic.mjs <dir> [--post --org O --board B [--base URL] [--agent A] [--session S]]
//   token: $EM_TOKEN (the locked-down agent runs `EM_TOKEN="$TOKEN" node …`), else $EVENTMODELERS_TOKEN / $TOKEN; no --token flag
//
// storyboard.json: { "text": "one-line chat text", "title"?, "caption"?, "cast"?: { Name: {kind:"person"|"robot", …} },
//   "pages": [{ "panels": [...] | "svg": "page-1.svg", "accent"?, "layout"?, "title"?, "alt"?, "caption"? }] }
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildPage } from './comic-kit.mjs'

const MAX_PAGES = 12
const PAGE_MAX_CHARS = 300_000      // the app's COMIC_PAGE_MAX
const TOTAL_MAX_CHARS = 2_000_000   // the app's COMIC_TOTAL_MAX (backend cap 4 MB)

const args = process.argv.slice(2)
const VALUE_FLAGS = ['org', 'board', 'base', 'agent', 'session']
const flag = n => args.includes(`--${n}`)
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const dir = args.find(a => !a.startsWith('--') && !VALUE_FLAGS.some(n => opt(n) === a))
if (!dir) { console.error('usage: render-comic.mjs <dir> [--post --org O --board B [--base URL] [--agent A] [--session S]]'); process.exit(2) }

const root = resolve(dir)
const board = JSON.parse(readFileSync(join(root, 'storyboard.json'), 'utf8'))
if (!Array.isArray(board.pages) || board.pages.length === 0 || board.pages.length > MAX_PAGES) throw new Error(`storyboard.pages must hold 1–${MAX_PAGES} pages`)
if (!board.text) throw new Error('storyboard.text (the one-line chat text) is required')

const pages = []
for (const [i, p] of board.pages.entries()) {
  // A page is described (`panels`, drawn by comic-kit.mjs — the house style) or hand-drawn (`svg` file).
  let svg
  if (p.panels) { svg = buildPage(p, board.cast ?? {}); writeFileSync(join(root, `page-${i + 1}.svg`), svg) }
  else {
    const svgPath = join(root, p.svg ?? '')
    if (!p.svg || !existsSync(svgPath)) throw new Error(`page ${i + 1}: give either "panels" or an "svg" file`)
    svg = readFileSync(svgPath, 'utf8')
  }
  const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  if (image.length > PAGE_MAX_CHARS) throw new Error(`page ${i + 1} is ${image.length} chars, at most ${PAGE_MAX_CHARS}: simplify the drawing`)
  console.log(`page ${i + 1}: ${(svg.length / 1024).toFixed(0)} KB svg`)
  pages.push({ image, ...(p.title && { title: p.title }), ...(p.alt && { alt: p.alt }), ...(p.caption && { caption: p.caption }) })
}
const total = pages.reduce((n, p) => n + p.image.length, 0)
if (total > TOTAL_MAX_CHARS) throw new Error(`the comic is ${total} chars, at most ${TOTAL_MAX_CHARS}: fewer pages or simpler drawings`)

const snippet = { kind: 'comic', ...(board.title && { title: board.title }), ...(board.caption && { caption: board.caption }), pages }
writeFileSync(join(root, 'comic.snippet.json'), JSON.stringify({ text: board.text, snippet }))
console.log(`comic.snippet.json written (${pages.length} pages, ${(total / 1024).toFixed(0)} K chars)`)

if (flag('post')) {
  const token = process.env.EM_TOKEN ?? process.env.EVENTMODELERS_TOKEN ?? process.env.TOKEN
  const org = opt('org') ?? process.env.ORG_ID, boardId = opt('board') ?? process.env.BOARD_ID
  if (!token || !org || !boardId) { console.error('--post needs a token ($EM_TOKEN), --org and --board'); process.exit(2) }
  const base = (opt('base') ?? process.env.BASE_URL ?? 'https://api.eventmodelers.ai').replace(/\/$/, '')
  const body = { text: board.text, snippet, ...(opt('session') && { session_id: opt('session') }) }
  const res = await fetch(`${base}/api/org/${org}/boards/${boardId}/chat/agent-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token': token, ...(opt('agent') && { 'x-agent-id': opt('agent') }) },
    body: JSON.stringify(body),
  })
  const out = await res.text()
  if (!res.ok) { console.error(`post failed: ${res.status} ${out.slice(0, 400)}`); process.exit(1) }
  console.log('posted to the board chat')
}
