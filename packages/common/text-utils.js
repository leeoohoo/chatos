export function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function normalizeKey(value) {
  return normalizeString(value).toLowerCase();
}

export function normalizeText(value) {
  return safeTrim(value);
}

export function normalizeId(value) {
  return safeTrim(value);
}

export function normalizeTextList(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueNormalizedList(list, normalize) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const normalized = normalize(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

export function uniqueStrings(list) {
  return uniqueNormalizedList(list, normalizeString);
}

export function uniqueIds(list) {
  return uniqueNormalizedList(list, normalizeId);
}
