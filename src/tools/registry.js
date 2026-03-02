import * as session from './szkrabok_session.js';
import * as workflow from './workflow.js';
import * as szkrabokBrowser from './szkrabok_browser.js';
import { wrapError } from '../utils/errors.js';
import { logError } from '../utils/logger.js';

const SZKRABOK = '[szkrabok]';
const PLAYWRIGHT_MCP = '[playwright-mcp]';

const tools = {
  'session.open': {
    handler: session.open,
    description: `${SZKRABOK} Open or resume a browser session`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        url: { type: 'string' },
        launchOptions: {
          type: 'object',
          description:
            'Browser launch options. Use either preset OR individual fields (userAgent, viewport, locale, timezone) — not both. headless and stealth are always allowed alongside either.',
          properties: {
            preset: {
              type: 'string',
              description:
                'Preset name from szkrabok.config.toml (e.g. "mobile-iphone-15"). Merges over [default].',
            },
            stealth: { type: 'boolean', default: true },
            disableWebGL: { type: 'boolean', default: false },
            headless: { type: 'boolean' },
            userAgent: { type: 'string' },
            viewport: {
              type: 'object',
              properties: { width: { type: 'number' }, height: { type: 'number' } },
            },
            locale: { type: 'string' },
            timezone: { type: 'string' },
          },
        },
      },
      required: ['sessionName'],
    },
  },

  'session.close': {
    handler: session.close,
    description: `${SZKRABOK} Close and save session`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        save: { type: 'boolean', default: true },
      },
      required: ['sessionName'],
    },
  },

  'session.list': {
    handler: session.list,
    description: `${SZKRABOK} List all sessions`,
    inputSchema: { type: 'object', properties: {} },
  },

  'session.delete': {
    handler: session.deleteSession,
    description: `${SZKRABOK} Delete session permanently`,
    inputSchema: {
      type: 'object',
      properties: { sessionName: { type: 'string' } },
      required: ['sessionName'],
    },
  },

  'session.endpoint': {
    handler: session.endpoint,
    description: `${SZKRABOK} Get Playwright WebSocket endpoint for external script connection`,
    inputSchema: {
      type: 'object',
      properties: { sessionName: { type: 'string' } },
      required: ['sessionName'],
    },
  },

  'workflow.login': {
    handler: workflow.login,
    description: `${SZKRABOK} Automated login`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
      },
      required: ['sessionName', 'username', 'password'],
    },
  },

  'workflow.fillForm': {
    handler: workflow.fillForm,
    description: `${SZKRABOK} Fill form`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        fields: { type: 'object' },
      },
      required: ['sessionName', 'fields'],
    },
  },

  'workflow.scrape': {
    handler: workflow.scrape,
    description: `${SZKRABOK} Scrape structured data`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        selectors: { type: 'object' },
      },
      required: ['sessionName', 'selectors'],
    },
  },

  'browser.run_code': {
    handler: szkrabokBrowser.run_code,
    description: `${PLAYWRIGHT_MCP} Execute a Playwright script string against the session page`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        code: { type: 'string' },
      },
      required: ['sessionName', 'code'],
    },
  },

  'browser.run_test': {
    handler: szkrabokBrowser.run_test,
    description: `${PLAYWRIGHT_MCP} Run Playwright .spec.js tests and return JSON results. Connects to the session browser via CDP. IMPORTANT: session.open must be called first.`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        grep: { type: 'string', description: 'Filter tests by name (regex)' },
        params: {
          type: 'object',
          description:
            'Key/value params passed as TEST_* env vars to the spec (e.g. {url:"https://..."} → TEST_URL)',
        },
        config: {
          type: 'string',
          description: 'Config path relative to repo root. Defaults to playwright.config.js',
        },
        project: {
          type: 'string',
          description:
            'Playwright project name to run (e.g. "automation"). Runs all projects if omitted.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            'File or directory paths passed as positional args to playwright test (e.g. ["automation/rebrowser-check.spec.js"] or ["automation/"]). Relative to repo root.',
        },
        keepOpen: {
          type: 'boolean',
          description:
            'After the test run, reconnect the session if the test subprocess invalidated the MCP context. Chrome stays alive; this restores the Playwright connection to it. Default false.',
        },
      },
      required: ['sessionName'],
    },
  },

  'browser.run_file': {
    handler: szkrabokBrowser.run_file,
    description: `${PLAYWRIGHT_MCP} Run a named export from a Playwright ESM .mjs script against the session page. Function receives (page, args) and must return a JSON-serialisable value. IMPORTANT: session.open must be called first.`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        path: { type: 'string', description: 'Absolute or relative path to an .mjs script file' },
        fn: { type: 'string', description: 'Named export to call. Defaults to "default".' },
        args: {
          type: 'object',
          description: 'Arguments passed as second parameter to the function',
        },
      },
      required: ['sessionName', 'path'],
    },
  },
};

export const registerTools = () =>
  Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

export const handleToolCall = async (name, args) => {
  const tool = tools[name];

  if (!tool) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err) {
    logError(`Tool ${name} failed`, err, { args });
    return {
      content: [{ type: 'text', text: JSON.stringify(wrapError(err)) }],
      isError: true,
    };
  }
};
