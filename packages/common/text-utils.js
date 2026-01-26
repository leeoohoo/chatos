export function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
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
