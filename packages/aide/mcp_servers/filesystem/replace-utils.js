function safeLiteralReplace(str, oldString, newString) {
  if (oldString === '' || !str.includes(oldString)) {
    return str;
  }
  return str.replaceAll(oldString, () => newString);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (true) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx === -1) {
      break;
    }
    count += 1;
    cursor = idx + needle.length;
  }
  return count;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectLineEnding(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

export function restoreTrailingNewline(originalContent, modifiedContent) {
  const hadTrailingNewline = originalContent.endsWith('\n');
  if (hadTrailingNewline && !modifiedContent.endsWith('\n')) {
    return `${modifiedContent}\n`;
  }
  if (!hadTrailingNewline && modifiedContent.endsWith('\n')) {
    return modifiedContent.replace(/\n$/, '');
  }
  return modifiedContent;
}

export function calculateExactReplacement({ currentContent, oldString, newString }) {
  const occurrences = countOccurrences(currentContent, oldString);
  if (occurrences <= 0) return null;
  const replaced = safeLiteralReplace(currentContent, oldString, newString);
  return { newContent: replaced, occurrences, strategy: 'exact' };
}

export function calculateFlexibleReplacement({ currentContent, oldString, newString }) {
  const sourceLines = currentContent.split('\n');
  const searchLines = oldString.split('\n');
  const searchLinesStripped = searchLines.map((line) => line.trim());
  const replaceLines = newString.split('\n');

  if (searchLinesStripped.length === 0) return null;

  let occurrences = 0;
  let i = 0;
  while (i <= sourceLines.length - searchLinesStripped.length) {
    const window = sourceLines.slice(i, i + searchLinesStripped.length);
    const windowStripped = window.map((line) => line.trim());
    const isMatch = windowStripped.every((line, idx) => line === searchLinesStripped[idx]);
    if (!isMatch) {
      i += 1;
      continue;
    }

    occurrences += 1;
    const indentationMatch = String(sourceLines[i] || '').match(/^(\\s*)/);
    const indentation = indentationMatch ? indentationMatch[1] : '';
    const newBlockWithIndent = replaceLines.map((line) => `${indentation}${line}`);
    sourceLines.splice(i, searchLinesStripped.length, ...newBlockWithIndent);
    i += newBlockWithIndent.length;
  }

  if (occurrences <= 0) return null;
  return { newContent: sourceLines.join('\n'), occurrences, strategy: 'flexible' };
}

export function calculateRegexReplacement({ currentContent, oldString, newString }) {
  const delimiters = ['(', ')', ':', '[', ']', '{', '}', '>', '<', '='];

  let processed = oldString;
  for (const delim of delimiters) {
    processed = processed.split(delim).join(` ${delim} `);
  }

  const tokens = processed.split(/\\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const escapedTokens = tokens.map(escapeRegex);
  const pattern = escapedTokens.join('\\\\s*');

  const finalPattern = `^(\\\\s*)${pattern}`;
  const flexibleRegex = new RegExp(finalPattern, 'm');

  const match = flexibleRegex.exec(currentContent);
  if (!match) {
    return null;
  }

  const indentation = match[1] || '';
  const newLines = newString.split('\\n');
  const newBlockWithIndent = newLines.map((line) => `${indentation}${line}`).join('\\n');

  return {
    newContent: currentContent.replace(flexibleRegex, newBlockWithIndent),
    occurrences: 1,
    strategy: 'regex',
  };
}
