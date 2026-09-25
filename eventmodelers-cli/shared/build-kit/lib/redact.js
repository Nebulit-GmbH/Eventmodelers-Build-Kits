// Keeps secrets out of the loop's own log lines. Anything this process prints can end up in a
// terminal scrollback, a CI log or a `docker logs` dump: an error body that echoes a header,
// a verbose tool input with a curl command in it, a debug line with a config object. So
// rather than trusting every call site, console output is masked on the way out:
//   - the platform API token, by value (it's a plain uuid, so there's no pattern for it)
//   - anything JWT-shaped (eyJ….….…) — the realtime token and Supabase keys look like that
//
// Output a child process writes straight to the terminal (stdio: 'inherit') never passes
// through console here, so it isn't covered.

import { format } from 'util';

const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// A secret shorter than this would mask ordinary text (an empty or placeholder value most of all).
const MIN_SECRET_LENGTH = 8;

export function redactString(text, secrets = []) {
  let out = String(text).replace(JWT, '***');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH) out = out.replaceAll(secret, '***');
  }
  return out;
}

// Routes console.log/info/warn/error/debug through redactString. Arguments are formatted the
// way console would format them first, so an Error or an object is masked too. Returns a
// function that puts the originals back.
export function redactConsole(secrets) {
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = Object.fromEntries(methods.map((m) => [m, console[m]]));
  for (const m of methods) {
    console[m] = (...args) => originals[m].call(console, redactString(format(...args), secrets));
  }
  return () => { for (const m of methods) console[m] = originals[m]; };
}
