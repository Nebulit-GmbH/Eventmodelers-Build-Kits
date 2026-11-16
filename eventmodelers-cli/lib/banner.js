// Startup banner: the three sticky notes from the Eventmodelers logo, drawn as braille dots
// (2x4 dots per terminal cell, the dot-matrix look of other agent CLIs) next to a short welcome. Pure and TTY-guarded —
// renderBanner() only builds a string, showBanner() decides whether to print it.

const NOTES = [
  // cx/cy/size in dots, tilt in degrees, fill colour
  { cx: 8, cy: 8, size: 13, tilt: -4, rgb: [186, 192, 240] },   // lavender, top-left
  { cx: 25, cy: 11, size: 12, tilt: 16, rgb: [205, 224, 90] },  // lime, top-right
  { cx: 17, cy: 25, size: 12, tilt: -14, rgb: [255, 213, 79] }, // yellow, bottom
];
const SCALE = 1.5;
const W = 54; // dots; 2 per terminal column
const H = 52; // dots; 4 per terminal row

// Index of the topmost note covering the point, or -1.
function noteAt(x, y) {
  for (let i = NOTES.length - 1; i >= 0; i--) {
    const n = NOTES[i];
    const a = (-n.tilt * Math.PI) / 180;
    const dx = x - n.cx * SCALE;
    const dy = y - n.cy * SCALE;
    const rx = dx * Math.cos(a) - dy * Math.sin(a);
    const ry = dx * Math.sin(a) + dy * Math.cos(a);
    const half = (n.size * SCALE) / 2;
    if (Math.abs(rx) <= half && Math.abs(ry) <= half) return i;
  }
  return -1;
}

// Braille bit for the dot at (col 0-1, row 0-3) inside a cell.
const BIT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];

export function logoRows({ color = true } = {}) {
  const rows = [];
  for (let cy = 0; cy < H; cy += 4) {
    let line = '';
    for (let cx = 0; cx < W; cx += 2) {
      let bits = 0;
      const votes = [0, 0, 0];
      for (let c = 0; c < 2; c++) {
        for (let r = 0; r < 4; r++) {
          const i = noteAt(cx + c + 0.5, cy + r + 0.5);
          if (i >= 0) { bits |= BIT[c][r]; votes[i]++; }
        }
      }
      if (!bits) { line += ' '; continue; }
      const ch = String.fromCharCode(0x2800 + bits);
      if (!color) { line += ch; continue; }
      const n = NOTES[votes.indexOf(Math.max(...votes))];
      // darker toward the bottom of each note, like a curl shadow
      const shade = 1 - 0.2 * Math.min(1, Math.max(0, (cy + 2 - (n.cy - n.size / 2) * SCALE) / (n.size * SCALE)));
      const [r, g, b] = n.rgb.map((v) => Math.round(v * shade));
      line += `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
    }
    rows.push(line.replace(/\s+$/, ''));
  }
  while (rows.length && !rows[0].trim()) rows.shift();
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  return rows;
}

export function renderBanner({ version, color = true } = {}) {
  const bold = (t) => (color ? `\x1b[1m${t}\x1b[0m` : t);
  const accent = (t) => (color ? `\x1b[38;2;255;213;79m${t}\x1b[0m` : t);
  const dim = (t) => (color ? `\x1b[2m${t}\x1b[0m` : t);
  const logo = logoRows({ color });
  const text = [
    `${bold('Welcome to')} ${accent(`Eventmodelers CLI${version ? ` v${version}` : ''}`)}`,
    `${dim('Learn more:')} https://eventmodelers.ai`,
  ];
  const start = Math.max(0, Math.floor((logo.length - text.length) / 2) - 1);
  return logo
    .map((row, i) => {
      const t = text[i - start];
      const pad = ' '.repeat(Math.max(0, W / 2 - visibleLength(row)) + 4);
      return t ? `${row}${pad}${t}` : row;
    })
    .join('\n');
}

const visibleLength = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

// Prints to stderr (never pollutes piped stdout), only on an interactive terminal.
export function showBanner({ version, env = process.env, stream = process.stderr } = {}) {
  if (!stream.isTTY || env.CI || env.EVENTMODELERS_NO_BANNER) return false;
  const color = !env.NO_COLOR && (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || /^(iTerm|vscode|WezTerm|ghostty)/i.test(env.TERM_PROGRAM ?? ''));
  stream.write(`\n${renderBanner({ version, color })}\n\n`);
  return true;
}
