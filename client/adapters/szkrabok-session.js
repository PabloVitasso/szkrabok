/**
 * Szkrabok session adapter.
 * This is the only file in client/ that knows about szkrabok's session lifecycle
 * and the wire key name 'sessionName'.
 */

/**
 * Check if a tool requires session injection.
 * @param {object} tool - Tool definition with inputSchema
 * @returns {boolean} True if tool has sessionName in properties
 */
export function hasSession(tool) {
  return tool?.inputSchema?.properties?.sessionName !== undefined;
}

/**
 * Inject sessionName into arguments.
 * @param {object} args - Tool arguments
 * @param {string} sessionName - Session name
 * @returns {object} Arguments with sessionName injected
 */
export function injectSession(args, sessionName) {
  return { sessionName, ...args };
}

/**
 * Open a session.
 * @param {object} client - MCP client
 * @param {string} sessionName - Session name
 * @returns {Promise<object>} Open result
 */
export async function open(client, sessionName) {
  const result = await client.callTool({
    name: 'session.open',
    arguments: { sessionName },
  });

  // Parse result
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find(c => c.type === 'text');
    if (textContent) {
      return JSON.parse(textContent.text);
    }
  }
  return result;
}

/**
 * Close a session.
 * @param {object} client - MCP client
 * @param {string} sessionName - Session name
 * @returns {Promise<object>} Close result
 */
export async function close(client, sessionName) {
  const result = await client.callTool({
    name: 'session.close',
    arguments: { sessionName, save: true },
  });

  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find(c => c.type === 'text');
    if (textContent) {
      return JSON.parse(textContent.text);
    }
  }
  return result;
}
