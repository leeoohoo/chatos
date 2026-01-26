export function extractContentText(blocks, options = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }
  const includeNonText = options?.includeNonText !== false;
  const trimText = options?.trimText === true;
  const trimResult = options?.trimResult === true;
  const lines = [];
  blocks.forEach((block) => {
    if (!block || typeof block !== 'object') {
      return;
    }
    switch (block.type) {
      case 'text': {
        const raw = block.text;
        if (!raw) return;
        let text = typeof raw === 'string' ? raw : String(raw);
        if (trimText) {
          text = text.trim();
        }
        if (text) {
          lines.push(text);
        }
        return;
      }
      case 'resource_link':
        if (includeNonText) {
          lines.push(`资源链接: ${block.uri || block.resourceId || '(未知 URI)'}`);
        }
        return;
      case 'image':
        if (includeNonText) {
          lines.push(`图像（${block.mimeType || 'image'}，${approxSize(block.data)}）`);
        }
        return;
      case 'audio':
        if (includeNonText) {
          lines.push(`音频（${block.mimeType || 'audio'}，${approxSize(block.data)}）`);
        }
        return;
      case 'resource':
        if (includeNonText) {
          lines.push('内嵌资源返回，内容较大，建议用 /mcp 获取详细信息。');
        }
        return;
      default:
        if (includeNonText) {
          lines.push(`[${block.type}]`);
        }
    }
  });
  let output = lines.join('\n');
  if (trimResult) {
    output = output.trim();
  }
  return output;
}

export function approxSize(base64Text) {
  if (!base64Text) return '未知大小';
  const bytes = Math.round((base64Text.length * 3) / 4);
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
