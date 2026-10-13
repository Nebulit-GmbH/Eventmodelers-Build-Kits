/*
 * Event-sourced prototype runtime — copied verbatim into every prototype by the `prototype` skill.
 * Never edit the copy: everything model-specific lives in domain.js.
 *
 * Browser: <script src="runtime.js"></script> exposes window.EMRuntime.
 * Node:    node runtime.js domain.js   — runs the domain's specs, exits 1 on any failure.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EMRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class DomainError extends Error {
    constructor(message) {
      super(message);
      this.name = 'DomainError';
    }
  }

  /** Reject a command with a business-rule message (the scenario's errorDescription). */
  function reject(message) {
    throw new DomainError(message);
  }

  const uuid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });

  // ---------------------------------------------------------------------------------------------
  // Projection — fold the log through a read model's evolve, then optionally query the state.

  function project(readModel, events, params, ctx) {
    let state = typeof readModel.initial === 'function' ? readModel.initial() : structuredCopy(readModel.initial);
    for (const e of events) state = readModel.evolve(state, e, ctx) ?? state;
    return readModel.query ? readModel.query(state, params || {}, ctx) : state;
  }

  function structuredCopy(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  // ---------------------------------------------------------------------------------------------
  // Runtime — the in-browser event store, command bus and automation runner.

  function createRuntime(Domain, opts) {
    const options = Object.assign({ automationDelay: 700, autoRun: true, storage: null }, opts);
    const storage =
      options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const KEY = 'em-prototype:' + Domain.context;

    let persisted = load();
    let events = persisted.events;
    let clockOffset = persisted.clockOffset;
    let autoRun = persisted.autoRun ?? options.autoRun;
    const automationLog = [];
    const outbox = [];
    const listeners = new Set();
    let timer = null;
    // Todo items whose command succeeded ('done'), and those still listed afterwards ('stuck').
    // A stuck item means the todo list never removes what its command records — re-issuing it
    // would append the same events every run, forever.
    const handled = new Map();

    function load() {
      try {
        const raw = storage && storage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return { events: [], clockOffset: 0 };
    }

    function save() {
      try {
        storage && storage.setItem(KEY, JSON.stringify({ events, clockOffset, autoRun }));
      } catch (_) {}
    }

    function notify() {
      save();
      listeners.forEach((fn) => fn());
    }

    const now = () => new Date(Date.now() + clockOffset);
    const ctx = () => ({ now: now(), uuid });

    function append(newEvents, metadata) {
      const stored = newEvents.map((e) => ({
        position: events.length + 1,
        id: uuid(),
        type: e.type,
        data: e.data || {},
        metadata: Object.assign({ at: now().toISOString() }, metadata),
      }));
      // Positions must stay gapless even when several events are appended at once.
      stored.forEach((e, i) => (e.position = events.length + 1 + i));
      events = events.concat(stored);
      notify();
      scheduleAutomations();
      return stored;
    }

    /** Execute a command. Never throws for a business rule — returns { ok:false, error }. */
    function execute(type, data, metadata) {
      const command = Domain.commands[type];
      if (!command) return { ok: false, error: `Command "${type}" is not part of this model` };
      try {
        const produced = command.decide(events, data || {}, ctx()) || [];
        const list = Array.isArray(produced) ? produced : [produced];
        const stored = append(list, Object.assign({ command: type }, metadata));
        return { ok: true, events: stored };
      } catch (err) {
        if (err instanceof DomainError || (err && err.name === 'DomainError')) {
          return { ok: false, error: err.message };
        }
        console.error(err);
        return { ok: false, error: 'Prototype error: ' + (err && err.message) };
      }
    }

    function query(name, params) {
      const rm = Domain.readModels[name];
      if (!rm) throw new Error(`Read model "${name}" is not part of this model`);
      return project(rm, events, params, ctx());
    }

    /** An event that originates outside this context (another context, an external system). */
    function simulate(type, data) {
      return append([{ type, data }], { simulated: true });
    }

    // --- automations -----------------------------------------------------------------------------

    function scheduleAutomations() {
      if (!autoRun || timer) return;
      timer = setTimeout(() => {
        timer = null;
        runAutomations('auto');
      }, options.automationDelay);
    }

    /**
     * Work every automation's todo list once. `trigger` = 'auto' (after events), 'manual' (button)
     * or 'clock' (time advanced). An automation with `trigger: 'schedule'` only runs on 'manual'/'clock'.
     * A todo whose command is rejected is logged and not retried until the log changes.
     */
    function runAutomations(trigger) {
      const ran = [];
      const attempted = new Set();
      for (let round = 0; round < 50; round++) {
        let progressed = false;
        for (const [name, a] of Object.entries(Domain.automations || {})) {
          if (a.trigger === 'schedule' && trigger === 'auto') continue;
          const todos = a.todo(query(a.readModel), ctx()) || [];
          for (const item of todos) {
            const key = name + ':' + JSON.stringify(item) + ':' + events.length;
            if (attempted.has(key)) continue;
            attempted.add(key);
            const plan = a.process(item, ctx());
            if (!plan) continue;
            const itemKey = name + ':' + JSON.stringify(item);
            if (handled.has(itemKey)) {
              if (handled.get(itemKey) === 'done') {
                handled.set(itemKey, 'stuck');
                const entry = {
                  at: now().toISOString(),
                  automation: name,
                  command: plan.command && plan.command.type,
                  ok: false,
                  error: `still on "${a.readModel}" after its command succeeded — the todo list never removes it, so it is not issued again`,
                };
                automationLog.unshift(entry);
                ran.push(entry);
              }
              continue;
            }
            if (plan.effect) {
              outbox.unshift({ at: now().toISOString(), automation: name, effect: plan.effect });
            }
            if (!plan.command) continue;
            const result = execute(plan.command.type, plan.command.data, { automation: name });
            const entry = {
              at: now().toISOString(),
              automation: name,
              command: plan.command.type,
              ok: result.ok,
              error: result.error,
            };
            automationLog.unshift(entry);
            ran.push(entry);
            if (result.ok) {
              handled.set(itemKey, 'done');
              progressed = true;
            }
          }
        }
        if (!progressed) break;
      }
      if (ran.length || trigger !== 'auto') notify();
      return ran;
    }

    function advanceClock(ms) {
      clockOffset += ms;
      notify();
      return runAutomations('clock');
    }

    function setAutoRun(on) {
      autoRun = !!on;
      notify();
      if (autoRun) scheduleAutomations();
    }

    function reset() {
      events = [];
      clockOffset = 0;
      automationLog.length = 0;
      outbox.length = 0;
      handled.clear();
      notify();
    }

    function importLog(log) {
      events = (log || []).map((e, i) => Object.assign({}, e, { position: i + 1 }));
      handled.clear();
      notify();
    }

    return {
      Domain,
      execute,
      query,
      simulate,
      runAutomations,
      advanceClock,
      setAutoRun,
      reset,
      importLog,
      now,
      uuid,
      get events() {
        return events;
      },
      get autoRun() {
        return autoRun;
      },
      get automationLog() {
        return automationLog;
      },
      get outbox() {
        return outbox;
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Spec runner — the board's GWT scenarios, executed against the domain. Pure, runs in node too.

  const SPEC_NOW = new Date('2026-01-01T09:00:00.000Z');

  function toEvents(given) {
    return (given || []).map((e, i) => ({
      position: i + 1,
      id: 'given-' + (i + 1),
      type: e.type,
      data: e.data || {},
      metadata: { at: (e.at || SPEC_NOW.toISOString()) },
    }));
  }

  /** Expected values only constrain what they name; ids/timestamps the domain generates are left out of specs. */
  function matches(expected, actual) {
    if (expected === undefined) return true;
    if (expected === null) return actual === null || actual === undefined;
    if (Array.isArray(expected)) {
      return (
        Array.isArray(actual) &&
        expected.length === actual.length &&
        expected.every((e, i) => matches(e, actual[i]))
      );
    }
    if (typeof expected === 'object') {
      return (
        actual != null &&
        typeof actual === 'object' &&
        Object.keys(expected).every((k) => matches(expected[k], actual[k]))
      );
    }
    return String(expected) === String(actual);
  }

  function runSpec(Domain, spec) {
    const ctx = { now: new Date((spec.now && Date.parse(spec.now)) || SPEC_NOW), uuid };
    const history = toEvents(spec.given);
    try {
      if (spec.kind === 'command') {
        const command = Domain.commands[spec.when.type];
        if (!command) return { pass: false, detail: `unknown command ${spec.when.type}` };
        let produced;
        try {
          produced = command.decide(history, spec.when.data || {}, ctx) || [];
          produced = Array.isArray(produced) ? produced : [produced];
        } catch (err) {
          if (err && err.name === 'DomainError') {
            if (spec.error !== undefined) return { pass: true, detail: `rejected: ${err.message}` };
            return { pass: false, detail: `unexpectedly rejected: ${err.message}` };
          }
          throw err;
        }
        if (spec.error !== undefined) {
          return { pass: false, detail: `expected rejection "${spec.error}", got ${produced.map((e) => e.type).join(', ') || 'no events'}` };
        }
        const ok = matches(
          spec.then.map((e) => ({ type: e.type, data: e.data || {} })),
          produced.map((e) => ({ type: e.type, data: e.data || {} })),
        );
        return {
          pass: ok,
          detail: ok ? 'ok' : `expected ${JSON.stringify(spec.then)}, got ${JSON.stringify(produced)}`,
        };
      }
      if (spec.kind === 'readmodel') {
        const rm = Domain.readModels[spec.readModel];
        if (!rm) return { pass: false, detail: `unknown read model ${spec.readModel}` };
        const actual = project(rm, history, spec.params, ctx);
        const ok = matches(spec.expect, actual);
        return { pass: ok, detail: ok ? 'ok' : `expected ${JSON.stringify(spec.expect)}, got ${JSON.stringify(actual)}` };
      }
      if (spec.kind === 'automation') {
        const a = Domain.automations[spec.automation];
        if (!a) return { pass: false, detail: `unknown automation ${spec.automation}` };
        const todos = a.todo(project(Domain.readModels[a.readModel], history, {}, ctx), ctx) || [];
        const commands = todos.map((t) => a.process(t, ctx)).filter((p) => p && p.command).map((p) => p.command);
        const ok = matches(spec.expectCommands, commands);
        return { pass: ok, detail: ok ? 'ok' : `expected ${JSON.stringify(spec.expectCommands)}, got ${JSON.stringify(commands)}` };
      }
      return { pass: false, detail: `unknown spec kind ${spec.kind}` };
    } catch (err) {
      return { pass: false, detail: 'crashed: ' + (err && err.stack ? err.stack.split('\n')[0] : err) };
    }
  }

  function runSpecs(Domain) {
    return (Domain.specs || []).map((spec) => Object.assign({ spec }, runSpec(Domain, spec)));
  }

  const api = { DomainError, reject, createRuntime, project, runSpecs, matches, uuid };

  // node runtime.js domain.js
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const path = require('path');
    module.exports = api;
    const Domain = require(path.resolve(process.argv[2] || 'domain.js'));
    const results = runSpecs(Domain);
    let failed = 0;
    for (const r of results) {
      if (!r.pass) failed++;
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.spec.slice || '-'}] ${r.spec.title}${r.pass ? '' : '\n      ' + r.detail}`);
    }
    console.log(`\n${results.length - failed}/${results.length} specs pass`);
    process.exit(failed ? 1 : 0);
  }

  return api;
});
