import { normalizePromptLanguage } from '../shared/mcp-utils.js';
import { RESERVED_PROMPT_NAMES } from '../shared/prompt-utils.js';
import { normalizeKey } from '../shared/text-utils.js';

const DEFAULT_PROMPTS = {
  daily_coding: `你是终端内的资深全栈开发助手，帮助我实现功能、解释思路，输出风格：
- 先用中文概述整体方案，再给出关键命令或代码片段；
- 涉及文件修改时，标注相对路径与重点变更；
- 主动提示潜在风险、待测项与下一步计划；
- 输出简洁，必要时用列表或表格。`,
  code_review: `你是一名严格的代码 Reviewer。对于给出的改动：
- 先列出风险、遗漏、潜在 bug；
- 如果没有发现问题，说明已检查的范围并提示仍需关注的点；
- 输出以“问题 -> 说明 -> 建议”结构展开。`,
  bugfix_partner: `你与我结对调试。流程：
1. 先澄清现象与当前假设；
2. 提出最多 3 个排查步骤，按优先级排列；
3. 根据我反馈持续迭代，直到问题解决。`,
};

const DEFAULT_INTERNAL_SYSTEM_PROMPT = `<internal_rules>
  <voice>Keep replies concise. Use English. State conclusions + next actions; when mentioning files/commands, give relative paths or full commands.</voice>
  <tooling>Prefer MCP tools (filesystem, shell, task_manager, subagent_router) instead of guessing; fetch context before deciding.</tooling>
  <tasks>
    <step>On any request, create a task in task_manager (add_task) with goal/context; use list_tasks to confirm.</step>
    <step>Update progress via update_task; mark completion with complete_task including a completion note (what was delivered + validation); reference task IDs in replies.</step>
    <step>Log ad-hoc subtasks before executing; if tools/permissions are missing, state it and ask.</step>
  </tasks>
  <safety>Before code changes, highlight impacted files and risks; then provide steps or patches.</safety>
</internal_rules>`;

const DEFAULT_SYSTEM_PROMPT = `<assistant_role>
  <persona>You are the orchestrator: break down user needs and delegate to the right sub-agents/tools. Do not hand-code; route work to specialists.</persona>
  <behaviors>
    <behavior>Work in clear phases: (1) restate/confirm the task; (2) call subagent_router.suggest_sub_agent (or use a known agent_id) to pick the best match; (3) if a suitable agent exists, add a task via task_manager and call subagent_router.run_sub_agent to execute; (4) summarize results, risks, next actions.</behavior>
    <behavior>Do not hand-write code; delegate to sub-agents. If no suitable sub-agent exists, say so and ask to install.</behavior>
    <behavior>Call out missing tests, risks, and follow-ups; keep output terse with lists/blocks.</behavior>
  </behaviors>
</assistant_role>`;

function normalizePromptName(value) {
  return normalizeKey(value);
}

function isReservedPromptName(name) {
  const normalized = normalizePromptName(name);
  if (!normalized) return false;
  if (RESERVED_PROMPT_NAMES.has(normalized)) return true;
  const suffixIndex = normalized.lastIndexOf('__');
  if (suffixIndex > 0) {
    const base = normalized.slice(0, suffixIndex);
    if (RESERVED_PROMPT_NAMES.has(base)) return true;
  }
  return false;
}

function isSummaryPromptName(name) {
  const normalized = normalizePromptName(name);
  if (!normalized) return false;
  const baseNames = new Set(['summary_prompt', 'summary_prompt_user']);
  if (baseNames.has(normalized)) return true;
  const suffixIndex = normalized.lastIndexOf('__');
  if (suffixIndex > 0) {
    const base = normalized.slice(0, suffixIndex);
    if (baseNames.has(base)) return true;
  }
  return false;
}

function isMcpPromptName(name) {
  return normalizePromptName(name).startsWith('mcp_');
}

function loadPromptProfilesFromDb(promptsList = []) {
  const map = {};
  (Array.isArray(promptsList) ? promptsList : []).forEach((p) => {
    if (!p) return;
    const name = String(p.name || p.title || p.id || '').trim();
    if (!name) return;
    if (isMcpPromptName(name)) return;
    if (isReservedPromptName(name)) return;
    if (isSummaryPromptName(name)) return;
    if (typeof p.content === 'string' && p.content.trim()) {
      map[name] = p.content.trim();
    }
  });
  if (Object.keys(map).length === 0) {
    map.default = DEFAULT_PROMPTS.daily_coding;
  }
  return { path: '(admin.db)', prompts: map };
}

function loadSystemPromptFromDb(promptsList = [], options = {}) {
  const language = normalizePromptLanguage(options?.language);
  const promptList = Array.isArray(promptsList) ? promptsList : [];
  const resolveUseInMain = (_prompt) => true;
  const resolveUseInSubagent = (_prompt) => true;

  const normalizeContent = (value) => (typeof value === 'string' ? value.trim() : '');

  const pickSystemPromptRecord = (baseName) => {
    const normalizedBase = String(baseName || '').trim();
    if (!normalizedBase) return null;
    const candidates = [];
    if (language === 'en') {
      candidates.push(`${normalizedBase}__en`);
    }
    candidates.push(normalizedBase);
    for (const name of candidates) {
      const found = promptList.find((p) => p?.name === name) || null;
      if (found) return found;
    }
    return null;
  };

  const mainInternalRecord =
    pickSystemPromptRecord('internal_main');
  const mainInternal = mainInternalRecord
    ? (resolveUseInMain(mainInternalRecord) ? normalizeContent(mainInternalRecord.content) : '')
    : DEFAULT_INTERNAL_SYSTEM_PROMPT;

  const subagentInternalRecord =
    pickSystemPromptRecord('internal_subagent');
  const subagentInternal = subagentInternalRecord
    ? (resolveUseInSubagent(subagentInternalRecord) ? normalizeContent(subagentInternalRecord.content) : '')
    : DEFAULT_INTERNAL_SYSTEM_PROMPT;

  const defaultRecord =
    pickSystemPromptRecord('default');
  const defaultPrompt = defaultRecord
    ? (resolveUseInMain(defaultRecord) ? normalizeContent(defaultRecord.content) : '')
    : DEFAULT_SYSTEM_PROMPT;

  const mainUserRecord =
    pickSystemPromptRecord('user_prompt');
  const mainUserBase = mainUserRecord
    ? (resolveUseInMain(mainUserRecord) ? normalizeContent(mainUserRecord.content) : '')
    : '';

  const subagentUserRecord =
    pickSystemPromptRecord('subagent_user_prompt');
  const subagentUserBase = subagentUserRecord
    ? (resolveUseInSubagent(subagentUserRecord) ? normalizeContent(subagentUserRecord.content) : '')
    : '';

  const mainBaseNames = new Set([
    'internal_main',
    'default',
    'user_prompt',
    'internal_main__zh',
    'default__zh',
    'user_prompt__zh',
    'internal_main__en',
    'default__en',
    'user_prompt__en',
  ]);
  const subagentInternalNames = new Set([
    'internal_subagent',
    'subagent_user_prompt',
    'internal_subagent__zh',
    'internal_subagent__en',
    'subagent_user_prompt__zh',
    'subagent_user_prompt__en',
  ]);

  const buildExtras = (enabledFn, excludedNames) =>
    promptList
      .filter((p) => p?.name && !excludedNames.has(p.name))
      .filter((p) => !isMcpPromptName(p.name))
      .filter((p) => !isReservedPromptName(p.name))
      .filter((p) => !isSummaryPromptName(p.name))
      .filter((p) => enabledFn(p))
      .map((p) => ({ name: String(p.name), content: normalizeContent(p.content) }))
      .filter((p) => p.content)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => p.content)
      .join('\n\n');

  const userPromptExtra = buildExtras(resolveUseInMain, mainBaseNames);
  const userPrompt = [mainUserBase, userPromptExtra].filter(Boolean).join('\n\n');
  const subagentUserPromptExtra = buildExtras(resolveUseInSubagent, subagentInternalNames);
  const subagentUserPrompt = [subagentUserBase, subagentUserPromptExtra]
    .filter(Boolean)
    .join('\n\n');
  return {
    path: '(admin.db)',
    mainInternal,
    subagentInternal,
    defaultPrompt,
    userPrompt,
    subagentUserPrompt,
  };
}

function composeSystemPrompt({ configPath, systemOverride, modelPrompt, systemConfig }) {
  const config =
    systemConfig && typeof systemConfig === 'object'
      ? systemConfig
      : {
          path: '(builtin)',
          mainInternal: DEFAULT_INTERNAL_SYSTEM_PROMPT,
          subagentInternal: DEFAULT_INTERNAL_SYSTEM_PROMPT,
          defaultPrompt: DEFAULT_SYSTEM_PROMPT,
          userPrompt: '',
          subagentUserPrompt: '',
        };
  const sections = [];
  if (config.mainInternal) {
    sections.push(config.mainInternal.trim());
  }
  const userSection =
    systemOverride !== undefined
      ? systemOverride
      : config.defaultPrompt || modelPrompt;
  if (userSection && String(userSection).trim()) {
    sections.push(String(userSection).trim());
  }
  return {
    prompt: sections.join('\n\n'),
    path: config.path,
    userPrompt: config.userPrompt || '',
    subagentUserPrompt: config.subagentUserPrompt || '',
  };
}

function buildUserPromptMessages(text, name = 'user_prompt') {
  const promptText = typeof text === 'string' ? text.trim() : '';
  if (!promptText) {
    return [];
  }
  return [{ content: promptText, name }];
}

export {
  loadPromptProfilesFromDb,
  loadSystemPromptFromDb,
  composeSystemPrompt,
  buildUserPromptMessages,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_INTERNAL_SYSTEM_PROMPT,
};
