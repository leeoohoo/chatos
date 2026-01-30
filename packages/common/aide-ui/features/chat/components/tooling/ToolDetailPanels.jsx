import React from 'react';

import { BrowserToolDetails } from './details/BrowserToolDetails.jsx';
import { CodeMaintainerToolDetails } from './details/CodeMaintainerToolDetails.jsx';
import { DefaultToolDetails } from './details/DefaultToolDetails.jsx';
import { FilesystemToolDetails } from './details/FilesystemToolDetails.jsx';
import { JournalToolDetails } from './details/JournalToolDetails.jsx';
import { LspToolDetails } from './details/LspToolDetails.jsx';
import { PromptToolDetails } from './details/PromptToolDetails.jsx';
import { ShellToolDetails } from './details/ShellToolDetails.jsx';
import { SubagentToolDetails } from './details/SubagentToolDetails.jsx';
import { TaskToolDetails } from './details/TaskToolDetails.jsx';
import { ToolMetaSection } from './details/ToolMetaSection.jsx';

export function ToolDetails({ toolKind, structuredContent, liveSteps, display, ...props }) {
  const toolNameText = typeof props.toolName === 'string' ? props.toolName.toLowerCase() : '';
  const isRunSubAgent = toolNameText.includes('run_sub_agent');
  const isJournalPretty =
    toolKind === 'journal' &&
    (toolNameText.includes('mcp_project_journal_get_project_info') ||
      toolNameText.includes('mcp_project_journal_list_exec_logs'));
  let body = null;
  if (toolKind === 'shell') body = <ShellToolDetails {...props} />;
  else if (toolKind === 'filesystem') body = <FilesystemToolDetails {...props} structuredContent={structuredContent} />;
  else if (toolKind === 'lsp') body = <LspToolDetails {...props} structuredContent={structuredContent} />;
  else if (toolKind === 'task') body = <TaskToolDetails {...props} structuredContent={structuredContent} />;
  else if (toolKind === 'subagent')
    body = <SubagentToolDetails {...props} structuredContent={structuredContent} liveSteps={liveSteps} display={display} />;
  else if (toolKind === 'prompt') body = <PromptToolDetails {...props} structuredContent={structuredContent} />;
  else if (toolKind === 'journal') body = <JournalToolDetails {...props} structuredContent={structuredContent} />;
  else if (toolKind === 'browser') body = <BrowserToolDetails {...props} structuredContent={structuredContent} />;
  else if (toolKind === 'code_maintainer')
    body = <CodeMaintainerToolDetails {...props} structuredContent={structuredContent} />;
  else body = <DefaultToolDetails {...props} structuredContent={structuredContent} />;

  const showMeta =
    !(toolKind === 'subagent' && (display === 'popover' || (display === 'drawer' && isRunSubAgent))) && !isJournalPretty;

  return (
    <>
      {body}
      {showMeta ? <ToolMetaSection structuredContent={structuredContent} showStructured={toolKind !== 'subagent'} /> : null}
    </>
  );
}
