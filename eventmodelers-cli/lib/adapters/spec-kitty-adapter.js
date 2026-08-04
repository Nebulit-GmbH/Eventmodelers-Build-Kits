// Spec Kitty adapter — turns an Eventmodelers context into a Spec Kitty
// mission brief, deterministically, with no LLM call. It deliberately stops
// there: Spec Kitty's own `/spec-kitty.specify` → `/spec-kitty.plan` →
// `/spec-kitty.tasks` pipeline is what creates the mission, spec.md, and work
// packages, because those steps require real judgment (WP boundaries, which
// files a WP owns, which agent profile fits) that only make sense with actual
// codebase context — this adapter has none of that, only the event model.
//
// Spec Kitty already has a first-class way to accept structured input instead
// of running its interactive discovery interview: `spec-kitty intake <path>`
// writes .kittify/mission-brief.md, and /spec-kitty.specify's own "Brief
// Context Detection" step reads that file and extracts requirements from it
// (asking 0-3 gap-filling questions instead of a full interview) — this
// adapter's whole job is producing a good brief and calling `intake`, nothing
// more.
//
// Lives here (not only inside a bridge-kit install) so it has exactly one
// entry point regardless of caller: `eventmodelers fetch --spec-kitty` calls
// it directly for a one-shot sync; `eventmodelers bridge` (via
// ralph-static.js) calls the same run() from a copy the bridge-kit installer
// places at .bridge-kit/adapters/ — see installStack in cli.js.
//
// Exports run({ cfg, projectDir, contextName }).

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DEFAULT_BASE_URL = 'https://api.eventmodelers.ai';

function slugify(text) {
  return (text ?? '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// Mirrors lib/fetch.js's per-context call rather than importing runFetch
// directly — this fetches raw JSON only, it never touches .slices/ (fetch.js
// owns writing that), and a copy of this file also has to run standalone
// inside an installed .bridge-kit/ with no access to lib/fetch.js at all.
async function fetchFullSliceData(cfg, contextName) {
  const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata?contextName=${encodeURIComponent(contextName)}`;
  const res = await fetch(url, {
    headers: { 'x-token': cfg.token, 'x-board-id': cfg.boardId, 'x-user-id': 'spec-kitty-adapter' },
  });
  if (!res.ok) throw new Error(`slicedata fetch failed for context "${contextName}": HTTP ${res.status}`);
  return res.json();
}

// Set on errors that no amount of retrying will fix (missing setup, missing
// binary) — callers should stop instead of retrying on these: ralph-static.js
// exits instead of looping forever, `fetch --spec-kitty` just reports and exits.
function fatal(message) {
  const err = new Error(message);
  err.fatal = true;
  return err;
}

function assertSpecKittyInitialized(projectDir) {
  if (!existsSync(join(projectDir, '.kittify'))) {
    throw fatal(
      `Spec Kitty isn't initialized in ${projectDir} (no .kittify/ found).\n` +
        '  Run this once from the project root, then re-sync:\n' +
        '    spec-kitty init --ai claude --non-interactive',
    );
  }
}

// given/when/then are each arrays of element objects (command/event/etc.,
// each with its own `title`), not plain strings — confirmed against a real
// slicedata payload. `title` is the specification's own natural-language
// summary (e.g. "Cannot move on the opponent's turn") and is populated
// whenever the board has one, so it's the primary source; the given/when/then
// element names are only a fallback for specs that somehow lack a title.
function elementNames(elements) {
  return (elements || []).map((e) => e?.title).filter(Boolean).join(', ');
}

function formatScenario(spec) {
  if (spec?.title) return spec.title;
  const given = elementNames(spec?.given);
  const when = elementNames(spec?.when);
  const then = elementNames(spec?.then);
  if (given || when || then) {
    return `Given ${given || '…'}, when ${when || '…'}, then ${then || '…'}.`;
  }
  return spec?.description || null;
}

// Plain prose, in board/timeline order — nothing here is invented. Priority,
// WP boundaries, and requirement IDs are exactly the judgment calls left to
// /spec-kitty.specify; this only restates what the event model already says.
export function buildBrief({ contextName, slices }) {
  const lines = [
    `# Event model: ${contextName}`,
    '',
    `This is a Spec Kitty mission brief generated from the "${contextName}" context on the Eventmodelers board — not free-text from a user. It restates the event model as-is; it does not add scope, priority, or requirements the board doesn't state.`,
    '',
  ];

  for (const slice of slices) {
    lines.push(`## ${slice.title}`);
    lines.push('');
    if (slice.description?.trim()) {
      lines.push(slice.description.trim());
      lines.push('');
    }

    const scenarios = (slice.specifications || []).map(formatScenario).filter(Boolean);
    if (scenarios.length) {
      for (const s of scenarios) lines.push(`- ${s}`);
    } else {
      lines.push('_No specifications captured for this slice on the board yet._');
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function run({ cfg, projectDir, contextName }) {
  assertSpecKittyInitialized(projectDir);

  console.log(`[spec-kitty-adapter] Fetching context "${contextName}"...`);
  const payload = await fetchFullSliceData(cfg, contextName);
  const slices = payload.slices || [];
  if (!slices.length) {
    console.log(`[spec-kitty-adapter] No slices in context "${contextName}" — nothing to write.`);
    return;
  }

  const contextSlug = slugify(contextName) || 'default';
  const briefPath = join(tmpdir(), `eventmodelers-brief-${contextSlug}.md`);
  writeFileSync(briefPath, buildBrief({ contextName, slices }));

  try {
    execFileSync('spec-kitty', ['intake', briefPath, '--force'], { cwd: projectDir, stdio: 'inherit' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw fatal('`spec-kitty` CLI not found on PATH — install spec-kitty-cli first (see https://github.com/dilgerma/spec-kitty).');
    }
    throw new Error(`spec-kitty intake failed: ${err.stderr || err.message}`);
  } finally {
    try {
      unlinkSync(briefPath);
    } catch {
      // Scratch file in tmpdir — not worth failing the sync over.
    }
  }

  console.log(
    `[spec-kitty-adapter] Brief synced from ${slices.length} slice(s) in "${contextName}" → .kittify/mission-brief.md.\n` +
      '  Run the `/spec-kitty.specify` slash command in your coding agent to turn it into a mission ' +
      '(the plain `spec-kitty specify` CLI command only scaffolds — brief detection and requirement ' +
      'extraction happen in the agent-driven prompt, not the bare CLI).',
  );
}
