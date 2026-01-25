function extractMimeTypeFromDataUrl(dataUrl) {
  const raw = typeof dataUrl === 'string' ? dataUrl : '';
  const match = raw.match(/^data:([^;]+);base64,/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return '';
}

function createAttachmentId() {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeImageAttachments(input, options = {}) {
  const list = Array.isArray(input) ? input : [];
  const {
    maxImages = Number.POSITIVE_INFINITY,
    allowStrings = false,
    dedupe = true,
    generateId = false,
    fillMimeType = false,
  } = options;
  const limit = Number.isFinite(Number(maxImages)) ? Math.max(0, Math.floor(Number(maxImages))) : Number.POSITIVE_INFINITY;
  const out = [];
  const seen = new Set();

  for (const entry of list) {
    if (limit !== Number.POSITIVE_INFINITY && out.length >= limit) break;
    let dataUrl = '';
    let id = '';
    let name = '';
    let mimeType = '';
    if (typeof entry === 'string') {
      if (!allowStrings) continue;
      dataUrl = entry.trim();
    } else if (entry && typeof entry === 'object') {
      id = typeof entry.id === 'string' ? entry.id.trim() : '';
      name = typeof entry.name === 'string' ? entry.name.trim() : '';
      mimeType = typeof entry.mimeType === 'string' ? entry.mimeType.trim() : '';
      if (typeof entry.dataUrl === 'string') {
        dataUrl = entry.dataUrl.trim();
      } else if (typeof entry.url === 'string') {
        dataUrl = entry.url.trim();
      }
    }
    if (!dataUrl || !dataUrl.startsWith('data:image/')) continue;
    if (fillMimeType && !mimeType) {
      mimeType = extractMimeTypeFromDataUrl(dataUrl);
    }
    if (generateId && !id) {
      id = createAttachmentId();
    }
    const dedupeKey = dedupe ? (id || dataUrl) : '';
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);
    out.push({
      id,
      type: 'image',
      name,
      mimeType,
      dataUrl,
    });
  }
  return out;
}

export function buildUserMessageContent({ text, attachments, allowVisionInput, imageOptions } = {}) {
  const trimmedText = typeof text === 'string' ? text.trim() : '';
  const images = allowVisionInput ? normalizeImageAttachments(attachments, imageOptions) : [];
  const parts = [];
  if (trimmedText) {
    parts.push({ type: 'text', text: trimmedText });
  }
  images.forEach((img) => {
    if (!img?.dataUrl) return;
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  });
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}
