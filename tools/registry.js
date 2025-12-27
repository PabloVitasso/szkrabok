import * as session from './session.js'
import * as navigate from './navigate.js'
import * as interact from './interact.js'
import * as extract from './extract.js'
import * as workflow from './workflow.js'
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
                    properties: {
                        stealth: { type: 'boolean', default: true },
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

    // Navigation
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

    // Interaction
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
        description: 'Type text into element',
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

    // Extraction
    'extract.text': {
        handler: extract.text,
        description: 'Extract text content',
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
                args: { type: 'array' },
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
                id: { type: 'string' },
                username: { type: 'string' },
                password: { type: 'string' },
                usernameSelector: { type: 'string' },
                passwordSelector: { type: 'string' },
                submitSelector: { type: 'string' },
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
                id: { type: 'string' },
                fields: { type: 'object' },
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
                id: { type: 'string' },
                selectors: { type: 'object' },
            },
            required: ['id', 'selectors'],
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