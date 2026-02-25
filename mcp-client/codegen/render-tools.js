import { schemaToJSDoc } from './schema-to-jsdoc.js';

/**
 * Group tools by namespace.
 * @param {Array} tools - Array of { name, inputSchema }
 * @returns {Map<string, Array>} Map of namespace -> tools
 */
export function groupByNamespace(tools) {
  const groups = new Map();

  for (const tool of tools) {
    const dotIndex = tool.name.indexOf('.');
    let ns, method;

    if (dotIndex === -1) {
      ns = '_root';
      method = tool.name;
    } else {
      ns = tool.name.slice(0, dotIndex);
      method = tool.name.slice(dotIndex + 1);
    }

    if (!groups.has(ns)) {
      groups.set(ns, []);
    }
    groups.get(ns).push({ ...tool, method });
  }

  return groups;
}

/**
 * Render the generated mcp-tools.js file content.
 * @param {object} options
 * @param {Array} options.tools - Tools from listTools()
 * @param {string} options.hash - Registry hash
 * @param {string} options.timestamp - Generation timestamp
 * @returns {string} File content
 */
export function renderTools({ tools, hash, timestamp }) {
  const toolCount = tools.length;
  const groups = groupByNamespace(tools);

  // Build JSDoc typedef
  const typedefParts = [];
  for (const [ns, nsTools] of groups) {
    const methods = nsTools.map(t => {
      const params = [];
      for (const [propName, propDef] of Object.entries(t.inputSchema.properties || {})) {
        if (propName === 'sessionName') continue; // Injected by adapter
        const isOptional = !t.inputSchema.required?.includes(propName);
        const type = schemaToJSDoc(propDef);
        params.push(`  ${propName}${isOptional ? '?' : ''}: ${type}`);
      }
      return `    ${t.method}({ ${Object.keys(t.inputSchema.properties || {}).filter(k => k !== 'sessionName').join(', ')} }): Promise<any>`;
    }).join('\n');

    typedefParts.push(`  ${ns}: {\n${methods}\n  }`);
  }

  const typedef = `/**\n * @typedef {Object} McpHandle\n${typedefParts.map(p => ` * ${p}`).join('\n')}\n */`;

  // Build namespace handle factories
  const nsFactories = [];
  for (const [ns, nsTools] of groups) {
    const methodDefs = nsTools.map(t => {
      const params = Object.keys(t.inputSchema.properties || {}).filter(k => k !== 'sessionName');
      const invokeArgs = params.length > 0 ? ', args' : '';
      const paramDecl = params.length > 0 ? 'args = {}' : '';
      return `      ${t.method}: async (${paramDecl}) => invoke('${t.name}'${invokeArgs}),`;
    }).join('\n');

    nsFactories.push(`    ${ns}: {\n${methodDefs}\n    },`);
  }

  const handles = nsFactories.join('\n');

  // Header comment
  const header = `// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: ${timestamp}
// Tools: ${toolCount}  Hash: ${hash}`;

  // Imports
  const imports = `import { createHash } from 'node:crypto';
import { spawnClient } from './runtime/transport.js';
import { createCallInvoker } from './runtime/invoker.js';
import { createLogger } from './runtime/logger.js';
import * as adapter from './adapters/szkrabok-session.js';`;

  // Registry hash constant
  const hashConst = `const REGISTRY_HASH = '${hash}';`;

  // mcpConnect function
  const connectFn = `/**
 * Connect to MCP server and get a typed handle.
 * @param {string} sessionName - Session name for szkrabok
 * @param {object} [customAdapter] - Optional custom adapter
 * @param {object} [options] - Connection options
 * @param {boolean} [options.sidecarEnabled=false] - Enable sidecar file logging
 * @param {object} [options.launchOptions] - Browser launch options forwarded to session.open
 * @returns {Promise<McpHandle>}
 */
export async function mcpConnect(sessionName, customAdapter = adapter, options = {}) {
  const client = await spawnClient();

  // Validate registry hasn't drifted
  const liveTools = await client.listTools();
  const liveHash = registryHash(liveTools.tools);
  if (liveHash !== REGISTRY_HASH) {
    await client.close();
    throw new Error('MCP registry drift detected. Run npm run codegen:mcp');
  }

  const log = createLogger({ sidecarEnabled: options.sidecarEnabled });
  const { invoke, close } = createCallInvoker({
    client,
    log,
    adapter: customAdapter,
    sessionName,
  });

  // Open session — forward launchOptions if provided
  await customAdapter.open(client, sessionName, options.launchOptions);

  return {
    close,
${handles}
  };
}

/**
 * Compute registry hash for drift detection.
 * @param {Array} tools
 * @returns {string}
 */
function registryHash(tools) {
  const canonical = tools
    .map(t => ({ name: t.name, inputSchema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHash('sha1')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 12);
}`;

  return [header, imports, hashConst, typedef, connectFn].join('\n\n');
}
