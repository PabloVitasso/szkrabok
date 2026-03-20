import * as session from './szkrabok_session.js';
import * as workflow from './workflow.js';
import * as szkrabokBrowser from './szkrabok_browser.js';
import * as scaffold from './scaffold.js';
import { wrapError } from '../utils/errors.js';
import { logError } from '../utils/logger.js';

const SZKRABOK = '[szkrabok]';
const PLAYWRIGHT_MCP = '[playwright-mcp]';

const tools = {
  'session_manage': {
    handler: session.manage,
    description: `${SZKRABOK} Manage browser sessions. Actions: open (launch/resume), close (save/delete), list (all), delete (templates; globs support), endpoint (CDP/WS). 'open' + 'isClone:true' returns a clone ID; use this ID for subsequent calls.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'close', 'list', 'delete', 'endpoint'],
        },
        sessionName: {
          type: 'string',
          description:
            'Session name or glob (delete only). For clones, use the ID returned by \'open\' (isClone:true), not the template name',
        },
        url: { type: 'string', description: 'URL to navigate after opening. open only' },
        launchOptions: {
          type: 'object',
          description:
            'open only. Use preset OR individual fields (userAgent, viewport, locale, timezone). isClone creates an ephemeral clone. headless and stealth always allowed',
          properties: {
            preset: { type: 'string', description: 'Preset name from szkrabok.config.toml' },
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
            isClone: {
              type: 'boolean',
              default: false,
              description:
                'Clone the template session into an ephemeral copy. ' +
                'Returns a generated sessionName - use it for all subsequent calls. ' +
                'On close: browser stops, clone dir deleted, no state saved. ' +
                'Template session must be closed before cloning',
            },
          },
        },
      },
      required: ['action'],
    },
  },

  'browser_scrape': {
    handler: workflow.scrape,
    description: `${SZKRABOK} Scrape current page into LLM-ready text. Returns raw blocks and llmFriendly string. selectors: optional CSS selectors to target specific areas; omit for auto (main/body)`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        selectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'CSS selectors to target. Omit for auto-mode (main or body).',
        },
      },
      required: ['sessionName'],
    },
  },

  'scaffold_init': {
    handler: scaffold.init,
    description: `${SZKRABOK} Init szkrabok project (idempotent). Prerequisite for browser runs. minimal (default): config/deps; full: automation fixtures and Playwright specs`,
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Target directory. Defaults to cwd.' },
        name: { type: 'string', description: 'Package name. Defaults to dirname.' },
        preset: {
          type: 'string',
          enum: ['minimal', 'full'],
          description: 'minimal (default): config files only. full: + automation/fixtures.js + automation/example.spec.js + automation/example.mcp.spec.js',
        },
        install: {
          type: 'boolean',
          description: 'Run npm install after writing files. Default false.',
        },
      },
    },
  },

  'browser_run': {
    handler: szkrabokBrowser.run,
    description: `${PLAYWRIGHT_MCP} Execute Playwright JS on session page. Pass code (inline snippet) or path (named export from .mjs file with (page, args)). fn defaults to "default".`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        code: { type: 'string' },
        path: { type: 'string', description: 'Absolute or relative path to an .mjs script file' },
        fn: { type: 'string', description: 'Named export to call. Defaults to "default".' },
        args: { type: 'object', description: 'Arguments passed as second parameter to the function' },
      },
      required: ['sessionName'],
    },
  },

  'browser_run_test': {
    handler: szkrabokBrowser.run_test,
    description: `${PLAYWRIGHT_MCP} Worker concurrency. Default: Playwright. session_run_test overrides to 1`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        grep: { type: 'string', description: 'Filter tests by name (regex)' },
        params: {
          type: 'object',
          description:
            'Key/value params passed as uppercased env vars to the spec (e.g. {url:"https://..."} → URL)',
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
        workers: {
          type: 'number',
          description: 'Number of parallel workers. Defaults to Playwright config value. session_run_test forces workers:1.',
        },
        signalAttach: {
          type: 'boolean',
          description: 'Wait for fixture to confirm CDP attach before running tests. Default: false.',
        },
        keepOpen: {
          type: 'boolean',
          description:
            'After the test run, reconnect the session if the test subprocess invalidated the MCP context. Chrome stays alive; this restores the Playwright connection to it. Default false.',
        },
        reportFile: {
          type: 'string',
          description: 'Repo-relative JSON report path. Default: sessions/<sessionName>/last-run.json. Returns resolved path',
        },
      },
      required: ['sessionName'],
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
