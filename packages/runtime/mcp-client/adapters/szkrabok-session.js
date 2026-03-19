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
  let result;
  if (tool === null || tool === undefined) {
    result = false;
  } else if (tool.inputSchema === null || tool.inputSchema === undefined) {
    result = false;
  } else if (tool.inputSchema.properties === null || tool.inputSchema.properties === undefined) {
    result = false;
  } else {
    result = tool.inputSchema.properties.sessionName !== undefined;
  }
  return result;
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
 * @param {object} [launchOptions] - Browser launch options forwarded to session_manage(open)
 * @returns {Promise<object>} Open result
 */
export async function open(client, sessionName, launchOptions) {
  const args = (() => {
    if (launchOptions) {
      return { action: 'open', sessionName, launchOptions };
    }
    return { action: 'open', sessionName };
  })();
  const result = await client.callTool({
    name: 'session_manage',
    arguments: args,
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
    name: 'session_manage',
    arguments: { action: 'close', sessionName, save: true },
  });

  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find(c => c.type === 'text');
    if (textContent) {
      return JSON.parse(textContent.text);
    }
  }
  return result;
}
