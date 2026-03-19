import { schemaToJSDoc, schemaToTs } from './schema-to-jsdoc.js';

/**
 * Group tools by namespace.
 * @param {Array} tools - Array of { name, inputSchema }
 * @returns {Map<string, Array>} Map of namespace -> tools
 */
export function groupByNamespace(tools) {
  return tools.reduce((groups, tool) => {
    const dotIndex = tool.name.indexOf('.');
    let ns;
    let method;
    if (dotIndex === -1) {
      ns = '_root';
      method = tool.name;
    } else {
      ns = tool.name.slice(0, dotIndex);
      method = tool.name.slice(dotIndex + 1);
    }
    const existing = groups.get(ns);
    if (existing) {
      groups.set(ns, [...existing, { ...tool, method }]);
    } else {
      groups.set(ns, [{ ...tool, method }]);
    }
    return groups;
  }, new Map());
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
  const typedefParts = [...groups.entries()].map(([ns, nsTools]) => {
    const methods = nsTools.map(t => {
      return `    ${t.method}({ ${Object.keys(t.inputSchema.properties || {}).filter(k => k !== 'sessionName').join(', ')} }): Promise<any>`;
    }).join('\n');
    return `  ${ns}: {\n${methods}\n  }`;
  });

  const typedef = `/**\n * @typedef {Object} McpHandle\n${typedefParts.map(p => ` * ${p}`).join('\n')}\n */`;

  // Build namespace handle factories
  const nsFactories = [...groups.entries()].map(([ns, nsTools]) => {
    const methodDefs = nsTools.map(t => {
      const props = t.inputSchema.properties || {};
      const params = Object.keys(props).filter(k => k !== 'sessionName');
      const invokeArgs = params.length > 0 ? ', args' : '';
      const paramDecl = params.length > 0 ? 'args = {}' : '';

      if (params.length === 0) {
        return `      ${t.method}: async (${paramDecl}) => invoke('${t.name}'${invokeArgs}),`;
      }

      const isRequiredArr = t.inputSchema.required !== null && t.inputSchema.required !== undefined
        ? t.inputSchema.required
        : [];
      const fields = params.map(p => {
        const isOptional = !isRequiredArr.includes(p);
        const type = schemaToJSDoc(props[p]);
        return `${p}${isOptional ? '?' : ''}: ${type}`;
      }).join(', ');
      const jsdoc = `      /** @param {{ ${fields} }} [args] */\n`;
      return `${jsdoc}      ${t.method}: async (${paramDecl}) => invoke('${t.name}'${invokeArgs}),`;
    }).join('\n');
    return `    ${ns}: {\n${methodDefs}\n    },`;
  });

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

  const interfaces = [...groups.entries()].map(([ns, nsTools]) => {
    const methods = nsTools.map(t => {
      const props = t.inputSchema.properties || {};
      const params = Object.keys(props).filter(k => k !== 'sessionName');

      // Build JSDoc lines immutably — description followed by each param description
      const jsdocLines = [
        t.description ? `   * ${t.description.replace(/\*\//g, '*/')}` : null,
        ...params.map(p => props[p].description ? `   * @param args.${p} ${props[p].description}` : null),
      ].filter(Boolean);

      const jsdoc = jsdocLines.length
        ? `  /**\n${jsdocLines.join('\n')}\n   */\n`
        : '';

      if (params.length === 0) {
        return `${jsdoc}  ${t.method}(): Promise<unknown>;`;
      }

      const isRequiredArr = t.inputSchema.required !== null && t.inputSchema.required !== undefined
        ? t.inputSchema.required
        : [];
      const fields = params.map(p => {
        const isOptional = !isRequiredArr.includes(p);
        const type = schemaToTs(props[p]);
        return `    ${p}${isOptional ? '?' : ''}: ${type};`;
      }).join('\n');

      return `${jsdoc}  ${t.method}(args: {\n${fields}\n  }): Promise<unknown>;`;
    }).join('\n\n');

    return `export interface ${capitalize(ns)}Handle {\n${methods}\n}`;
  });

  const handleProps = [...groups.keys()]
    .map(ns => `  readonly ${ns}: ${capitalize(ns)}Handle;`)
    .join('\n');

  const mcpHandle = `export interface McpHandle {
  close(): Promise<void>;
${handleProps}
}`;

  const connectFn = `export declare function mcpConnect(
  sessionName: string,
  options?: {
    launchOptions?: Record<string, unknown>;
    sidecarEnabled?: boolean;
    adapter?: object;
  }
): Promise<McpHandle>;`;

  const header = `// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: ${timestamp}`;

  return [header, ...interfaces, mcpHandle, connectFn].join('\n\n') + '\n';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
