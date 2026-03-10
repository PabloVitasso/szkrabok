import { schemaToJSDoc, schemaToTs } from './schema-to-jsdoc.js';

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
      const props = t.inputSchema.properties || {};
      const params = Object.keys(props).filter(k => k !== 'sessionName');
      const invokeArgs = params.length > 0 ? ', args' : '';
      const paramDecl = params.length > 0 ? 'args = {}' : '';

      let jsdoc = '';
      if (params.length > 0) {
        const fields = params.map(p => {
          const isOptional = !t.inputSchema.required?.includes(p);
          const type = schemaToJSDoc(props[p]);
          return `${p}${isOptional ? '?' : ''}: ${type}`;
        }).join(', ');
        jsdoc = `      /** @param {{ ${fields} }} [args] */\n`;
      }

      return `${jsdoc}      ${t.method}: async (${paramDecl}) => invoke('${t.name}'${invokeArgs}),`;
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
 * @param {object} [options] - Connection options
 * @param {object} [options.launchOptions] - Browser launch options forwarded to session.open
 * @param {boolean} [options.sidecarEnabled=false] - Enable sidecar file logging
 * @param {object} [options.adapter] - Custom adapter (defaults to szkrabok-session adapter)
 * @returns {Promise<McpHandle>}
 */
export async function mcpConnect(sessionName, options = {}) {
  const { launchOptions, sidecarEnabled, adapter: customAdapter = adapter } = options;
  const client = await spawnClient();

  // Validate registry hasn't drifted
  const liveTools = await client.listTools();
  const liveHash = registryHash(liveTools.tools);
  if (liveHash !== REGISTRY_HASH) {
    await client.close();
    throw new Error('MCP registry drift detected. Run npm run codegen:mcp');
  }

  const log = createLogger({ sidecarEnabled });
  const { invoke, close } = createCallInvoker({
    client,
    log,
    adapter: customAdapter,
    sessionName,
  });

  // Open session — forward launchOptions if provided
  await customAdapter.open(client, sessionName, launchOptions);

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

/**
 * Render mcp-tools.d.ts declaration file.
 * @param {object} options
 * @param {Array} options.tools
 * @param {string} options.timestamp
 * @returns {string}
 */
export function renderDts({ tools, timestamp }) {
  const groups = groupByNamespace(tools);

  const interfaces = [];
  for (const [ns, nsTools] of groups) {
    const methods = nsTools.map(t => {
      const props = t.inputSchema.properties || {};
      const params = Object.keys(props).filter(k => k !== 'sessionName');

      const jsdocLines = [];
      if (t.description) jsdocLines.push(`   * ${t.description.replace(/\*\//g, '*\/')}`);
      for (const p of params) {
        if (props[p].description) jsdocLines.push(`   * @param args.${p} ${props[p].description}`);
      }
      const jsdoc = jsdocLines.length
        ? `  /**\n${jsdocLines.join('\n')}\n   */\n`
        : '';

      if (params.length === 0) {
        return `${jsdoc}  ${t.method}(): Promise<unknown>;`;
      }

      const fields = params.map(p => {
        const isOptional = !t.inputSchema.required?.includes(p);
        const type = schemaToTs(props[p]);
        return `    ${p}${isOptional ? '?' : ''}: ${type};`;
      }).join('\n');

      return `${jsdoc}  ${t.method}(args: {\n${fields}\n  }): Promise<unknown>;`;
    }).join('\n\n');

    interfaces.push(`export interface ${capitalize(ns)}Handle {\n${methods}\n}`);
  }

  const handleProps = [...groups.keys()]
    .map(ns => `  readonly ${ns}: ${capitalize(ns)}Handle;`)
    .join('\n');

  const mcpHandle = `export interface McpHandle {\n  close(): Promise<void>;\n${handleProps}\n}`;

  const connectFn = `export declare function mcpConnect(\n  sessionName: string,\n  options?: {\n    launchOptions?: Record<string, unknown>;\n    sidecarEnabled?: boolean;\n    adapter?: object;\n  }\n): Promise<McpHandle>;`;

  const header = `// AUTO-GENERATED — do not edit manually.\n// Regenerate: npm run codegen:mcp\n// Last generated: ${timestamp}`;

  return [header, ...interfaces, mcpHandle, connectFn].join('\n\n') + '\n';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
