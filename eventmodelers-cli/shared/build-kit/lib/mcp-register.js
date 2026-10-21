// Registers the eventmodelers MCP server with an external agent harness. The per-harness logic
// lives in ./harnesses/<name>.js; this module is the stable import for both loops that hand turns
// to one: the modeling loop (lib/modeling-exec.js) and the build loop (ralph-exec.js).

export { shellQuote, harnessOf, registerMcp, opencodeSupportsStandalone, setOpencodeStandaloneSupport } from './harnesses/index.js';
