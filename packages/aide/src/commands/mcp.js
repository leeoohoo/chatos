import * as colors from '../colors.js';

export function printMcpServers(servers, sourceLabel) {
  const label = sourceLabel ? String(sourceLabel) : '';
  console.log(colors.cyan(`\nMCP source: ${label || 'admin_db'}`));
  if (!servers || servers.length === 0) {
    console.log(colors.yellow('No MCP servers configured. Use /mcp_set to add one.'));
    return;
  }
  servers.forEach((entry, idx) => {
    const endpoint = entry.url || '<none>';
    console.log(
      `  [${idx + 1}] ${entry.name || '<unnamed>'}\n      Endpoint: ${endpoint}\n      API key env: ${
        entry.api_key_env || '<none>'
      }\n      Description: ${entry.description || '<none>'}`
    );
  });
}
