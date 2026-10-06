// The modeling agent's Bash allowlist. Claude runs it with --permission-mode dontAsk (anything not allowed is refused,
// nobody is asked), and every Bash call goes through this check first (lib/bash-guard-hook.js, a PreToolUse hook).
// The agent takes chat messages and snippet clicks from any collaborator on the board, so a command is allowed only
// when every part of it is understood and on the list — anything else is refused, including what this parser can't
// read. It is deliberately narrow: the agent's real work goes through the eventmodelers MCP tools; Bash is for the
// curl fallback to the platform and a few read-only helpers.
//
// Rules:
// - Programs: curl (only to the platform's baseUrl), python3 (two exact forms), uuidgen, jq, git (read-only
//   subcommands), and read-only text tools (cat, head, tail, wc, sort, uniq, grep, cut, tr, ls), echo, printf,
//   mkdir, sleep, date, true. Nothing else — no sh/bash/eval/env/xargs/find/sed/awk/node/npm/rm/mv/cp.
// - No command substitution ($(…), `…`, $((…)), <(…)), subshells, brace groups, brace expansion, background jobs,
//   control flow, or ~ paths.
// - Variables: only BASE_URL, ORG_ID, BOARD_ID, AGENT_ID, CHAT_SESSION_ID, EVENTMODELERS_AGENT_ID, CLAUDE_CODE_SESSION_ID and names assigned in
//   the same command. The token ($EVENTMODELERS_TOKEN / $TOKEN) only inside a curl -H value — never echoed, written or
//   passed elsewhere. Assigning BASE_URL is fine only to the real baseUrl; PATH, proxies, LD_*/DYLD_*/GIT_* … never.
// - Files read, written or uploaded (redirections, curl @file / -o, jq / cat / … arguments) must lie in one of the
//   allowed roots: the kit directory, the code directory, and the temp directories.

import { isAbsolute, resolve, sep } from 'path';

const SAFE_VARS = new Set(['BASE_URL', 'ORG_ID', 'BOARD_ID', 'AGENT_ID', 'CHAT_SESSION_ID', 'EVENTMODELERS_AGENT_ID', 'CLAUDE_CODE_SESSION_ID']);
const TOKEN_VARS = new Set(['TOKEN', 'EVENTMODELERS_TOKEN']);
const PROTECTED_VAR = /^(PATH|HOME|IFS|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|PS4|PROMPT_COMMAND|CDPATH|GLOBIGNORE|TMPDIR|SHELL|USER|LD_.*|DYLD_.*|GIT_.*|CURL.*|SSL_.*|NODE_.*|PYTHON.*|.*PROXY.*|EVENTMODELERS_.*|ANTHROPIC_.*|CLAUDE.*)$/i;

class Refused extends Error {}
const refuse = (reason) => { throw new Refused(reason); };

// ─── Lexer ──────────────────────────────────────────────────────────────────────────────────────
// Words keep their unquoted text, with every expansion recorded as {name} (a parameter) — `$X` is left in the text
// as `$X` so a URL or path check sees it. Anything that would run code during expansion is refused right here.

function lex(command) {
  const tokens = [];
  const heredocs = []; // pending, consumed at the next newline
  let i = 0;
  const n = command.length;

  const readVar = (word) => {
    // at command[i] === '$'
    const next = command[i + 1];
    if (next === '(') refuse('command substitution $(…) is not allowed');
    if (next === '{') {
      const end = command.indexOf('}', i + 2);
      const name = end < 0 ? '' : command.slice(i + 2, end);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) refuse('only plain ${NAME} expansions are allowed');
      word.refs.push(name); word.text += `$${name}`; i = end + 1; return;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(command.slice(i + 1));
    if (!m) {
      if (next === undefined || /[\s"'|&;<>)]/.test(next)) { word.text += '$'; i += 1; return; } // a lone $
      refuse(`$${next} is not allowed`);
    }
    word.refs.push(m[0]); word.text += `$${m[0]}`; i += 1 + m[0].length;
  };

  const readWord = () => {
    const word = { type: 'word', text: '', refs: [], quoted: false, braceOrTilde: false };
    if (command[i] === '~') word.braceOrTilde = true;
    while (i < n) {
      const c = command[i];
      if (/\s/.test(c) || '|&;<>()'.includes(c)) break;
      if (c === '`') refuse('backticks are not allowed');
      if (c === '{' || c === '}') word.braceOrTilde = true;
      if (c === "'") {
        const end = command.indexOf("'", i + 1);
        if (end < 0) refuse('unterminated quote');
        word.text += command.slice(i + 1, end); word.quoted = true; i = end + 1;
      } else if (c === '"') {
        word.quoted = true; i += 1;
        while (i < n && command[i] !== '"') {
          const d = command[i];
          if (d === '`') refuse('backticks are not allowed');
          if (d === '$') { readVar(word); continue; }
          if (d === '\\' && i + 1 < n && '$`"\\\n'.includes(command[i + 1])) { word.text += command[i + 1]; i += 2; continue; }
          word.text += d; i += 1;
        }
        if (i >= n) refuse('unterminated quote');
        i += 1;
      } else if (c === '$') {
        readVar(word);
      } else if (c === '\\') {
        if (i + 1 < n && command[i + 1] !== '\n') word.text += command[i + 1];
        i += 2;
      } else {
        word.text += c; i += 1;
      }
    }
    return word;
  };

  const consumeHeredocs = () => {
    for (const h of heredocs.splice(0)) {
      const lines = [];
      for (;;) {
        if (i >= n) refuse(`heredoc ${h.delim} is never closed`);
        const end = command.indexOf('\n', i);
        const line = command.slice(i, end < 0 ? n : end);
        i = end < 0 ? n : end + 1;
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        lines.push(line);
      }
      const body = lines.join('\n');
      if (!h.quoted) {
        if (body.includes('`') || body.includes('$(')) refuse('command substitution in a heredoc is not allowed');
        for (const m of body.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) h.token.refs.push(m[1]);
      }
    }
  };

  while (i < n) {
    const c = command[i];
    if (c === '\n') { tokens.push({ type: 'op', op: ';' }); i += 1; consumeHeredocs(); continue; }
    if (/\s/.test(c)) { i += 1; continue; }
    if (command.startsWith('\\\n', i)) { i += 2; continue; } // line continuation
    if (c === '#') { while (i < n && command[i] !== '\n') i += 1; continue; }
    if (c === '(' || c === ')') refuse('subshells are not allowed');
    if (command.startsWith('&&', i) || command.startsWith('||', i)) { tokens.push({ type: 'op', op: command.slice(i, i + 2) }); i += 2; continue; }
    if (command.startsWith('&>', i)) refuse('&> is not allowed — redirect stdout and stderr separately');
    if (c === '&') refuse('background jobs (&) are not allowed');
    if (c === '|' || c === ';') { tokens.push({ type: 'op', op: c }); i += 1; continue; }
    // Redirections, optionally with a file descriptor in front: 2>, 2>>, 2>&1, >&2, <, <<, <<-, <<<
    const redir = /^(\d?)(<<<|<<-|<<|>>|>&|>\||<&|<>|>|<)/.exec(command.slice(i));
    if (redir) {
      const op = redir[2];
      i += redir[0].length;
      if (op === '<>' || op === '<&') refuse(`${op} is not allowed`);
      while (i < n && (command[i] === ' ' || command[i] === '\t')) i += 1;
      if (op === '>&') {
        const fd = /^\d+/.exec(command.slice(i));
        if (!fd) refuse('only >&N (to a file descriptor) is allowed');
        i += fd[0].length;
        continue;
      }
      if (op === '<<' || op === '<<-') {
        const target = readWord();
        if (!target.text) refuse('heredoc without a delimiter');
        const token = { type: 'heredoc', refs: [] };
        tokens.push(token);
        heredocs.push({ delim: target.text, quoted: target.quoted, strip: op === '<<-', token });
        continue;
      }
      const target = readWord();
      if (!target.text && !target.refs.length) refuse(`${op} without a target`);
      tokens.push({ type: 'redirect', op: op === '>|' ? '>' : op, target });
      continue;
    }
    const word = readWord();
    if (!word.text && !word.quoted && !word.refs.length) refuse(`cannot read the command near "${command.slice(i, i + 20)}"`);
    tokens.push(word);
  }
  if (heredocs.length) refuse('heredoc is never closed');
  return tokens;
}

// ─── Commands ───────────────────────────────────────────────────────────────────────────────────

/** Splits the tokens into simple commands: leading assignments, words, redirections, heredocs. */
function simpleCommands(tokens) {
  const commands = [];
  let current = null;
  for (const t of tokens) {
    if (t.type === 'op') { current = null; continue; }
    if (!current) { current = { assignments: [], words: [], redirects: [], heredocs: [] }; commands.push(current); }
    if (t.type === 'redirect') current.redirects.push(t);
    else if (t.type === 'heredoc') current.heredocs.push(t);
    else if (!current.words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t.text) && !t.text.startsWith('=')) {
      const eq = t.text.indexOf('=');
      current.assignments.push({ name: t.text.slice(0, eq), value: t.text.slice(eq + 1), word: t });
    } else current.words.push(t);
  }
  return commands;
}

function withinRoots(path, policy) {
  if (path === '/dev/null' || path === '-') return true;
  if (path.includes('$')) refuse(`path "${path}" may not contain a variable`);
  if (path.includes('~')) refuse(`path "${path}" may not contain ~ — spell it out`);
  const full = isAbsolute(path) ? resolve(path) : resolve(policy.cwd, path);
  return policy.roots.some((root) => full === root || full.startsWith(root.endsWith(sep) ? root : root + sep));
}

function checkPath(path, what, policy) {
  if (!withinRoots(path, policy)) refuse(`${what} "${path}" is outside the kit, code and temp directories`);
}

function checkUrl(word, policy) {
  const base = policy.baseUrl.replace(/\/+$/, '');
  const url = word.text.replace(/^\$BASE_URL(?=\/|$)/, base);
  if (url !== base && !url.startsWith(`${base}/`) && !url.startsWith(`${base}?`)) {
    refuse(`curl may only call ${base} — not "${word.text}"`);
  }
}

// curl options: those taking a value, and how a value names a local file.
const CURL_FLAGS = new Set(['s', 'S', 'f', 'i', 'L', 'G', 'N', 'I', 'g', 'q']);
const CURL_LONG_FLAGS = new Set(['--silent', '--show-error', '--fail', '--fail-with-body', '--include', '--location', '--get',
  '--compressed', '--no-buffer', '--head', '--globoff', '--http1.1', '--http2', '--no-progress-meter']);
const CURL_SHORT_VALUE = { H: 'header', X: 'plain', d: 'data', F: 'form', w: 'writeout', o: 'output', D: 'output', m: 'plain', A: 'plain', e: 'plain', T: 'upload' };
const CURL_LONG_VALUE = {
  '--header': 'header', '--request': 'plain', '--data': 'data', '--data-ascii': 'data', '--data-binary': 'data', '--json': 'data',
  '--data-raw': 'plain', '--data-urlencode': 'urlencode', '--form': 'form', '--form-string': 'plain', '--write-out': 'writeout',
  '--output': 'output', '--dump-header': 'output', '--max-time': 'plain', '--connect-timeout': 'plain', '--retry': 'plain',
  '--retry-delay': 'plain', '--retry-max-time': 'plain', '--user-agent': 'plain', '--referer': 'plain', '--url': 'url',
  '--upload-file': 'upload', '--max-filesize': 'plain',
};

function curlValue(kind, word, policy) {
  const v = word.text;
  if (kind === 'header') {
    if (v.startsWith('@')) checkPath(v.slice(1), 'curl header file', policy);
    word.tokenAllowed = true; // the one place the token may be expanded
  } else if (kind === 'data' && v.startsWith('@')) checkPath(v.slice(1), 'curl upload', policy);
  else if (kind === 'urlencode' && v.includes('@')) checkPath(v.slice(v.indexOf('@') + 1), 'curl upload', policy);
  else if (kind === 'form') {
    const m = /=([@<])([^;]*)/.exec(v);
    if (m) checkPath(m[2], 'curl upload', policy);
  } else if (kind === 'writeout' && v.startsWith('@')) checkPath(v.slice(1), 'curl write-out file', policy);
  else if (kind === 'output' || kind === 'upload') checkPath(v, `curl ${kind} file`, policy);
  else if (kind === 'url') checkUrl(word, policy);
}

function checkCurl(args, policy) {
  let urls = 0;
  for (let k = 0; k < args.length; k++) {
    const w = args[k];
    const a = w.text;
    if (a === '--') { for (const u of args.slice(k + 1)) { checkUrl(u, policy); urls++; } break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a : a.slice(0, eq);
      if (CURL_LONG_FLAGS.has(name) && eq < 0) continue;
      const kind = CURL_LONG_VALUE[name];
      if (!kind) refuse(`curl option ${name} is not allowed`);
      let valueWord;
      if (eq >= 0) valueWord = { ...w, text: a.slice(eq + 1) };
      else { valueWord = args[++k]; if (!valueWord) refuse(`curl ${name} needs a value`); }
      curlValue(kind, valueWord, policy);
      if (kind === 'header') w.tokenAllowed = true; // --header=… is a copy of w
      if (kind === 'url') urls++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let p = 1; p < a.length; p++) {
        const f = a[p];
        if (CURL_FLAGS.has(f)) continue;
        const kind = CURL_SHORT_VALUE[f];
        if (!kind) refuse(`curl option -${f} is not allowed`);
        let valueWord;
        if (p + 1 < a.length) valueWord = { ...w, text: a.slice(p + 1) };
        else { valueWord = args[++k]; if (!valueWord) refuse(`curl -${f} needs a value`); }
        curlValue(kind, valueWord, policy);
        if (kind === 'header') w.tokenAllowed = true; // -H… attached is a copy of w
        break;
      }
      continue;
    }
    checkUrl(w, policy);
    urls++;
  }
  if (!urls) refuse('curl needs a URL on the platform');
}

const GIT_READ = new Set(['status', 'show', 'log', 'diff', 'ls-tree', 'ls-files', 'rev-parse', 'cat-file', 'blame', 'branch', 'fetch', 'grep']);

function checkGit(args, policy) {
  let k = 0;
  while (k < args.length && args[k].text.startsWith('-')) {
    const a = args[k].text;
    if (a === '-C') { const dir = args[k + 1]; if (!dir) refuse('git -C needs a directory'); checkPath(dir.text, 'git -C directory', policy); k += 2; continue; }
    if (a === '--no-pager') { k += 1; continue; }
    refuse(`git option ${a} is not allowed`);
  }
  const sub = args[k]?.text;
  if (!GIT_READ.has(sub)) refuse(`git ${sub ?? ''} is not allowed — only read-only subcommands (${[...GIT_READ].join(', ')})`);
  const rest = args.slice(k + 1).map((w) => w.text);
  for (const a of rest) {
    if (/^--(output|ext-diff|textconv|upload-pack|exec|open-files-in-pager|config)/.test(a)) refuse(`git ${a} is not allowed`);
  }
  if (sub === 'branch' && rest.some((a) => !['-a', '-r', '--list', '--show-current', '-v', '-vv', '--all', '--remotes'].includes(a))) {
    refuse('git branch may only list branches');
  }
  if (sub === 'fetch' && (rest[0] !== 'origin' || rest.slice(1).some((a) => a.startsWith('-')))) {
    refuse('git fetch may only fetch from origin');
  }
}

// Agents like python3 for uuids: `import uuid; print(uuid.uuid4())`, a loop of them, a joined list. Python can't be
// allowed in general — a script does anything — so a -c program passes only when it is built from these names alone,
// plus numbers, punctuation and short separator strings. With nothing else nameable, it can't reach os, open, eval,
// __class__ or any module but uuid (e.g. uuid.os.system is refused: "os" and "system" aren't on the list).
const PY_UUID_NAMES = new Set(['import', 'uuid', 'uuid4', 'print', 'str', 'for', 'in', 'range', 'join', 'hex', 'upper', 'lower', '_', 'i', 'n', 'x']);

function isUuidProgram(code) {
  if (!/\buuid4\b/.test(code) || code.length > 300) return false;
  // Strings: only quotes around whitespace, commas, dashes, semicolons or \n — no f-strings or other prefixes.
  const withoutStrings = code.replace(/(?<![A-Za-z0-9_])(['"])(?:\\n|[ ,;\-\t])*\1/g, ' ');
  if (/['"\\`@$]/.test(withoutStrings)) return false;
  for (const name of withoutStrings.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) if (!PY_UUID_NAMES.has(name)) return false;
  // Whatever is left: numbers, whitespace and plain punctuation.
  return /^[A-Za-z0-9_\s().,;:\[\]+*-]*$/.test(withoutStrings);
}

function checkPython(args, policy) {
  const a = args.map((w) => w.text);
  if (a.length === 2 && a[0] === '-c' && isUuidProgram(a[1])) return;
  if (a[0] === '-m' && a[1] === 'json.tool' && a.length <= 3) {
    if (a.length === 3) checkPath(a[2], 'json.tool input', policy);
    return;
  }
  refuse('python3 may only generate uuids (-c with import uuid / uuid.uuid4() — or use uuidgen) or run "-m json.tool"; build a payload with the Write tool and parse JSON with jq');
}

function checkJq(args, policy) {
  let filter = null;
  for (let k = 0; k < args.length; k++) {
    const a = args[k].text;
    if (/^-[rcesnSjMC]+$/.test(a) || ['--raw-output', '--compact-output', '--slurp', '--null-input', '--tab', '--sort-keys', '--exit-status', '--join-output'].includes(a)) continue;
    if (a === '--arg' || a === '--argjson') { k += 2; continue; }
    if (a === '--indent') { k += 1; continue; }
    if (a === '--rawfile' || a === '--slurpfile') { checkPath(args[k + 2]?.text ?? '', `jq ${a}`, policy); k += 2; continue; }
    if (a === '-f' || a === '--from-file') { checkPath(args[k + 1]?.text ?? '', 'jq filter file', policy); filter = ''; k += 1; continue; }
    if (a.startsWith('-')) refuse(`jq option ${a} is not allowed`);
    if (filter === null) {
      filter = a;
      if (/\$ENV|\benv\b|\binput_filename\b|\$__loc__/.test(a)) refuse('jq may not read the environment');
    } else checkPath(a, 'jq input', policy);
  }
}

// Read-only text tools: every non-option argument is a file in the roots — except grep's pattern.
const TEXT_TOOLS = new Set(['cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'grep', 'cut', 'tr', 'ls']);
const VALUE_OPTS = { head: ['-n', '-c'], tail: ['-n', '-c'], cut: ['-d', '-f', '-c', '-b'], sort: ['-k', '-t'], grep: ['-e', '-m', '-A', '-B', '-C'], uniq: ['-f', '-s'] };

function checkTextTool(prog, args, policy) {
  if (prog === 'sort' && args.some((w) => /^(-o|--output)/.test(w.text))) refuse('sort -o is not allowed');
  if (prog === 'grep' && args.some((w) => /^(-f|--file)/.test(w.text))) refuse('grep -f is not allowed');
  let patternPending = prog === 'grep' && !args.some((w) => w.text === '-e');
  for (let k = 0; k < args.length; k++) {
    const a = args[k].text;
    if (a.startsWith('-') && a !== '-') {
      if ((VALUE_OPTS[prog] ?? []).includes(a)) k += 1;
      continue;
    }
    if (prog === 'tr') continue; // tr takes character sets, never files
    if (patternPending) { patternPending = false; continue; }
    checkPath(a, `${prog} file`, policy);
  }
}

function checkProgram(cmd, policy) {
  const [progWord, ...args] = cmd.words;
  const prog = progWord.text;
  if (progWord.refs.length || prog.includes('/')) refuse(`run programs by plain name — "${prog}"`);
  switch (prog) {
    case 'curl': return checkCurl(args, policy);
    case 'git': return checkGit(args, policy);
    case 'python3': return checkPython(args, policy);
    case 'jq': return checkJq(args, policy);
    case 'mkdir': for (const a of args) if (!a.text.startsWith('-')) checkPath(a.text, 'mkdir directory', policy); return;
    case 'uuidgen': case 'echo': case 'printf': case 'sleep': case 'date': case 'true': return;
    default:
      if (TEXT_TOOLS.has(prog)) return checkTextTool(prog, args, policy);
      refuse(`"${prog}" is not on the agent's command allowlist`);
  }
}

/**
 * `{ok: true}` when every part of `command` is allowed, else `{ok: false, reason}`.
 * policy: { baseUrl, cwd, roots: absolute directories files may be read from / written to }.
 */
export function checkBashCommand(command, policy) {
  try {
    if (typeof command !== 'string' || !command.trim()) refuse('empty command');
    const commands = simpleCommands(lex(command));
    const assigned = new Set();
    for (const cmd of commands) {
      for (const a of cmd.assignments) {
        if (PROTECTED_VAR.test(a.name) || TOKEN_VARS.has(a.name)) refuse(`setting ${a.name} is not allowed`);
        if (a.name === 'BASE_URL' && a.value.replace(/\/+$/, '') !== policy.baseUrl.replace(/\/+$/, '')) refuse(`BASE_URL may only be ${policy.baseUrl}`);
        assigned.add(a.name);
      }
    }
    for (const cmd of commands) {
      if (cmd.words.length) checkProgram(cmd, policy); // marks curl header words that may expand the token
      for (const r of cmd.redirects) {
        if (r.op !== '<<<') checkPath(r.target.text, r.op === '<' ? 'input file' : 'output file', policy);
      }
      const parts = [...cmd.words, ...cmd.assignments.map((a) => a.word), ...cmd.redirects.map((r) => r.target), ...cmd.heredocs];
      for (const w of parts) {
        if (w.braceOrTilde && w.type === 'word') refuse(`"${w.text}": brace expansion and ~ are not allowed — quote it or spell the path out`);
        for (const name of w.refs) {
          if (TOKEN_VARS.has(name)) { if (!w.tokenAllowed) refuse(`$${name} may only be used in a curl -H header`); continue; }
          if (!SAFE_VARS.has(name) && !assigned.has(name)) refuse(`$${name} is not allowed — only ${[...SAFE_VARS].join(', ')} and names set in the same command`);
        }
      }
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, reason: err.message };
    return { ok: false, reason: `the command could not be checked: ${err.message}` };
  }
}
