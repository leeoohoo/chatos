import fs from 'fs';
import path from 'path';

export function appendEventLog(eventPath, type, payload, runId) {
  const target = typeof eventPath === 'string' ? eventPath.trim() : '';
  if (!target) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(
      target,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        type: String(type || ''),
        payload: payload && typeof payload === 'object' ? payload : payload === undefined ? undefined : { value: payload },
        runId: typeof runId === 'string' && runId.trim() ? runId.trim() : undefined,
      })}\n`,
      'utf8'
    );
  } catch {
    // ignore
  }
}
