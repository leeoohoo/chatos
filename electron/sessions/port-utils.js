function normalizePort(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const port = Math.trunc(num);
  if (port <= 0 || port > 65535) return null;
  return port;
}

export function appendPort(list, value) {
  const port = normalizePort(value);
  if (!port) return;
  if (!list.includes(port)) {
    list.push(port);
  }
}

export function extractPortsFromText(text) {
  const ports = [];
  const source = String(text || '');
  if (!source) return ports;

  const patterns = [
    /https?:\/\/(?:\[[^\]]+\]|[^\s/:]+):(\d{2,5})/gi,
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\s+)(\d{2,5})\b/gi,
    /\bport\s*(?:=|:)?\s*(\d{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      appendPort(ports, match[1]);
    }
  }

  return ports;
}

export function extractPortsFromCommand(command) {
  const ports = [];
  const source = String(command || '');
  if (!source) return ports;

  const patterns = [
    /(?:^|\s)--port(?:=|\s+)(\d{2,5})\b/g,
    /(?:^|\s)-p(?:=|\s+)?(\d{2,5})(?::\d{2,5})?\b/g,
    /(?:^|\s)PORT\s*=\s*(\d{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      appendPort(ports, match[1]);
    }
  }

  extractPortsFromText(source).forEach((port) => appendPort(ports, port));
  return ports;
}
