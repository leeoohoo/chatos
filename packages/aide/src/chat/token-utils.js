function extractImageUrl(part) {
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'image_url') {
    if (part.image_url && typeof part.image_url.url === 'string') {
      return part.image_url.url;
    }
    if (typeof part.image_url === 'string') {
      return part.image_url;
    }
  }
  return '';
}

export function extractPlainText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        const url = extractImageUrl(item);
        if (url) return `[image_url bytes=${Buffer.byteLength(url, 'utf8')}]`;
        return '';
      })
      .join(' ');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  const url = extractImageUrl(content);
  if (url) {
    return `[image_url bytes=${Buffer.byteLength(url, 'utf8')}]`;
  }
  return String(content ?? '');
}

export function countImageBytes(content) {
  if (!content) return 0;
  let total = 0;
  const addUrl = (url) => {
    if (typeof url === 'string' && url) {
      total += Buffer.byteLength(url, 'utf8');
    }
  };
  if (Array.isArray(content)) {
    content.forEach((item) => addUrl(extractImageUrl(item)));
    return total;
  }
  if (content && typeof content === 'object') {
    addUrl(extractImageUrl(content));
  }
  return total;
}

export function estimateMessageTokens(message) {
  if (!message || !message.content) {
    return 0;
  }
  const text = extractPlainText(message.content);
  const imageBytes = countImageBytes(message.content);
  return Math.ceil((Buffer.byteLength(text, 'utf8') + imageBytes) / 3);
}

export function estimateTokenCount(messages) {
  if (!Array.isArray(messages)) {
    return 0;
  }
  let total = 0;
  for (const message of messages) {
    if (!message || !message.content) continue;
    const text = extractPlainText(message.content);
    const imageBytes = countImageBytes(message.content);
    // Use UTF-8 byte length to avoid massively undercounting CJK text.
    total += Math.ceil((Buffer.byteLength(text, 'utf8') + imageBytes) / 3);
  }
  return total;
}
