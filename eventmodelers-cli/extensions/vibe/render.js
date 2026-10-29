// The board's `Legacy Sources — <Chapter>` note, rendered from the baseline file. The file drives the markdown, never the reverse: the
// note is a view for people to read, and nothing parses it back. The format is the one `analyze-code-base` documents ("The analysis log").
import { LENSES } from './state.js';

const AREA = { api: 'API', persistence: 'Persistence', tests: 'Tests', ui: 'UI' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

export const noteTitle = (b) => `Legacy Sources — ${b.chapter}`;

export function renderNote(b, { codeRoot = '.' } = {}) {
  const parts = [`Code root \`${codeRoot}\` · running UI: ${b.runningUi || 'not answered yet'}`];
  parts.push('## Analysis history\n' + table(['#', 'Date', 'Commit', 'Pass', 'Scope', 'Result'], b.history.map((h, i) => [i + 1, h.date, `\`${h.commit || 'no git'}${h.dirty && Object.keys(h.dirty).length ? '+dirty' : ''}\``, h.pass, h.scope, h.result])));
  const where = LENSES.flatMap((lens) => (b.folders?.[lens] || []).map((f) => [AREA[lens], `\`${f.path}\``, f.key ? f.key.split(/\s*,\s*/).map((k) => `\`${k}\``).join(', ') : '']));
  parts.push('## Where this flow lives\n' + (where.length ? table(['Area', 'Folder / package', 'Key classes'], where) : '_Not looked at yet — milestones only._'));
  if (b.decisions?.length) parts.push('## Chapter decisions\n' + table(['#', 'Decision', 'Why', 'Source', 'Confirmed by'], b.decisions.map((d, i) => [i + 1, d.decision, d.why, d.source, d.confirmedBy])));
  if (b.notModeled?.length) parts.push('## Not modeled\n' + table(['Code', 'Reason'], b.notModeled.map((n) => [`\`${n}\``, 'technical, no business decision'])));
  return parts.join('\n\n') + '\n';
}
