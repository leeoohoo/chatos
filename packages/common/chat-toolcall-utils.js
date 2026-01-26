function defaultNormalizeId(value) {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function defaultGenerateId() {
  return `call_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function stripToolCalls(message, toolCallsKey) {
  if (!message || typeof message !== 'object') return message;
  const calls = message[toolCallsKey];
  if (!Array.isArray(calls) || calls.length === 0) return message;
  const next = { ...message };
  next[toolCallsKey] = [];
  return next;
}

export function normalizeToolCallMessages(messages, options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const toolCallsKey = typeof options.toolCallsKey === 'string' && options.toolCallsKey
    ? options.toolCallsKey
    : 'tool_calls';
  const toolCallIdKey = typeof options.toolCallIdKey === 'string' && options.toolCallIdKey
    ? options.toolCallIdKey
    : 'tool_call_id';
  const normalizeId = typeof options.normalizeId === 'function' ? options.normalizeId : defaultNormalizeId;
  const generateId = typeof options.generateId === 'function' ? options.generateId : defaultGenerateId;
  const assignMissingToolCallId = options.assignMissingToolCallId === true;
  const ensureUniqueToolCallIds = options.ensureUniqueToolCallIds === true;
  const stripEmptyToolCalls = options.stripEmptyToolCalls === true;
  const pendingMode = options.pendingMode === 'strip' ? 'strip' : 'drop';

  const normalized = [];
  let changed = false;
  let pending = null;

  const resolveId = (value) => {
    try {
      return normalizeId(value);
    } catch {
      return defaultNormalizeId(value);
    }
  };

  const createId = () => {
    const candidate = generateId();
    const id = resolveId(candidate);
    return id || defaultGenerateId();
  };

  const clearPending = () => {
    if (!pending) return;
    if (pendingMode === 'strip') {
      const idx = pending.assistantIndex;
      if (idx >= 0 && idx < normalized.length) {
        const stripped = stripToolCalls(normalized[idx], toolCallsKey);
        if (stripped !== normalized[idx]) {
          normalized[idx] = stripped;
          changed = true;
        }
      }
    } else {
      normalized.length = pending.startIndex;
      changed = true;
    }
    pending = null;
  };

  list.forEach((message) => {
    if (!message || typeof message !== 'object') {
      changed = true;
      return;
    }

    const role = message.role;

    if (role !== 'tool') {
      clearPending();
    }

    if (role === 'assistant') {
      const rawCalls = Array.isArray(message[toolCallsKey]) ? message[toolCallsKey].filter(Boolean) : [];
      let calls = rawCalls;
      let expectedIds = [];
      let expectedSet = null;

      if (rawCalls.length > 0) {
        if (assignMissingToolCallId || ensureUniqueToolCallIds) {
          calls = [];
          expectedIds = [];
          expectedSet = new Set();
          rawCalls.forEach((call) => {
            if (!call || typeof call !== 'object') {
              changed = true;
              return;
            }
            let id = resolveId(call.id);
            if (!id && assignMissingToolCallId) {
              id = createId();
              changed = true;
            }
            if (!id) {
              changed = true;
              return;
            }
            if (ensureUniqueToolCallIds) {
              while (expectedSet.has(id)) {
                id = createId();
                changed = true;
              }
            }
            const nextCall = id === call.id ? call : { ...call, id };
            if (nextCall !== call) {
              changed = true;
            }
            calls.push(nextCall);
            if (!expectedSet.has(id)) {
              expectedSet.add(id);
              expectedIds.push(id);
            }
          });
        } else {
          expectedSet = new Set();
          expectedIds = [];
          rawCalls.forEach((call) => {
            const id = resolveId(call?.id);
            if (!id || expectedSet.has(id)) return;
            expectedSet.add(id);
            expectedIds.push(id);
          });
        }
      }

      const startIndex = normalized.length;
      let assistantMessage = message;
      if (calls !== rawCalls || (stripEmptyToolCalls && rawCalls.length > 0 && calls.length === 0)) {
        assistantMessage = { ...message };
        if (calls !== rawCalls) {
          assistantMessage[toolCallsKey] = calls;
        } else if (stripEmptyToolCalls) {
          delete assistantMessage[toolCallsKey];
        }
        changed = true;
      }
      normalized.push(assistantMessage);
      if (expectedIds.length > 0) {
        pending = {
          startIndex,
          assistantIndex: startIndex,
          expectedIds,
          expectedSet,
          seen: new Set(),
          nextUnassignedIndex: 0,
        };
      }
      return;
    }

    if (role === 'tool') {
      if (!pending || !pending.expectedSet) {
        changed = true;
        return;
      }
      let toolCallId = resolveId(message[toolCallIdKey]);
      if (!toolCallId) {
        if (!assignMissingToolCallId) {
          changed = true;
          return;
        }
        while (
          pending.nextUnassignedIndex < pending.expectedIds.length &&
          pending.seen.has(pending.expectedIds[pending.nextUnassignedIndex])
        ) {
          pending.nextUnassignedIndex += 1;
        }
        if (pending.nextUnassignedIndex >= pending.expectedIds.length) {
          changed = true;
          return;
        }
        toolCallId = pending.expectedIds[pending.nextUnassignedIndex];
        pending.nextUnassignedIndex += 1;
        changed = true;
      }
      if (!pending.expectedSet.has(toolCallId)) {
        changed = true;
        return;
      }
      const toolMessage = toolCallId === message[toolCallIdKey]
        ? message
        : { ...message, [toolCallIdKey]: toolCallId };
      if (toolMessage !== message) {
        changed = true;
      }
      normalized.push(toolMessage);
      pending.seen.add(toolCallId);
      if (pending.seen.size >= pending.expectedSet.size) {
        pending = null;
      }
      return;
    }

    normalized.push(message);
  });

  if (pending) {
    clearPending();
  }

  return { messages: normalized, changed };
}
