import { isContextLengthError as defaultIsContextLengthError } from './error-utils.js';

function ensureAbortCheck(throwIfAborted, signal) {
  if (typeof throwIfAborted === 'function') {
    return () => throwIfAborted(signal);
  }
  if (!signal) {
    return () => {};
  }
  return () => {
    if (signal.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
  };
}

export async function runWithContextLengthRecovery({
  run,
  summarize,
  hardTrim,
  isContextLengthError,
  throwIfAborted,
  signal,
  onContextError,
  retryIfSummarizeFailed = true,
} = {}) {
  if (typeof run !== 'function') {
    throw new Error('run is required');
  }
  const checkAbort = ensureAbortCheck(throwIfAborted, signal);
  const isContextError =
    typeof isContextLengthError === 'function' ? isContextLengthError : defaultIsContextLengthError;

  try {
    return await run();
  } catch (err) {
    if (!isContextError(err)) {
      throw err;
    }
    if (typeof onContextError === 'function') {
      onContextError(err);
    }
    checkAbort();

    let summarized = false;
    let summaryError = null;
    if (typeof summarize === 'function') {
      try {
        summarized = await summarize();
      } catch (errSummary) {
        summaryError = errSummary;
        summarized = false;
      }
    }

    checkAbort();

    if (!summarized && !retryIfSummarizeFailed && typeof hardTrim === 'function') {
      await hardTrim({ reason: 'summary_failed', summaryError, error: err });
      checkAbort();
      return await run();
    }

    try {
      return await run();
    } catch (err2) {
      if (!isContextError(err2)) {
        throw err2;
      }
      checkAbort();
      if (typeof hardTrim === 'function') {
        await hardTrim({ reason: 'summary_exceeded', summaryError, error: err2 });
      }
      checkAbort();
      return await run();
    }
  }
}
