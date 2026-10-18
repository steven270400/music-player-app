let transitionUntil = 0;
export function markVisualTransition(duration: number) { transitionUntil = Math.max(transitionUntil, Date.now() + duration); }

/** One cancellable automatic task, deferred by visible transitions for at most 500 ms. */
export function afterVisualTransition(work: () => void) {
  const deadline = Date.now() + 500;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  function check() {
    if (cancelled) return;
    const delay = Math.min(deadline - Date.now(), transitionUntil - Date.now());
    if (delay > 0) timer = setTimeout(check, delay);
    else work();
  }
  timer = setTimeout(check, 16);
  return () => { cancelled = true; clearTimeout(timer); };
}
