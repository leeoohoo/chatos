import { createRunInboxListener as createRunInboxListenerCore } from '../../shared/run-inbox.js';

export function createRunInboxListener(options = {}) {
  const nameText =
    typeof options?.serverName === 'string' && options.serverName.trim() ? options.serverName.trim() : 'subagent_router';
  return createRunInboxListenerCore({ ...options, serverName: nameText });
}
