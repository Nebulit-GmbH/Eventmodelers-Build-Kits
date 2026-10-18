// The slice-state event log, decoded for a terminal (`eventmodelers events`): one plain-text line per event, the
// filters that go with it, and a summary of the state the log folds to. Colour is the command's business.

const short = (id) => (id ? String(id).slice(0, 8) : '');
const oneLine = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// slice id → title, from what the log itself knows (a claim records the slice's title).
export function sliceTitles(events) {
  const titles = {};
  for (const e of events) if (e.type === 'claimed' && e.slice && e.title) titles[e.slice] = e.title;
  return titles;
}

// How long a call took, and that it failed — nothing for an event without a duration.
const took = (e) => (typeof e.durationMs === 'number' ? ` (${e.durationMs < 1000 ? `${e.durationMs}ms` : `${(e.durationMs / 1000).toFixed(1)}s`}${e.error ? ', failed' : ''})` : '');

// [subject, detail] — what the event is about, and what it says.
function describe(e) {
  const tags = e.tags?.length ? ` ${e.tags.map((t) => `#${t}`).join(' ')}` : '';
  switch (e.type) {
    case 'board-observed': case 'agent-recorded': case 'settled':
      return [e.slice, e.status ?? ''];
    case 'claimed': {
      const tree = e.cleanTree === true ? 'clean tree' : e.cleanTree === false ? 'dirty tree' : 'not a git tree';
      return [e.slice, `pid ${e.pid}, ${tree}${e.base ? `, ${e.base.branch}@${String(e.base.head).slice(0, 8)}` : ''}${e.ticketNumber ? `, ticket ${e.ticketNumber}` : ''}${e.assignee ? `, assignee ${e.assignee}` : ''}`];
    }
    case 'claim-confirmed':
      return [e.slice, ''];
    case 'released':
      return [e.slice, e.reason ?? ''];
    case 'attempt-failed': {
      const files = String(e.changed ?? '').split('\n').filter((l) => l.trim()).length;
      const parts = [e.reason, e.status ? `back to ${e.status}` : '', files ? plural(files, 'file') : '', e.branch ?? ''].filter(Boolean);
      return [e.slice, `${parts.join(', ')}${e.lastReply ? `: ${oneLine(e.lastReply, 80)}` : ''}`];
    }
    case 'blocked':
      return [e.slice, oneLine(e.reason, 120)];
    case 'task-queued':
      return [e.payload?.sliceId, e.payload?.sliceStatus ?? ''];
    case 'task-done':
      return [e.task, ''];
    case 'learning-recorded':
      return ['', `[${e.topic ?? 'General'}] ${oneLine(e.text, 160)} (${e.scope ?? 'repo'}${tags})`];
    case 'learning-retracted':
      return [e.learning, e.reason ? oneLine(e.reason, 120) : ''];
    case 'learning-merged':
      return ['', `${plural(e.sources?.length ?? e.learnings?.length ?? 0, 'learning')} → ${oneLine(e.text, 120)}${e.reason ? ` — ${oneLine(e.reason, 80)}` : ''}`];
    case 'learnings-curated':
      return ['', ''];
    case 'prompt-received':
      return [e.prompt?.id, `"${oneLine(e.prompt?.text, 80)}"${e.prompt?.priority ? ', priority' : ''}, pid ${e.pid}`];
    case 'prompt-action':
      return [e.prompt, `${e.action ?? ''}${e.detail ? ` ${oneLine(e.detail, 140)}` : ''}${took(e)}`];
    case 'tool-call':
      return [e.prompt, `${oneLine(e.detail ?? e.tool, 140)}${took(e)}`];
    case 'prompt-finished':
      return [e.prompt, `${e.outcome ?? ''}${e.reason ? ` — ${oneLine(e.reason, 80)}` : ''}`];
    default: {
      const { type, id, at, meta, slice, ...rest } = e;
      return [slice, oneLine(JSON.stringify(rest), 160)];
    }
  }
}

// One line: date and time (UTC, as logged), type, subject (a slice with its title when known), detail, and the first four characters of the
// agent that wrote it with its type (build or modeling) — a log shared by several agents says who did what.
export function formatEvent(e, { titles = {} } = {}) {
  const time = typeof e.at === 'string' && e.at.length >= 19 ? `${e.at.slice(0, 10)} ${e.at.slice(11, 19)}` : '-'.repeat(19);
  const [rawSubject, detail] = describe(e);
  const title = titles[rawSubject];
  const subject = rawSubject ? `${short(rawSubject)}${title ? ` "${title}"` : ''}` : '';
  const agent = [e.meta?.agent_id ? String(e.meta.agent_id).slice(0, 4) : '', String(e.meta?.agent_type ?? '').toLowerCase()].filter(Boolean).join(' ');
  return [time, String(e.type).padEnd(18), subject, detail, agent].filter((p, i) => i < 2 || p).join('  ');
}

// What an event carries beyond its line, indented under it: every field but the ones the line already shows
// (type, id, time, who). Empty when there is nothing more to say.
export function formatPayload(e) {
  const { type, id, at, meta, ...rest } = e;
  if (!Object.keys(rest).length) return '';
  return JSON.stringify(rest, null, 2).split('\n').map((l) => `    ${l}`).join('\n');
}

// types / slice (an id prefix or part of a title) / tag / board (an id prefix — a global kit's log mixes boards) narrow
// the log; last keeps the final N that remain.
export function filterEvents(events, { types, slice, tag, board, last } = {}, titles = {}) {
  let out = events;
  if (board) out = out.filter((e) => String(e.meta?.board_id ?? '').toLowerCase().startsWith(board.toLowerCase()));
  if (types?.length) out = out.filter((e) => types.includes(e.type));
  if (slice) {
    const wanted = slice.toLowerCase();
    out = out.filter((e) => {
      const id = e.slice ?? e.payload?.sliceId;
      return !!id && (String(id).toLowerCase().startsWith(wanted) || String(titles[id] ?? '').toLowerCase().includes(wanted));
    });
  }
  if (tag) out = out.filter((e) => e.tags?.includes(tag));
  return last ? out.slice(-last) : out;
}

// What the log folds to: slices (status, holder, attempts), the queue, prompts in hand, learnings.
export function summarize(state, titles = {}) {
  const lines = [];
  const slices = Object.entries(state.slices);
  if (!slices.length) lines.push('no slices in the log');
  for (const [id, s] of slices) {
    const claim = s.claim ? `  claimed by pid ${s.claim.pid}${s.claim.confirmed ? '' : ' (unconfirmed)'}` : '';
    const name = titles[id] ?? s.claim?.title;
    const title = name ? ` "${name}"` : '';
    const attempts = s.attempts ? `  ${plural(s.attempts, 'failed attempt')}` : '';
    const blocked = s.blocked ? `  blocked: ${oneLine(s.blocked.reason, 80)}` : '';
    lines.push(`${short(id)}${title}  ${s.status ?? 'unknown'}${claim}${attempts}${blocked}`);
  }
  lines.push('');
  lines.push(`${plural(state.tasks.length, 'task')} waiting · ${plural(state.prompts.length, 'prompt')} open · ${plural(state.learnings.length, 'learning')}`);
  return lines.join('\n');
}
