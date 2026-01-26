export function buildAgentSuggestionPrompt({ summaries = [], task = '', hints = {} } = {}) {
  const hintText = [
    hints.category ? `Preferred Category: ${hints.category}` : '',
    hints.query ? `Search Query: ${hints.query}` : '',
    hints.commandId ? `Required Command: ${hints.commandId}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `You are an intelligent router for a multi-agent system.
Your task is to select the most suitable sub-agent for the user's request.

Available Agents:
${JSON.stringify(summaries, null, 2)}

User Request: "${task}"
${hintText}

Analyze the request and available agents.
Return a JSON object with the following structure (no markdown formatting, just raw JSON):
{
  "agent_id": "The ID of the chosen agent",
  "reason": "A brief explanation of why this agent was chosen",
  "confidence": 0.0 to 1.0
}`;
}

export function resolveSuggestionModel(config, defaultModelName) {
  const fromConfig =
    (config && config.defaultModel) ||
    (config && config.models ? Object.keys(config.models)[0] : '');
  return fromConfig || defaultModelName || '';
}

export function parseAgentSuggestionResponse(text) {
  const cleanText = String(text || '').replace(/```json\n?|\n?```/g, '').trim();
  if (!cleanText) {
    throw new Error('Empty suggestion response');
  }
  const start = cleanText.indexOf('{');
  const end = cleanText.lastIndexOf('}');
  if (start >= 0 && end >= 0) {
    return JSON.parse(cleanText.substring(start, end + 1));
  }
  return JSON.parse(cleanText);
}

export async function requestAgentSuggestion({
  client,
  model,
  systemPrompt,
  ChatSession,
  generateSessionId,
  logToken,
} = {}) {
  if (!client || !model || typeof ChatSession !== 'function' || typeof generateSessionId !== 'function') {
    throw new Error('Missing suggestion dependencies');
  }
  const session = new ChatSession(systemPrompt || '', {
    sessionId: generateSessionId(`router_${Date.now()}`),
  });
  // We already put the task in the system prompt context, but adding a user message triggers the generation
  session.addUser('Please analyze the request and select the best agent in JSON format.');

  let fullText = '';
  await client.chat(model, session, {
    stream: true,
    reasoning: false,
    onToken: (token) => {
      if (typeof logToken === 'function') {
        logToken(token);
      }
      fullText += token;
    },
  });
  return parseAgentSuggestionResponse(fullText);
}
