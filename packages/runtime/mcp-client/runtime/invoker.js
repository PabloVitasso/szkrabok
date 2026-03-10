/**
 * Creates a call invoker that wraps the MCP client with serialization and logging.
 * @param {object} options
 * @param {object} options.client - Connected MCP client
 * @param {object} options.log - Logger from createLogger()
 * @param {object} options.adapter - Session adapter (e.g., szkrabok-session.js)
 * @param {string} options.sessionName - Session name to inject
 * @returns {{ invoke: (name, args, opts?) => Promise<any>, close: () => Promise<void> }}
 */
export function createCallInvoker({ client, log, adapter, sessionName }) {
  let closed = false;
  let callChain = Promise.resolve();
  let seq = 0;

  const checkClosed = () => {
    if (closed) {
      throw new Error('Invoker has been closed');
    }
  };

  /**
   * Invoke an MCP tool.
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @param {object} [opts] - Options
   * @param {boolean} [opts.parallel=false] - Bypass serialization chain
   * @returns {Promise<any>} Tool result
   */
  const invoke = async (name, args, opts = {}) => {
    checkClosed();

    const toolName = name;
    const doCall = async () => {
      const start = Date.now();

      // Inject session name if tool requires it
      const finalArgs = adapter.hasSession({ inputSchema: { properties: { sessionName: {} } } })
        ? adapter.injectSession(args, sessionName)
        : args;

      // Log intent
      log.before({ name: toolName, arguments: finalArgs }, seq);

      try {
        const result = await client.callTool({
          name: toolName,
          arguments: finalArgs,
        });

        const ms = Date.now() - start;
        log.afterSuccess({ name: toolName, arguments: finalArgs }, result, ms, seq);
        seq++;

        // Parse result content
        if (result.content && Array.isArray(result.content)) {
          const textContent = result.content.find(c => c.type === 'text');
          if (textContent) {
            return JSON.parse(textContent.text);
          }
        }
        return result;
      } catch (err) {
        const ms = Date.now() - start;
        log.afterFailure({ name: toolName, arguments: finalArgs }, err, ms, seq);
        seq++;
        throw err;
      }
    };

    if (opts.parallel) {
      return doCall();
    }

    // Serialize calls through promise chain
    callChain = callChain.then(() => doCall());
    return callChain;
  };

  /**
   * Close the invoker and cleanup.
   * @returns {Promise<void>}
   */
  const close = async () => {
    if (closed) return;
    closed = true;

    try {
      await adapter.close(client, sessionName);
    } finally {
      await client.close();
    }
  };

  return { invoke, close };
}
