// Draws comic pages as SVG from a description — one consistent, stylish look (ink outlines, slanted panels, halftone shading,
// flat colour, bust-shot characters). The agent describes panels; this file does the drawing, text fitting included.
//
//   import { buildPage } from './comic-kit.mjs'
//   buildPage({ accent: 'indigo', panels: [{ scene: 'office', characters: [{ who: 'Ana', pos: 'left', mood: 'worried' }, { who: 'Bot', pos: 'right', mood: 'smile' }],
//                bubbles: [{ who: 'Ana', text: 'Where did my order go?' }, { who: 'Bot', text: 'Found it: OrderPlaced.' }], caption: 'Monday, 9:02' }] },
//             { Ana: { kind: 'person', hair: 'messy', hairColor: '#5a3825', glasses: true }, Bot: { kind: 'robot', label: 'SHOP' } })
const INK = '#1b1f3b', PAPER = '#fbf6ea'
const FONT = "Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif"
const W = 1000
const ACCENTS = {
  indigo: { base: '#5b5bd6', tint: '#dfe0fb', deep: '#33336f' }, coral: { base: '#ef6a5b', tint: '#fde0db', deep: '#8e3a31' },
  teal: { base: '#1fa396', tint: '#d6f1ee', deep: '#106158' }, mustard: { base: '#e8a823', tint: '#fbefcf', deep: '#7d5a0c' },
}
const SKINS = ['#f2c9a0', '#e0a97c', '#b97d52', '#835338']
export const MOODS = ['neutral', 'smile', 'surprised', 'worried', 'proud', 'angry']
export const SCENES = ['office', 'screen', 'plain', 'burst', 'night']
export const LAYOUTS = { single: { H: 700, rows: [1] }, row2: { H: 560, rows: [2] }, row3: { H: 560, rows: [3] }, grid4: { H: 1000, rows: [2, 2] }, wide3: { H: 1000, rows: [1, 2] } }

let uid = 0
const id = p => `${p}${++uid}`
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---- text fitting (no font metrics available: average bold sans glyph ≈ 0.56 em)
function wrap(text, maxW, size) {
  const per = Math.max(4, Math.floor(maxW / (size * 0.56)))
  const lines = []; let line = ''
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + ' ' + word).length > per) { lines.push(line); line = word } else line = line ? line + ' ' + word : word
  }
  if (line) lines.push(line)
  return lines
}
const textBlock = (lines, cx, top, size, extra = '') =>
  `<text x="${cx}" y="${top}" text-anchor="middle" font-family="${FONT}" font-size="${size}" ${extra} fill="${INK}">${
    lines.map((l, i) => `<tspan x="${cx}" dy="${i === 0 ? size : size * 1.22}">${esc(l)}</tspan>`).join('')}</text>`

// ---- characters: drawn facing right around x=0, feet (bottom of the bust) at y=0, ~252 units tall
function person(c, mood, flip) {
  const skin = c.skin ?? SKINS[0], hair = c.hairColor ?? '#3b2a20', cloth = c.color ?? '#2d3a6b', f = flip ? -1 : 1, cl = id('c')
  const hairPath = { short: 'M-64 -192 C-70 -262 70 -262 64 -192 C44 -218 -30 -228 -64 -192 Z',
    messy: 'M-66 -190 C-80 -250 -30 -272 0 -258 C40 -276 84 -240 66 -190 C50 -214 30 -204 14 -222 C0 -204 -34 -214 -66 -190 Z',
    bun: 'M-64 -192 C-70 -262 70 -262 64 -192 C44 -218 -30 -228 -64 -192 Z M-14 -262 a22 20 0 1 1 44 0 a22 20 0 1 1 -44 0 Z',
    bald: '' }[c.hair ?? 'short']
  const brow = { neutral: 'M-38 -204 q16 -8 30 0 M8 -204 q16 -8 30 0', smile: 'M-38 -206 q16 -10 30 -2 M8 -208 q16 -8 30 2', surprised: 'M-38 -214 q16 -12 30 0 M8 -214 q16 -12 30 0',
    worried: 'M-38 -200 q16 -4 30 -12 M8 -212 q16 8 30 12', proud: 'M-38 -206 q16 -10 30 -2 M8 -208 q16 -8 30 2', angry: 'M-38 -212 q16 8 30 12 M8 -200 q16 -4 30 -12' }[mood]
  const eyes = mood === 'surprised' ? `<ellipse cx="-24" cy="-182" rx="9" ry="12" fill="#fff" stroke="${INK}" stroke-width="3"/><ellipse cx="24" cy="-182" rx="9" ry="12" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="-22" cy="-182" r="4" fill="${INK}"/><circle cx="26" cy="-182" r="4" fill="${INK}"/>`
    : mood === 'smile' || mood === 'proud' ? `<path d="M-34 -180 q10 -14 20 0 M14 -180 q10 -14 20 0" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
    : `<ellipse cx="-24" cy="-180" rx="6.5" ry="9" fill="${INK}"/><ellipse cx="24" cy="-180" rx="6.5" ry="9" fill="${INK}"/>`
  const mouth = { neutral: `<path d="M-14 -146 h28" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    smile: `<path d="M-22 -150 Q0 -128 22 -150" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    proud: `<path d="M-28 -152 Q0 -118 28 -152 Z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
    surprised: `<ellipse cx="0" cy="-143" rx="9" ry="12" fill="#7a2f3a" stroke="${INK}" stroke-width="4"/>`,
    worried: `<path d="M-18 -140 Q0 -154 18 -140" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    angry: `<path d="M-18 -142 Q0 -152 18 -142" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` }[mood]
  const glasses = c.glasses ? `<g fill="#fff" fill-opacity=".25" stroke="${INK}" stroke-width="4"><rect x="-44" y="-196" width="38" height="30" rx="11"/><rect x="6" y="-196" width="38" height="30" rx="11"/><path d="M-6 -184 h12" fill="none"/></g>` : ''
  return `<g transform="scale(${f} 1)"><clipPath id="${cl}"><ellipse cx="0" cy="-180" rx="62" ry="72"/></clipPath>
  <path d="M-112 0 C-112 -74 -70 -108 0 -108 C70 -108 112 -74 112 0 Z" fill="${cloth}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M30 -104 C80 -96 112 -60 112 0 L60 0 C64 -50 52 -84 30 -104 Z" fill="${INK}" opacity=".16"/>
  <path d="M-36 -108 Q0 -84 36 -108" fill="none" stroke="${INK}" stroke-width="4"/>
  <rect x="-22" y="-134" width="44" height="34" fill="${skin}" stroke="${INK}" stroke-width="4"/><rect x="-22" y="-134" width="44" height="14" fill="${INK}" opacity=".18"/>
  <circle cx="-60" cy="-176" r="12" fill="${skin}" stroke="${INK}" stroke-width="4"/><circle cx="60" cy="-176" r="12" fill="${skin}" stroke="${INK}" stroke-width="4"/>
  <ellipse cx="0" cy="-180" rx="62" ry="72" fill="${skin}" stroke="${INK}" stroke-width="5"/><rect x="24" y="-260" width="60" height="170" clip-path="url(#${cl})" fill="${INK}" opacity=".1"/>
  ${hairPath ? `<path d="${hairPath}" fill="${hair}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` : ''}
  <g transform="translate(8 0)">${glasses}${eyes}<path d="${brow}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>${mouth}</g></g>`
}
function robot(c, mood, accent) {
  const label = esc(c.label ?? 'AI'), glow = c.glow ?? '#5ee1ff'
  const eyes = { neutral: `<circle cx="-24" cy="-176" r="9" fill="${glow}"/><circle cx="24" cy="-176" r="9" fill="${glow}"/>`,
    smile: `<path d="M-36 -170 q12 -20 24 0 M12 -170 q12 -20 24 0" fill="none" stroke="${glow}" stroke-width="7" stroke-linecap="round"/>`,
    proud: `<path d="M-36 -170 q12 -20 24 0 M12 -170 q12 -20 24 0" fill="none" stroke="${glow}" stroke-width="7" stroke-linecap="round"/>`,
    surprised: `<circle cx="-24" cy="-176" r="13" fill="${glow}"/><circle cx="24" cy="-176" r="13" fill="${glow}"/>`,
    worried: `<path d="M-36 -178 h24 M12 -178 h24" stroke="${glow}" stroke-width="7" stroke-linecap="round"/><path d="M-36 -194 l22 6 M36 -194 l-22 6" stroke="${glow}" stroke-width="5" stroke-linecap="round"/>`,
    angry: `<path d="M-36 -168 l24 -8 M36 -168 l-24 -8" stroke="#ff7a7a" stroke-width="8" stroke-linecap="round"/>` }[mood]
  return `<g><line x1="0" y1="-262" x2="0" y2="-286" stroke="${INK}" stroke-width="5"/><circle cx="0" cy="-292" r="9" fill="${accent.base}" stroke="${INK}" stroke-width="4"/>
  <path d="M-100 0 C-100 -62 -62 -100 0 -100 C62 -100 100 -62 100 0 Z" fill="#f2f6fc" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M26 -98 C70 -90 100 -58 100 0 L56 0 C58 -46 46 -78 26 -98 Z" fill="${INK}" opacity=".14"/>
  <rect x="-20" y="-118" width="40" height="22" fill="#9aa8c4" stroke="${INK}" stroke-width="4"/>
  <rect x="-100" y="-216" width="24" height="52" rx="10" fill="${accent.base}" stroke="${INK}" stroke-width="4"/><rect x="76" y="-216" width="24" height="52" rx="10" fill="${accent.base}" stroke="${INK}" stroke-width="4"/>
  <rect x="-82" y="-262" width="164" height="150" rx="52" fill="#f2f6fc" stroke="${INK}" stroke-width="5"/><path d="M30 -258 q50 10 50 80 q0 50 -24 62 q18 -50 -26 -142 Z" fill="${INK}" opacity=".1"/>
  <rect x="-64" y="-224" width="128" height="86" rx="34" fill="#141a3d" stroke="${INK}" stroke-width="4"/><path d="M-50 -214 q40 -12 80 0" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".25" fill="none"/>
  ${eyes}<text x="0" y="-48" text-anchor="middle" font-family="${FONT}" font-size="${label.length > 3 ? 26 : 34}" font-weight="800" fill="${accent.deep}">${label}</text></g>`
}

// ---- scenes (panel-local coordinates, w × h)
function scene(kind, w, h, a, panel, patId, lay) {
  const halftone = `<path d="M0 ${h} L${w * 0.7} ${h} L0 ${h * 0.35} Z" fill="url(#${patId})"/>`
  if (kind === 'burst') {
    const cx = w * 0.5, cy = h * 0.42, rays = Array.from({ length: 22 }, (_, i) => { const t0 = i / 22 * Math.PI * 2, t1 = t0 + Math.PI / 22, R = Math.max(w, h) * 1.2
      return `<path d="M${cx} ${cy} L${cx + R * Math.cos(t0)} ${cy + R * Math.sin(t0)} L${cx + R * Math.cos(t1)} ${cy + R * Math.sin(t1)} Z" fill="#fff" opacity=".42"/>` }).join('')
    return `<rect width="${w}" height="${h}" fill="#ffd45c"/>${rays}${halftone}`
  }
  if (kind === 'night') return `<rect width="${w}" height="${h}" fill="#1d2447"/>${Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 197) % w}" cy="${(i * 83) % (h * 0.5)}" r="${1.5 + i % 3}" fill="#fff" opacity=".7"/>`).join('')}${halftone}`
  if (kind === 'screen') {
    const s = panel.screen ?? {}, ok = s.status !== 'error', sw = w * 0.62, sh = Math.min(h * 0.36, lay.headTop - lay.top - 10), sx = w * 0.35, sy = lay.top + 4
    if (sh < 70) return `<rect width="${w}" height="${h}" fill="${a.tint}"/>${halftone}`
    const lines = (s.lines ?? []).slice(0, 3).map((l, i) => `<text x="${sx + 22}" y="${sy + 58 + i * 28}" font-family="${FONT}" font-size="20" font-weight="600" fill="#cfd8ff">${esc(l)}</text>`).join('')
    return `<rect width="${w}" height="${h}" fill="${a.tint}"/>${halftone}<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="12" fill="#141a3d" stroke="${INK}" stroke-width="5"/>
      <text x="${sx + 22}" y="${sy + 32}" font-family="${FONT}" font-size="22" font-weight="800" fill="#fff">${esc(s.title ?? '')}</text>${lines}
      <circle cx="${sx + sw - 38}" cy="${sy + sh - 36}" r="20" fill="${ok ? '#2fbf71' : '#e5484d'}" stroke="${INK}" stroke-width="3"/><path d="${ok ? 'M-9 0 l6 7 l12 -14' : 'M-8 -8 l16 16 M8 -8 l-16 16'}" transform="translate(${sx + sw - 38} ${sy + sh - 36})" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (kind === 'office') {
    const ww = w * 0.46, wh = h * 0.3, wx = w * 0.26, wy = h * 0.08
    const b = [[0.08, 0.5], [0.3, 0.8], [0.55, 0.62], [0.78, 0.9]].map(([x, t]) => `<rect x="${wx + ww * x}" y="${wy + wh * (1 - t)}" width="${ww * 0.18}" height="${wh * t}" fill="${a.base}" opacity=".35"/>`).join('')
    return `<rect width="${w}" height="${h}" fill="${a.tint}"/>${halftone}<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="#bfe3f7" stroke="${INK}" stroke-width="5"/>${b}<path d="M${wx + ww / 2} ${wy} v${wh} M${wx} ${wy + wh / 2} h${ww}" stroke="${INK}" stroke-width="3"/>
      <rect x="0" y="${h * 0.8}" width="${w}" height="${h * 0.2}" fill="${a.deep}" opacity=".85"/><line x1="0" y1="${h * 0.8}" x2="${w}" y2="${h * 0.8}" stroke="${INK}" stroke-width="5"/>
      <g transform="translate(${w * 0.9} ${h * 0.8})"><path d="M-16 0 l4 -34 h24 l4 34 Z" fill="#c9784f" stroke="${INK}" stroke-width="4"/><path d="M0 -34 C-30 -60 -26 -90 -4 -96 C-4 -76 0 -56 0 -34 M0 -34 C30 -64 30 -86 10 -102 C6 -80 0 -56 0 -34" fill="#2fa36b" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/></g>`
  }
  return `<rect width="${w}" height="${h}" fill="${a.tint}"/>${halftone}`
}

// ---- one panel
function panelSvg(p, w, h, accent, cast) {
  const patId = id('dots'), chars = (p.characters ?? []).slice(0, 3)
  const capSize = 22, capLines = p.caption ? wrap(p.caption, w - 36, capSize) : [], capH = p.caption ? capLines.length * capSize * 1.22 + 22 : 0
  const bubbles = (p.bubbles ?? []).slice(0, 3)
  // fit: shrink the bubble text until every bubble fits in the upper part of the panel
  const avail = (h - capH) * 0.5; let size = w < 420 ? 26 : 30, laid
  for (; size >= 17; size -= 1) {
    const maxW = w * (bubbles.length > 1 ? 0.8 : 0.86) - 32
    laid = bubbles.map(b => { const lines = wrap(b.text, maxW, size), tw = Math.max(...lines.map(l => l.length)) * size * 0.56
      return { ...b, lines, bw: Math.min(maxW + 32, tw + 36), bh: lines.length * size * 1.22 + 26 } })
    if (laid.reduce((n, b) => n + b.bh + 14, 0) <= avail + 14) break
  }
  const slot = c => ({ left: 0.27, right: 0.73, center: 0.5 }[c.pos ?? 'center'])
  const multi = chars.length > 1
  const sc = Math.max(0.35, Math.min((h - capH) * 0.52 / 262, w * (multi ? 0.46 : 0.7) / 224))
  const baseY = h - capH + 6
  const top = 14 + laid.reduce((n, b) => n + b.bh + 14, 0)
  let out = scene(p.scene ?? 'plain', w, h, accent, p, patId, { top, headTop: baseY - 262 * sc + 24 })
  const speakerX = {}
  for (const c of chars) {
    const def = cast[c.who] ?? { kind: 'person' }, x = w * slot(c), flip = (c.pos ?? 'center') === 'right', mood = MOODS.includes(c.mood) ? c.mood : 'neutral'
    speakerX[c.who] = x
    out += `<g transform="translate(${x} ${baseY}) scale(${sc})">${def.kind === 'robot' ? robot(def, mood, accent) : person({ color: accent.deep, ...def }, mood, flip)}</g>`
  }
  let y = 14
  laid.forEach((b, i) => {
    const sx = speakerX[b.who] ?? w / 2, left = sx < w / 2 - 1, mid = Math.abs(sx - w / 2) < 1
    const x = mid ? (w - b.bw) / 2 : left ? w * 0.04 : w * 0.96 - b.bw, by = y, headTop = baseY - 262 * sc + 24
    const tx = Math.min(Math.max(sx, x + 30), x + b.bw - 30), tip = [Math.min(Math.max(sx + (left ? 6 : -6), 10), w - 10), Math.max(by + b.bh + 18, headTop)]
    const think = b.kind === 'think'
    out += think
      ? `<g><rect x="${x}" y="${by}" width="${b.bw}" height="${b.bh}" rx="${Math.min(30, b.bh / 2)}" fill="#fff" stroke="${INK}" stroke-width="4" stroke-dasharray="2 0"/><circle cx="${tx}" cy="${by + b.bh + 10}" r="7" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="${(tx + tip[0]) / 2}" cy="${(by + b.bh + tip[1]) / 2 + 6}" r="5" fill="#fff" stroke="${INK}" stroke-width="3"/></g>`
      : `<g><path d="M${tx - 14} ${by + b.bh - 4} L${tip[0]} ${tip[1]} L${tx + 14} ${by + b.bh - 4}" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><rect x="${x}" y="${by}" width="${b.bw}" height="${b.bh}" rx="${Math.min(30, b.bh / 2)}" fill="#fff" stroke="${INK}" stroke-width="4"/><path d="M${tx - 10} ${by + b.bh} h20" stroke="#fff" stroke-width="7"/></g>`
    out += textBlock(b.lines, x + b.bw / 2, by + 13, size, 'font-weight="700"')
    y += b.bh + 14 + (laid.length > 1 && i === 0 ? 6 : 0)
  })
  if (p.sfx) out += `<text transform="translate(${w * 0.5} ${h * 0.5}) rotate(-8)" text-anchor="middle" font-family="${FONT}" font-size="${Math.min(84, w / 4)}" font-weight="900" fill="#ffd45c" stroke="${INK}" stroke-width="7" paint-order="stroke" stroke-linejoin="round">${esc(p.sfx)}</text>`
  if (p.caption) out += `<rect x="0" y="${h - capH}" width="${w}" height="${capH}" fill="#ffe99a"/><line x1="0" y1="${h - capH}" x2="${w}" y2="${h - capH}" stroke="${INK}" stroke-width="4"/>${textBlock(capLines, w / 2, h - capH + 11, capSize, 'font-style="italic" font-weight="600"')}`
  return `<pattern id="${patId}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="4.5" cy="4.5" r="1.9" fill="${INK}" opacity=".22"/></pattern>${out}`
}

export function buildPage(spec, cast = {}) {
  const panels = spec.panels ?? []
  const layout = LAYOUTS[spec.layout] ? spec.layout : { 1: 'single', 2: 'row2', 3: 'row3', 4: 'grid4' }[panels.length]
  if (!layout) throw new Error(`a page holds 1–4 panels (got ${panels.length}); use more pages`)
  const { H, rows } = LAYOUTS[layout], need = rows.reduce((n, r) => n + r, 0)
  if (need !== panels.length) throw new Error(`layout ${layout} needs ${need} panels, got ${panels.length}`)
  const accent = ACCENTS[spec.accent] ?? ACCENTS.indigo, M = 26, G = 14, S = 22
  const rowH = (H - 2 * M - (rows.length - 1) * G) / rows.length
  let svg = '', k = 0
  rows.forEach((n, r) => {
    const y0 = M + r * (rowH + G), colW = (W - 2 * M - (n - 1) * G) / n, s = n > 1 ? S : 0
    for (let c = 0; c < n; c++) {
      // slanted dividers: the line through the middle of each gutter leans by S; outer edges are straight
      const lx = c === 0 ? [M, M] : [M + c * (colW + G) - G / 2 + s / 2 + G / 2, M + c * (colW + G) - G / 2 - s / 2 + G / 2]
      const rx = c === n - 1 ? [W - M, W - M] : [M + (c + 1) * (colW + G) - G / 2 + s / 2 - G / 2, M + (c + 1) * (colW + G) - G / 2 - s / 2 - G / 2]
      const poly = [[lx[0], y0], [rx[0], y0], [rx[1], y0 + rowH], [lx[1], y0 + rowH]]
      const bx = Math.min(lx[0], lx[1]), bw = Math.max(rx[0], rx[1]) - bx, cid = id('p')
      svg += `<clipPath id="${cid}"><polygon points="${poly.map(q => q.join(',')).join(' ')}"/></clipPath>
        <g clip-path="url(#${cid})"><g transform="translate(${bx} ${y0})">${panelSvg(panels[k], bw, rowH, accent, cast)}</g></g>
        <polygon points="${poly.map(q => q.join(',')).join(' ')}" fill="none" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`
      k++
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/>${svg}</svg>`
}
