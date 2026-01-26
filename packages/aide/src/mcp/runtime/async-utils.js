export function sleepWithSignal(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function createAbortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
