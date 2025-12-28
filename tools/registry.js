import * as session from './session.js'
import * as navigate from './navigate.js'
import * as interact from './interact.js'
import * as extract from './extract.js'
import * as workflow from './workflow.js'
import * as wait from './wait.js'
import { wrapError } from '../utils/errors.js'
import { logError } from '../utils/logger.js'

const tools = {
  // Session management
  'session.open': {
    handler: session.open,
    description: 'Open or resume a browser session',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        url: { type: 'string', description: 'Optional initial URL' },
        config: {
          type: 'object',
          description: 'Browser configuration (optional)',
          properties: {
            stealth: { type: 'boolean', default: true, description: 'Enable stealth mode' },
            viewport: {
              type: 'object',
              description: 'Viewport size (e.g., {width: 1280, height: 800})',
            },
            locale: { type: 'string', description: 'Browser locale (e.g., en-US)' },
            timezone: { type: 'string', description: 'Timezone (e.g., America/New_York)' },
          },
        },
      },
      required: ['id'],
    },
  },
  'session.close': {
    handler: session.close,
    description: 'Close and save session',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        save: { type: 'boolean', default: true, description: 'Whether to persist session state' },
      },
      required: ['id'],
    },
  },
  'session.list': {
    handler: session.list,
    description: 'List all sessions',
    inputSchema: { type: 'object', properties: {} },
  },
  'session.delete': {
    handler: session.deleteSession,
    description: 'Delete session permanently',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Session identifier' } },
      required: ['id'],
    },
  },

  // Navigation
  'nav.goto': {
    handler: navigate.goto,
    description: 'Navigate to URL',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        url: { type: 'string', description: 'URL to navigate to' },
        wait: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'Wait until event (default: domcontentloaded)',
        },
      },
      required: ['id', 'url'],
    },
  },
  'nav.back': {
    handler: navigate.back,
    description: 'Go back',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Session identifier' } },
      required: ['id'],
    },
  },
  'nav.forward': {
    handler: navigate.forward,
    description: 'Go forward',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Session identifier' } },
      required: ['id'],
    },
  },

  // Interaction
  'interact.click': {
    handler: interact.click,
    description: 'Click element',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        selector: { type: 'string', description: 'CSS selector of element to click' },
      },
      required: ['id', 'selector'],
    },
  },
  'interact.type': {
    handler: interact.type,
    description: 'Type text into element',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        selector: { type: 'string', description: 'CSS selector of input element' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['id', 'selector', 'text'],
    },
  },
  'interact.select': {
    handler: interact.select,
    description: 'Select dropdown option',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        selector: { type: 'string', description: 'CSS selector of select element' },
        value: { type: 'string', description: 'Value to select' },
      },
      required: ['id', 'selector', 'value'],
    },
  },

  // Extraction
  'extract.text': {
    handler: extract.text,
    description: 'Extract text content',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        selector: { type: 'string', description: 'CSS selector (optional, extracts whole page if omitted)' },
      },
      required: ['id'],
    },
  },
  'extract.html': {
    handler: extract.html,
    description: 'Extract HTML',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        selector: { type: 'string', description: 'CSS selector (optional, extracts whole page if omitted)' },
      },
      required: ['id'],
    },
  },
  'extract.screenshot': {
    handler: extract.screenshot,
    description: 'Take screenshot',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        path: { type: 'string', description: 'Save path for screenshot (optional)' },
        fullPage: { type: 'boolean', description: 'Capture full page (default: false)' },
      },
      required: ['id'],
    },
  },
  'extract.evaluate': {
    handler: extract.evaluate,
    description: 'Execute JavaScript',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        code: { type: 'string', description: 'JavaScript code to execute' },
        args: {
          type: 'array',
          items: {},
          description: 'Arguments to pass to the function (optional)',
        },
      },
      required: ['id', 'code'],
    },
  },

  // Workflows
  'workflow.login': {
    handler: workflow.login,
    description: 'Automated login',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        username: { type: 'string', description: 'Username or email' },
        password: { type: 'string', description: 'Password' },
        usernameSelector: {
          type: 'string',
          description: 'CSS selector for username field (optional, auto-detected)',
        },
        passwordSelector: {
          type: 'string',
          description: 'CSS selector for password field (optional, auto-detected)',
        },
        submitSelector: {
          type: 'string',
          description: 'CSS selector for submit button (optional, auto-detected)',
        },
      },
      required: ['id', 'username', 'password'],
    },
  },
  'workflow.fillForm': {
    handler: workflow.fillForm,
    description: 'Fill form fields',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        fields: {
          type: 'object',
          description: 'Object mapping CSS selectors to values',
        },
      },
      required: ['id', 'fields'],
    },
  },
  'workflow.scrape': {
    handler: workflow.scrape,
    description: 'Extract structured data',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        selectors: {
          type: 'object',
          description: 'Object mapping field names to CSS selectors',
        },
      },
      required: ['id', 'selectors'],
    },
  },

  // Wait operations
  'wait.forClose': {
    handler: wait.forClose,
    description: 'Wait for user to close browser window (no timeout)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
      },
      required: ['id'],
    },
  },
  'wait.forSelector': {
    handler: wait.forSelector,
    description: 'Wait for element to appear',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['id', 'selector'],
    },
  },
  'wait.forTimeout': {
    handler: wait.forTimeout,
    description: 'Wait for specified milliseconds',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session identifier' },
        ms: { type: 'number', description: 'Milliseconds to wait' },
      },
      required: ['id', 'ms'],
    },
  },
}

export const registerTools = () =>
  Object.entries(tools).map(([name, { description, inputSchema }]) => ({
    name,
    description,
    inputSchema,
  }))

export const handleToolCall = async (name, args) => {
  const tool = tools[name]
  if (!tool) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown tool' }) }],
      isError: true,
    }
  }

  try {
    const result = await tool.handler(args)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    }
  } catch (err) {
    logError(`Tool ${name} failed`, err, { args })
    return {
      content: [{ type: 'text', text: JSON.stringify(wrapError(err)) }],
      isError: true,
    }
  }
}