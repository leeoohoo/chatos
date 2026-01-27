export function logWith(logger, level, message, meta, err) {
  if (!logger) return;
  const fn = typeof logger[level] === 'function' ? logger[level] : logger.info;
  if (typeof fn !== 'function') return;
  fn(message, meta, err);
}
