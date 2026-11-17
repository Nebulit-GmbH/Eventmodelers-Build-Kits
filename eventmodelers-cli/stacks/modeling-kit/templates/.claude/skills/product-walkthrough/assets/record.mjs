#!/usr/bin/env node
// Product walkthrough recorder. Opens a headed browser with a small toolbar (Comment / Record / Done) injected into
// every page. Comment = click a spot, type a note. Record = capture what is VISIBLE in the window: a screenshot and the comments placed since the last Record. The agent uploads each
// screenshot as an image screen and turns the comments into screen bubbles (x/y as fractions of the picture).
// Screenshots are kept small on purpose: 1x scale (no retina), JPEG quality 60, window size 1280x800 by default.
//
//   node record.mjs --url https://app.example.com --out /tmp/walkthrough-x [--width 1280] [--height 800]
//
// Writes <out>/step-N.jpg and, after every Record, <out>/steps.json:
//   [{ title, url, image, viewport:{w,h}, bubbles:[{text,x,y,target}] }]  (x/y = viewport pixels)
// Prints one line per event and "DONE <n>" when the person presses Done (or closes the window).

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d }
const URL_ = arg('url'), OUT = arg('out', './walkthrough-run')
const W = +arg('width', 1280), H = +arg('height', 800)

// Playwright is looked up beside this script (the kit's node_modules), then from the working directory, then in the global
// npm root — an install the person already has elsewhere on the machine counts.
async function loadPlaywright() {
  try { return await import('playwright') } catch {}
  const roots = [process.cwd()]
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) } catch {}
  for (const root of roots.filter(Boolean)) {
    for (const name of ['playwright', 'playwright-core']) {
      try { return await import(pathToFileURL(createRequire(path.join(root, 'noop.js')).resolve(name)).href) } catch {}
    }
  }
  return null
}
const pw = await loadPlaywright()
const chromium = pw && (pw.chromium ?? pw.default?.chromium)

// --check: is Playwright + Chromium usable? exit 0 yes, 2 no playwright, 1 no chromium. Opens nothing.
if (process.argv.includes('--check')) {
  if (!chromium) process.exit(2)
  process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)
}
if (!URL_) { console.error('usage: node record.mjs --url <url> --out <dir>'); process.exit(2) }
if (!chromium) {
  console.error('playwright is not installed (looked beside the kit, in the working directory and in the global npm root). Run: npm i -D playwright && npx playwright install chromium in the kit directory'); process.exit(3)
}
fs.mkdirSync(OUT, { recursive: true })

const steps = []
let pending = [] // comments placed since the last Record: { id, text, x, y, ox, oy }
const save = () => fs.writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify(steps, null, 2))

// ---- injected overlay (shadow DOM, so it cannot disturb the page and is skipped by the snapshot) ----
const OVERLAY = `(() => {
  if (window.__emWalk || window !== window.top) return; window.__emWalk = true
  const mount = () => {
    const host = document.createElement('div'); host.id = 'em-walk-host'
    host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647'
    const s = host.attachShadow({ mode: 'open' })
    s.innerHTML = '<style>.bar{display:flex;gap:6px;padding:6px;border-radius:10px;background:#111827;font:600 12px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.35)}'
      + 'button{font:inherit;color:#fff;background:#374151;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}button.on{background:#ca8a04}button.rec{background:#dc2626}button.done{background:#16a34a}'
      + '.msg{color:#9ca3af;align-self:center;padding:0 4px}.box{position:fixed;display:none;padding:8px;border-radius:10px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.3);font:13px system-ui}'
      + 'textarea{display:block;width:240px;height:70px;font:inherit}.box button{margin-top:6px;background:#2563eb}</style>'
      + '<div class="bar"><button id="c">Comment</button><button id="r" class="rec" title="Captures what is visible in the window. Long page? Scroll, then press Record again — each press is one step.">● Record</button><button id="d" class="done">Done</button><span class="msg" id="m">0 steps · long page? scroll, then Record again</span></div>'
      + '<div class="box" id="b"><textarea id="t" maxlength="500" placeholder="Comment…"></textarea><button id="ok">Add</button></div>'
    document.documentElement.appendChild(host)
    const $ = id => s.getElementById(id); let mode = false, target = null, n = 0
    const say = t => { $('m').textContent = t }
    $('c').onclick = () => { mode = !mode; $('c').classList.toggle('on', mode); document.documentElement.style.cursor = mode ? 'crosshair' : '' }
    $('r').onclick = async () => { say('recording…'); const r = await window.emRecord(); n = 0; document.querySelectorAll('.em-mark').forEach(e => e.remove()); say(r.msg) }
    $('d').onclick = async () => { await window.emDone() }
    window.addEventListener('click', e => {
      if (!mode || e.composedPath().includes(host)) return
      e.preventDefault(); e.stopImmediatePropagation()
      const t = document.elementFromPoint(e.clientX, e.clientY)
      if (!t || t === document.body || t === document.documentElement) return
      target = { el: t, x: e.clientX, y: e.clientY }
      const b = $('b'); b.style.display = 'block'; b.style.left = Math.min(e.clientX, innerWidth - 270) + 'px'; b.style.top = Math.min(e.clientY, innerHeight - 140) + 'px'; $('t').value = ''; $('t').focus()
    }, true)
    $('ok').onclick = async () => {
      const text = $('t').value.trim(); $('b').style.display = 'none'; mode = false; $('c').classList.remove('on'); document.documentElement.style.cursor = ''
      if (!text || !target) return
      const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6)
      n++
      const m = document.createElement('div'); m.className = 'em-mark'; m.textContent = n
      m.style.cssText = 'position:fixed;z-index:2147483000;left:' + target.x + 'px;top:' + target.y + 'px;transform:translate(-4px,-100%);background:#facc15;color:#422006;font:700 11px/22px system-ui;width:26px;height:22px;border-radius:8px;text-align:center;pointer-events:none'
      document.body.appendChild(m)
      await window.emComment({ id, text, x: Math.round(target.x), y: Math.round(target.y), target: { tag: target.el.tagName.toLowerCase(), text: (target.el.innerText || target.el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60) } })
      say(n + ' comment(s) pending')
    }
  }
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount)
})()`

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await context.addInitScript(OVERLAY)

let finish
const done = new Promise(r => { finish = r })

await context.exposeBinding('emComment', (_src, c) => { pending.push(c); console.log('COMMENT', c.id) })
await context.exposeBinding('emRecord', async ({ page }) => {
  try {
    const n = steps.length + 1
    const file = 'step-' + n + '.jpg'
    // The toolbar and the comment markers are hidden for the shot, not part of the page.
    await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 60, scale: 'css', style: '#em-walk-host,.em-mark{visibility:hidden !important}' })
    const vp = page.viewportSize() ?? { width: W, height: H }
    const bubbles = pending.map(c => ({ text: c.text, x: c.x, y: c.y, target: c.target }))
    steps.push({ title: (await page.title()) || page.url(), url: page.url(), image: file, viewport: { w: vp.width, h: vp.height }, bubbles })
    pending = []; save()
    console.log('RECORD', n, file, 'comments=' + bubbles.length)
    return { msg: 'step ' + n + ' recorded · scroll and Record again for more' }
  } catch (e) { console.log('RECORD_FAILED', e.message); return { msg: 'record failed: ' + e.message } }
})
await context.exposeBinding('emDone', () => { finish() })

const page = await context.newPage()
await page.goto(URL_)
browser.on('disconnected', () => finish())
console.log('READY — Comment / Record / Done in the top-right toolbar')
await done
if (pending.length) console.log('WARN', pending.length, 'comment(s) placed after the last Record were dropped')
save()
console.log('DONE', steps.length)
await browser.close().catch(() => {})
