import React from 'react';

import { GLOBAL_LAYOUT_STYLES } from './global-styles/layout.js';
import { GLOBAL_MISC_STYLES } from './global-styles/misc.js';
import { GLOBAL_STYLE_TOKENS } from './global-styles/tokens.js';
import { GLOBAL_TOOLING_STYLES } from './global-styles/tooling.js';

const GLOBAL_STYLE_SECTIONS = [
  GLOBAL_STYLE_TOKENS,
  GLOBAL_LAYOUT_STYLES,
  GLOBAL_TOOLING_STYLES,
  GLOBAL_MISC_STYLES,
];

export function GlobalStyles({ extraCss = '' } = {}) {
  const extra = typeof extraCss === 'string' ? extraCss : '';
  const styles = [...GLOBAL_STYLE_SECTIONS, extra].filter(Boolean).join('\n');
  return <style>{styles}</style>;
}
