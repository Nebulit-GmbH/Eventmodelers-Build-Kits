// One refresh for a burst of requests. Every agent on a board re-reads the slice list when someone else
// changes a slice, so an import or a bulk status change would otherwise read it once per event, per agent.
//
// request() resolves once a run that STARTED after the call has finished — a request made while a run is
// already in flight gets a fresh run of its own, because the data that run read may predate it. Requests
// within `delayMs` of each other share one run, which receives the arguments of the last request.

export function coalesce(fn, delayMs) {
  let waiters = [];
  let timer = null;
  let running = false;
  let lastArgs = [];

  const run = async () => {
    timer = null;
    running = true;
    const batch = waiters;
    waiters = [];
    try {
      await fn(...lastArgs);
      for (const w of batch) w.resolve();
    } catch (err) {
      for (const w of batch) w.reject(err);
    } finally {
      running = false;
      if (waiters.length && !timer) timer = setTimeout(run, delayMs);
    }
  };

  return (...args) => new Promise((resolve, reject) => {
    lastArgs = args;
    waiters.push({ resolve, reject });
    if (!running && !timer) timer = setTimeout(run, delayMs);
  });
}
