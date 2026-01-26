export async function runSubagentChatLoop({
  runState,
  session,
  corrections,
  maxAttempts = 40,
  reasoning,
  traceMeta,
  onAssistantStep,
  onToolCall,
  onToolResult,
  handleModelError,
} = {}) {
  if (!runState?.client) {
    throw new Error('Missing subagent client.');
  }
  if (!session) {
    throw new Error('Missing subagent session.');
  }

  let response;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      corrections?.applyCorrections?.();
      const controller = new AbortController();
      corrections?.setActiveController?.(controller);
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await runState.client.chat(runState.targetModel, session, {
          stream: true,
          reasoning,
          trace: traceMeta || undefined,
          signal: controller.signal,
          onAssistantStep,
          onToolCall,
          onToolResult,
        });
        break;
      } catch (err) {
        if (err?.name === 'AbortError' && corrections?.hasPending?.()) {
          continue;
        }
        const errorResult =
          typeof handleModelError === 'function' ? await handleModelError(err) : null;
        if (errorResult?.action === 'retry') {
          continue;
        }
        throw err;
      } finally {
        corrections?.clearActiveController?.(controller);
      }
    }
  } finally {
    corrections?.close?.();
  }

  if (response === undefined) {
    throw new Error('Sub-agent was interrupted too many times; no final response produced.');
  }

  return response;
}
