import * as session from './session.js'
import * as navigate from './navigate.js'
import * as interact from './interact.js'
import * as extract from './extract.js'
import * as workflow from './workflow.js'
import { wrapError } from '../utils/errors.js'
import { logError } from '../utils/logger.js'

/* ----------------------------
   Base tools (canonical)
---------------------------- */

const baseTools = {
  'session.open': {
    handler: session.open,
    description: 'Open or resume a browser session',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        url: { type: 'string' },
        config: {
          type: 'object',
          properties: {
            stealth: { type: 'boolean', default: true },
            disableWebGL: { type: 'boolean', default: false },
            headless: { type: 'boolean' },
            viewport: { type: 'object' },
            locale: { type: 'string' },
            timezone: { type: 'string' },
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
        id: { type: 'string' },
        save: { type: 'boolean', default: true },
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
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  'nav.goto': {
    handler: navigate.goto,
    description: 'Navigate to URL',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        url: { type: 'string' },
        wait: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'] },
      },
      required: ['id', 'url'],
    },
  },

  'nav.back': {
    handler: navigate.back,
    description: 'Go back',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  'nav.forward': {
    handler: navigate.forward,
    description: 'Go forward',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  'interact.click': {
    handler: interact.click,
    description: 'Click element',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        selector: { type: 'string' },
      },
      required: ['id', 'selector'],
    },
  },

  'interact.type': {
    handler: interact.type,
    description: 'Type text',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
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
        id: { type: 'string' },
        selector: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['id', 'selector', 'value'],
    },
  },

  'extract.text': {
    handler: extract.text,
    description: 'Extract text',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        selector: { type: 'string' },
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
        id: { type: 'string' },
        selector: { type: 'string' },
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
        id: { type: 'string' },
        path: { type: 'string' },
        fullPage: { type: 'boolean' },
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
        id: { type: 'string' },
        code: { type: 'string' },
        args: { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['id', 'code'],
    },
  },

  'workflow.login': {
    handler: workflow.login,
    description: 'Automated login',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
      },
      required: ['id', 'username', 'password'],
    },
  },

  'workflow.fillForm': {
    handler: workflow.fillForm,
    description: 'Fill form',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        fields: { type: 'object' },
      },
      required: ['id', 'fields'],
    },
  },

  'workflow.scrape': {
    handler: workflow.scrape,
    description: 'Scrape structured data',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        selectors: { type: 'object' },
      },
      required: ['id', 'selectors'],
    },
  },
}

/* ----------------------------
   Alias expansion (correct)
---------------------------- */

const toolLookup = {}

for (const [realName, def] of Object.entries(baseTools)) {
  const aliases = [
    realName,
    realName.replace(/\./g, '_'),
    realName.replace(/\./g, ''),
  ]

  for (const name of aliases) {
    toolLookup[name] = {
      ...def,
      realName,
    }
  }
}

/* ----------------------------
   MCP registration
---------------------------- */

export const registerTools = () =>
  Object.entries(toolLookup).map(([name, tool]) => ({
    name,
    description:
      name === tool.realName
        ? tool.description
        : `alias of ${tool.realName} — ${tool.description}`,
    inputSchema: tool.inputSchema,
  }))

/* ----------------------------
   Dispatcher
---------------------------- */

export const handleToolCall = async (name, args) => {
  const tool = toolLookup[name]

  if (!tool) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
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
