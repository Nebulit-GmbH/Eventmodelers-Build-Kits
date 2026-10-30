// `eventmodelers init --vibe-coding` and `eventmodelers vibe …` — vibe-coded changes reach the event model first, then the model changes the system.
// Self-contained and removable: delete this folder, test/vibe-local.test.js and the three hooks in cli.js (the import, the `--vibe-coding` options on
// init with its one-line delegate, registerVibe()). `eventmodelers vibe remove` cleans a project first. Project state lives in .vibe/ (state.js).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolute, check, driftOf, headCommit, isGit, stateOf, workingTreeFiles } from './coverage.js';
import { ANSWERS, control, record } from './control.js';
import { noteTitle, renderNote } from './render.js';
import { DIR, findVibeRoot, foldersOf, listBaselines, paths, readBaseline, removeVibe, writeBaseline } from './state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', '..', 'cli.js');
const START = '<!-- eventmodelers-vibe:start -->';
const END = '<!-- eventmodelers-vibe:end -->';
const SKILLS = ['start-vibe-session', 'vibe-control', 'vibe-translate'];
const SHARED = join(HERE, '..', '..', 'shared', 'skills');
const MODELING_KIT_SKILLS = join(HERE, '..', '..', 'stacks', 'modeling-kit', 'templates', '.claude', 'skills');
// What the two vibe skills hand work to: the analysis itself, the modeling rules, the skills that place elements and comments. Copied as they are,
// not removed again by `vibe remove` (a project may use them for other work too).
const MODELING_SKILLS = ['analyze-code-base', 'place-element', 'timeline', 'handle-comment', 'attributes', 'examples', 'html-screen', 'discover-storyboard'];

const fill = (text) => text.replaceAll('{{CLI}}', `node "${CLI}"`);

export function installSkills(root) {
  const skills = join(root, '.claude', 'skills');
  for (const name of SKILLS) {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), fill(readFileSync(join(HERE, 'skills', name, 'SKILL.md'), 'utf8')));
  }
  for (const name of ['connect', 'learn-eventmodelers-api']) cpSync(join(SHARED, name), join(skills, name), { recursive: true });
  const modeling = readdirSync(MODELING_KIT_SKILLS).filter((n) => MODELING_SKILLS.includes(n) || n.startsWith('eventmodeling-'));
  for (const name of modeling) cpSync(join(MODELING_KIT_SKILLS, name), join(skills, name), { recursive: true });

  const block = `${START}\n${fill(readFileSync(join(HERE, 'claude-block.md'), 'utf8')).trim()}\n${END}\n`;
  const file = join(root, 'CLAUDE.md');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const i = current.indexOf(START), j = current.indexOf(END);
  writeFileSync(file, i >= 0 && j > i ? current.slice(0, i) + block + current.slice(j + END.length).replace(/^\n/, '') : current ? `${current.trimEnd()}\n\n${block}` : block);
}

function removeRules(root) {
  for (const name of SKILLS) rmSync(join(root, '.claude', 'skills', name), { recursive: true, force: true });
  const file = join(root, 'CLAUDE.md');
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  const i = text.indexOf(START), j = text.indexOf(END);
  if (i < 0 || j < i) return;
  const rest = (text.slice(0, i) + text.slice(j + END.length)).trim();
  if (rest) writeFileSync(file, rest + '\n');
  else rmSync(file);
}

/**
 * `init --vibe-coding`: .vibe/, the skills and the CLAUDE.md block. No build kit needed — changes are modeled first and the code follows; drift
 * detection catches code changed outside that flow; a build kit is optional, for building slices from the model.
 */
export async function initVibe({ cwd = process.cwd() } = {}) {
  const parent = findVibeRoot(cwd);
  if (parent && parent !== cwd) {
    console.error(`❌ ${join(parent, DIR)} already holds this project's vibe-coding setup. There is one .vibe/ per project — it covers every module below it. Run \`claude\` anywhere under ${parent}.`);
    process.exit(1);
  }
  if (!isGit(cwd)) console.log('⚠ This is not a git repository. Vibe coding tells what changed since the last analysis from git — without it every module counts as not covered.');
  mkdirSync(paths(cwd).baseline, { recursive: true });
  installSkills(cwd);
  console.log(`✅ Vibe coding initialized: ${DIR}/, skills ${SKILLS.join(', ')} and the modeling skills they use; rules added to CLAUDE.md.`);
  console.log('\nNothing is covered by the model yet. Run `claude`, then /analyze-code-base and pick the module to start with. Each session starts with a drift sweep by itself —');
  console.log('only the modules you analyse are governed; changes anywhere else just ask first.');
}

/** `uninstall --vibe-coding` (same as `vibe remove`): .vibe/, the vibe skills and the CLAUDE.md block. Build kit, modeling skills and board stay. */
export function uninstallVibe({ cwd = process.cwd() } = {}) {
  const root = findVibeRoot(cwd);
  if (!root) { console.log('ℹ️  No .vibe/ here or above — nothing to remove.'); return; }
  removeRules(root);
  removeVibe(root);
  console.log('✅ Vibe coding removed.');
}

const out = (value, json) => console.log(json ? JSON.stringify(value, null, 2) : value);
const need = (cwd) => {
  const root = findVibeRoot(cwd);
  if (!root) { console.error('❌ No .vibe/ here or above — run `eventmodelers init --vibe-coding` first.'); process.exit(1); }
  return root;
};

function readFields(opts) {
  if (opts.json) return JSON.parse(opts.json);
  if (opts.file) return JSON.parse(readFileSync(resolve(opts.file), 'utf8'));
  if (opts.stdin) return JSON.parse(readFileSync(0, 'utf8'));
  return {};
}

export function registerVibe(program) {
  const vibe = program.command('vibe').description('Vibe coding: translate code changes into the event model before the model changes the system. Set up with `init --vibe-coding`. See extensions/vibe/README.md');

  vibe.command('check [paths...]')
    .description('Is this code covered by the model? Classifies files as governed (in a chapter analysed at depth 1+, unchanged since), drifted (changed since the last analysis), uncovered (in no analysed chapter) or free (not modeled / asked never to ask), and lists the questions to ask before changing it. No paths: every changed file in the working tree. Exit 0 always — the answer is the output.')
    .option('--json', 'Machine-readable output')
    .action((files, opts) => {
      const root = need(process.cwd());
      if (!isGit(root)) { console.error('❌ Not a git repository — vibe coding needs git to tell what changed.'); process.exit(1); }
      const result = check(root, files.length ? files.map((f) => absolute(process.cwd(), f)) : workingTreeFiles(root).map((f) => absolute(root, f)));
      if (opts.json) return out(result, true);
      for (const c of result.files) console.log(`${c.status.padEnd(9)} ${c.file}${c.chapter ? `  [${c.chapter}]` : ''}${c.reason ? `  — ${c.reason}` : ''}`);
      if (!result.files.length) console.log('Nothing changed.');
      for (const q of result.questions) console.log(`\n? ${q.kind === 'uncovered' ? `${q.folder || '(project root)'} is not covered by the model (${q.files.length} file${q.files.length === 1 ? '' : 's'})` : `${q.chapter} changed since its last analysis`} — analyse it first, continue without the model this time, or never ask for this folder?`);
    });

  const baseline = vibe.command('baseline').description('The per-chapter analysis log in .vibe/baseline/ — what `analyze-code-base` and every sync write, and the board note is rendered from');
  baseline.command('write')
    .description('Records an analysis pass: replaces the given fields (depth, folders, notModeled, decisions, runningUi — JSON from --json, --file or --stdin) and appends a history row with the commit and the changed files\' hashes as they are now.')
    .requiredOption('--chapter <title>', 'The chapter\'s title')
    .requiredOption('--pass <pass>', 'e.g. "0 — high level", "1 — flow", "diff since a1b2c3d", "sync"')
    .option('--scope <text>', 'What was analysed, e.g. the folders or files', '')
    .option('--result <text>', 'What came of it', '')
    .option('--json <json>', 'The fields as a JSON object')
    .option('--file <path>', 'The fields from a JSON file')
    .option('--stdin', 'The fields as JSON on stdin')
    .action((opts) => {
      const root = need(process.cwd());
      const fields = readFields(opts);
      const known = readBaseline(root, opts.chapter);
      const folders = fields.folders || known?.folders;
      const flat = foldersOf({ folders: folders || {} }).map((f) => f.path);
      const written = writeBaseline(root, opts.chapter, fields, { pass: opts.pass, scope: opts.scope, result: opts.result }, stateOf(root, flat));
      console.log(`✅ ${opts.chapter}: depth ${written.depth}, ${flat.length} folder${flat.length === 1 ? '' : 's'}, row ${written.history.length} at ${written.history[written.history.length - 1].commit || 'no git'}${Object.keys(written.history[written.history.length - 1].dirty).length ? '+dirty' : ''}.`);
    });
  baseline.command('advance')
    .description('The chapter was synced with the model: appends a history row at the current state, nothing else changes. Run after a code change has been translated onto the board.')
    .requiredOption('--chapter <title>', 'The chapter\'s title')
    .option('--result <text>', 'What was translated', '')
    .action((opts) => {
      const root = need(process.cwd());
      const b = readBaseline(root, opts.chapter);
      if (!b) { console.error(`❌ No baseline for "${opts.chapter}" — it was never analysed. Run /analyze-code-base for it first.`); process.exit(1); }
      const w = writeBaseline(root, opts.chapter, {}, { pass: 'sync', scope: '', result: opts.result }, stateOf(root, foldersOf(b).map((f) => f.path)));
      record(root, 'CodeSynced', { chapter: opts.chapter, note: opts.result });
      console.log(`✅ ${opts.chapter} is in step with the model again (row ${w.history.length}).`);
    });
  baseline.command('render')
    .description('Prints the markdown of the chapter\'s `Legacy Sources — <Chapter>` note, rendered from the baseline file — the body for the board\'s MARKDOWN node (`meta.description`).')
    .requiredOption('--chapter <title>', 'The chapter\'s title')
    .option('--title', 'Print only the note\'s title')
    .action((opts) => {
      const root = need(process.cwd());
      const b = readBaseline(root, opts.chapter);
      if (!b) { console.error(`❌ No baseline for "${opts.chapter}".`); process.exit(1); }
      process.stdout.write(opts.title ? `${noteTitle(b)}\n` : renderNote(b));
    });
  baseline.command('show [chapter]')
    .description('The baseline file(s) as JSON; with --drift, the files each chapter has changed since its last row')
    .option('--drift', 'Add the changed files of each chapter')
    .action((chapter, opts) => {
      const root = need(process.cwd());
      const all = chapter ? [readBaseline(root, chapter)].filter(Boolean) : listBaselines(root);
      out(all.map((b) => (opts.drift ? { ...b, drift: driftOf(root, b) } : b)), true);
    });

  vibe.command('answer')
    .description('Records the person\'s answer to a coverage question: analyse (they will run /analyze-code-base), continue (this time, without the model) or ignore (never ask about this folder again).')
    .option('--folder <path>', 'The uncovered folder the question was about')
    .option('--chapter <title>', 'The drifted chapter the question was about')
    .requiredOption('--answer <answer>', ANSWERS.join(' | '))
    .action((opts) => {
      const root = need(process.cwd());
      record(root, 'CoverageAnswered', { folder: opts.folder, chapter: opts.chapter, answer: opts.answer });
      console.log(`✅ Recorded: ${opts.answer}${opts.answer === 'ignore' ? ' — this folder is not asked about again' : ''}.`);
    });

  vibe.command('events')
    .description('The control log: coverage questions, answers and syncs')
    .option('--json', 'Machine-readable output')
    .action((opts) => {
      const root = need(process.cwd());
      const { events } = control(root);
      if (opts.json) return out(events, true);
      for (const e of events) console.log(`${e.at}  ${e.type.padEnd(18)} ${JSON.stringify(e.data)}`);
      if (!events.length) console.log('No events yet.');
    });

  vibe.command('remove')
    .description('Deletes .vibe/, the vibe skills and the CLAUDE.md block. The build kit, the modeling skills and the board are left alone.')
    .action(() => {
      need(process.cwd());
      uninstallVibe();
    });
}
