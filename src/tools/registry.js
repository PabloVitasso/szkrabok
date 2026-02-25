import * as session from './szkrabok_session.js';
import * as navigate from './navigate.js';
import * as interact from './interact.js';
import * as extract from './extract.js';
import * as workflow from './workflow.js';
import * as browser from './playwright_mcp.js';
import * as szkrabokBrowser from './szkrabok_browser.js';
import { wrapError } from '../utils/errors.js';
import { logError } from '../utils/logger.js';

/* ----------------------------
   Tool Categories
---------------------------- */

const PLAYWRIGHT_MCP = '[playwright-mcp]';
const SZKRABOK = '[szkrabok]';

/* ----------------------------
   Szkrabok Tools (Session Management + Workflows)
---------------------------- */

const szkrabokTools = {
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
          description: 'Browser launch options — preset, stealth, headless, viewport, userAgent, locale, timezone, disableWebGL',
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

  'nav.goto': {
    handler: navigate.goto,
    description: `${SZKRABOK} Navigate to URL`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        url: { type: 'string' },
        wait: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'] },
      },
      required: ['sessionName', 'url'],
    },
  },

  'nav.back': {
    handler: navigate.back,
    description: `${SZKRABOK} Go back`,
    inputSchema: {
      type: 'object',
      properties: { sessionName: { type: 'string' } },
      required: ['sessionName'],
    },
  },

  'nav.forward': {
    handler: navigate.forward,
    description: `${SZKRABOK} Go forward`,
    inputSchema: {
      type: 'object',
      properties: { sessionName: { type: 'string' } },
      required: ['sessionName'],
    },
  },

  'interact.click': {
    handler: interact.click,
    description: `${SZKRABOK} Click element`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        selector: { type: 'string' },
      },
      required: ['sessionName', 'selector'],
    },
  },

  'interact.type': {
    handler: interact.type,
    description: `${SZKRABOK} Type text`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['sessionName', 'selector', 'text'],
    },
  },

  'interact.select': {
    handler: interact.select,
    description: `${SZKRABOK} Select dropdown option`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        selector: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['sessionName', 'selector', 'value'],
    },
  },

  'extract.text': {
    handler: extract.text,
    description: `${SZKRABOK} Extract text`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        selector: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'extract.html': {
    handler: extract.html,
    description: `${SZKRABOK} Extract HTML`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        selector: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'extract.screenshot': {
    handler: extract.screenshot,
    description: `${SZKRABOK} Take screenshot`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        path: { type: 'string' },
        fullPage: { type: 'boolean' },
      },
      required: ['sessionName'],
    },
  },

  'extract.evaluate': {
    handler: extract.evaluate,
    description: `${SZKRABOK} Execute JavaScript`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        code: { type: 'string' },
        args: { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['sessionName', 'code'],
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
};

/* ----------------------------
   Playwright MCP Tools (Core automation with refs)
---------------------------- */

const playwrightMcpTools = {
  'browser.snapshot': {
    handler: browser.snapshot,
    description: `${PLAYWRIGHT_MCP} Capture accessibility snapshot of the current page`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'browser.click': {
    handler: browser.click,
    description: `${PLAYWRIGHT_MCP} Click element using ref from snapshot`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
        doubleClick: { type: 'boolean' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        modifiers: { type: 'array', items: { type: 'string' } },
      },
      required: ['sessionName', 'ref', 'element'],
    },
  },

  'browser.type': {
    handler: browser.type,
    description: `${PLAYWRIGHT_MCP} Type text using ref from snapshot`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
        slowly: { type: 'boolean' },
      },
      required: ['sessionName', 'ref', 'text', 'element'],
    },
  },

  'browser.navigate': {
    handler: browser.navigate,
    description: `${PLAYWRIGHT_MCP} Navigate to URL and return an accessibility snapshot`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['sessionName', 'url'],
    },
  },

  'browser.navigate_back': {
    handler: browser.navigate_back,
    description: `${PLAYWRIGHT_MCP} Go back to the previous page`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'browser.close': {
    handler: browser.close,
    description: `${PLAYWRIGHT_MCP} Close the page`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'browser.drag': {
    handler: browser.drag,
    description: `${PLAYWRIGHT_MCP} Drag and drop between two elements`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        startElement: { type: 'string' },
        startRef: { type: 'string' },
        endElement: { type: 'string' },
        endRef: { type: 'string' },
      },
      required: ['sessionName', 'startRef', 'startElement', 'endRef', 'endElement'],
    },
  },

  'browser.hover': {
    handler: browser.hover,
    description: `${PLAYWRIGHT_MCP} Hover over element`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['sessionName', 'ref', 'element'],
    },
  },

  'browser.evaluate': {
    handler: browser.evaluate,
    description: `${PLAYWRIGHT_MCP} Evaluate JavaScript expression`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        function: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['sessionName', 'function'],
    },
  },

  'browser.select_option': {
    handler: browser.select_option,
    description: `${PLAYWRIGHT_MCP} Select option in dropdown`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
        values: { type: 'array', items: { type: 'string' } },
      },
      required: ['sessionName', 'ref', 'element', 'values'],
    },
  },

  'browser.fill_form': {
    handler: browser.fill_form,
    description: `${PLAYWRIGHT_MCP} Fill multiple form fields`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        fields: { type: 'array', items: { type: 'object' } },
      },
      required: ['sessionName', 'fields'],
    },
  },

  'browser.press_key': {
    handler: browser.press_key,
    description: `${PLAYWRIGHT_MCP} Press a key`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['sessionName', 'key'],
    },
  },

  'browser.take_screenshot': {
    handler: browser.take_screenshot,
    description: `${PLAYWRIGHT_MCP} Take screenshot`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        type: { type: 'string', enum: ['png', 'jpeg'] },
        filename: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
        fullPage: { type: 'boolean' },
      },
      required: ['sessionName'],
    },
  },

  'browser.wait_for': {
    handler: browser.wait_for,
    description: `${PLAYWRIGHT_MCP} Wait for a timeout, text to appear, or text to disappear`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        time: { type: 'number' },
        text: { type: 'string' },
        textGone: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'browser.resize': {
    handler: browser.resize,
    description: `${PLAYWRIGHT_MCP} Resize browser window`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['sessionName', 'width', 'height'],
    },
  },

  'browser.tabs': {
    handler: browser.tabs,
    description: `${PLAYWRIGHT_MCP} Manage tabs`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        action: { type: 'string', enum: ['list', 'new', 'close', 'select'] },
        index: { type: 'number' },
      },
      required: ['sessionName', 'action'],
    },
  },

  'browser.console_messages': {
    handler: browser.console_messages,
    description: `${PLAYWRIGHT_MCP} Get console messages`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        level: { type: 'string', enum: ['error', 'warning', 'info', 'debug'] },
      },
      required: ['sessionName'],
    },
  },

  'browser.network_requests': {
    handler: browser.network_requests,
    description: `${PLAYWRIGHT_MCP} List network requests`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        includeStatic: { type: 'boolean' },
      },
      required: ['sessionName'],
    },
  },

  'browser.file_upload': {
    handler: browser.file_upload,
    description: `${PLAYWRIGHT_MCP} Upload files`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['sessionName'],
    },
  },

  'browser.handle_dialog': {
    handler: browser.handle_dialog,
    description: `${PLAYWRIGHT_MCP} Handle dialog`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        accept: { type: 'boolean' },
        promptText: { type: 'string' },
      },
      required: ['sessionName', 'accept'],
    },
  },

  'browser.run_code': {
    handler: browser.run_code,
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
          description: 'Playwright project name to run (e.g. "automation"). Runs all projects if omitted.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File or directory paths passed as positional args to playwright test (e.g. ["automation/rebrowser-check.spec.js"] or ["automation/"]). Relative to repo root.',
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

  'browser.mouse_click_xy': {
    handler: browser.mouse_click_xy,
    description: `${PLAYWRIGHT_MCP} Click at coordinates`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['sessionName', 'element', 'x', 'y'],
    },
  },

  'browser.mouse_move_xy': {
    handler: browser.mouse_move_xy,
    description: `${PLAYWRIGHT_MCP} Move mouse to coordinates`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['sessionName', 'element', 'x', 'y'],
    },
  },

  'browser.mouse_drag_xy': {
    handler: browser.mouse_drag_xy,
    description: `${PLAYWRIGHT_MCP} Drag mouse between coordinates`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        startX: { type: 'number' },
        startY: { type: 'number' },
        endX: { type: 'number' },
        endY: { type: 'number' },
      },
      required: ['sessionName', 'element', 'startX', 'startY', 'endX', 'endY'],
    },
  },

  'browser.pdf_save': {
    handler: browser.pdf_save,
    description: `${PLAYWRIGHT_MCP} Save page as PDF`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        filename: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'browser.generate_locator': {
    handler: browser.generate_locator,
    description: `${PLAYWRIGHT_MCP} Generate locator for element`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['sessionName', 'ref', 'element'],
    },
  },

  'browser.verify_element_visible': {
    handler: browser.verify_element_visible,
    description: `${PLAYWRIGHT_MCP} Verify element is visible`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        role: { type: 'string' },
        accessibleName: { type: 'string' },
      },
      required: ['sessionName', 'role', 'accessibleName'],
    },
  },

  'browser.verify_text_visible': {
    handler: browser.verify_text_visible,
    description: `${PLAYWRIGHT_MCP} Verify text is visible`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['sessionName', 'text'],
    },
  },

  'browser.verify_list_visible': {
    handler: browser.verify_list_visible,
    description: `${PLAYWRIGHT_MCP} Verify list is visible`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['sessionName', 'ref', 'element', 'items'],
    },
  },

  'browser.verify_value': {
    handler: browser.verify_value,
    description: `${PLAYWRIGHT_MCP} Verify element value`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
        type: { type: 'string' },
        element: { type: 'string' },
        ref: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['sessionName', 'type', 'ref', 'element', 'value'],
    },
  },

  'browser.start_tracing': {
    handler: browser.start_tracing,
    description: `${PLAYWRIGHT_MCP} Start trace recording`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'browser.stop_tracing': {
    handler: browser.stop_tracing,
    description: `${PLAYWRIGHT_MCP} Stop trace recording`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionName: { type: 'string' },
      },
      required: ['sessionName'],
    },
  },

  'browser.install': {
    handler: browser.install,
    description: `${PLAYWRIGHT_MCP} Install browser`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
};

/* ----------------------------
   Combined tool registry
---------------------------- */

const baseTools = {
  ...szkrabokTools,
  ...playwrightMcpTools,
};

/* ----------------------------
   MCP registration
---------------------------- */

export const registerTools = () =>
  Object.entries(baseTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

/* ----------------------------
   Dispatcher
---------------------------- */

export const handleToolCall = async (name, args) => {
  const tool = baseTools[name];

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
