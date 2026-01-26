export function normalizeTextEdits(edits) {
  if (!Array.isArray(edits)) return [];
  return edits
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      range: e.range,
      newText: typeof e.newText === 'string' ? e.newText : '',
    }));
}

export function applyTextEdits(text, edits) {
  const sorted = edits
    .slice()
    .sort((a, b) => {
      const aStart = a.range?.start || { line: 0, character: 0 };
      const bStart = b.range?.start || { line: 0, character: 0 };
      if (aStart.line !== bStart.line) return bStart.line - aStart.line;
      return bStart.character - aStart.character;
    });

  let changed = false;
  let current = text;
  for (const edit of sorted) {
    const range = edit.range;
    if (!range || !range.start || !range.end) {
      continue;
    }
    const start = lspPositionToOffsetUtf16(current, range.start);
    const end = lspPositionToOffsetUtf16(current, range.end);
    if (start < 0 || end < 0 || start > end) {
      throw new Error('Invalid text edit range.');
    }
    const newText = typeof edit.newText === 'string' ? edit.newText : '';
    current = current.slice(0, start) + newText + current.slice(end);
    changed = true;
  }
  return { changed, text: current };
}

function lspPositionToOffsetUtf16(text, pos) {
  const line = Number(pos?.line);
  const character = Number(pos?.character);
  if (!Number.isFinite(line) || !Number.isFinite(character) || line < 0 || character < 0) {
    return -1;
  }
  const lines = text.split('\n');
  if (line >= lines.length) {
    return text.length;
  }
  let offset = 0;
  for (let i = 0; i < line; i += 1) {
    offset += lines[i].length + 1;
  }
  const lineText = lines[line] || '';
  const slice = lineText.slice(0, character);
  return offset + slice.length;
}
