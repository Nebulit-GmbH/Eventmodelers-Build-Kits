// `replay <id>`: put a prompt the journal recorded back on the board's queue as a new prompt. The journal keeps what
// POST /prompts took — text, board, timeline, node, comment, priority and the canvas context — so the copy asks the
// same thing, about the same elements, as the original did.

// The `prompt-received` event for an id (a unique prefix will do), or an Error saying why there is none.
export function findPromptEvent(events, idPrefix) {
  const wanted = String(idPrefix ?? '').toLowerCase();
  if (!wanted) throw new Error('give the id of a prompt (`eventmodelers events --type prompt-received` lists them)');
  const hits = events.filter((e) => e?.type === 'prompt-received' && String(e.prompt?.id ?? '').toLowerCase().startsWith(wanted));
  const ids = [...new Set(hits.map((e) => e.prompt.id))];
  if (!ids.length) throw new Error(`no prompt "${idPrefix}" in the log — it may have been pruned (\`events --prune\`) or belong to another kit (--global, --kit)`);
  if (ids.length > 1) throw new Error(`"${idPrefix}" matches ${ids.length} prompts (${ids.map((i) => i.slice(0, 8)).join(', ')}) — give more of the id`);
  const prompt = hits[hits.length - 1];
  if (!prompt.prompt.timeline_id) throw new Error(`prompt ${ids[0].slice(0, 8)} was journaled before replay was supported (no timeline, and its text may be cut short) — it cannot be re-submitted`);
  return prompt;
}

// The POST /api/org/:orgId/prompts request for a journaled prompt. Auth is the realtime JWT; the API token rides along
// like it does on the agent's other prompt calls.
export function replayRequest({ baseUrl, organizationId, token, jwt, event }) {
  const p = event.prompt;
  return {
    url: `${baseUrl}/api/org/${organizationId}/prompts`,
    headers: { 'x-token': token, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: {
      prompt: p.text,
      board_id: p.board_id,
      timeline_id: p.timeline_id,
      ...(p.node_id ? { node_id: p.node_id } : {}),
      ...(p.comment_id ? { comment_id: p.comment_id } : {}),
      ...(p.priority ? { priority: true } : {}),
      ...(p.context ? { context: p.context } : {}),
    },
  };
}
