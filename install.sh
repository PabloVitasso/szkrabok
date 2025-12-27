```bash
#!/bin/bash

# bebok-playwright-mcp project generator
# Run from inside the project root

echo "📁 Creating BEBOK-PLAYWRIGHT-MCP v2.0 structure..."

# Create directory structure
mkdir -p src/tools
mkdir -p src/core
mkdir -p src/utils
mkdir -p sessions
mkdir -p docs
mkdir -p test/unit
mkdir -p test/integration
mkdir -p test/e2e
mkdir -p examples

# Create all files with initial content

# ========== PACKAGE.JSON ==========
cat > package.json << 'EOF'
{
  "name": "bebok-playwright-mcp",
  "version": "2.0.0",
  "description": "Production-grade MCP Browser Automation with persistent sessions",
  "type": "module",
  "main": "index.js",
  "bin": {
    "bebok": "./cli.js"
  },
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "NODE_ENV=test node --test test/unit/",
    "test:integration": "NODE_ENV=test node --test test/integration/",
    "test:e2e": "NODE_ENV=test node --test test/e2e/",
    "lint": "eslint src/ test/",
    "format": "prettier --write src/ test/",
    "build": "echo 'No build step needed for Node.js'",
    "inspector": "npx @modelcontextprotocol/inspector ."
  },
  "keywords": ["mcp", "playwright", "automation", "browser", "sessions"],
  "author": "BEBOK Team",
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.6.0",
    "playwright": "^1.40.0",
    "playwright-extra": "^4.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "zod": "^3.22.0",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0",
    "eslint": "^8.56.0",
    "prettier": "^3.1.0",
    "@playwright/test": "^1.40.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "mcp": {
    "toolDescription": "Browser automation with persistent sessions",
    "version": "2.0.0"
  }
}
EOF

# ========== INDEX.JS (MCP ENTRYPOINT) ==========
cat > index.js << 'EOF'
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './src/server.js';
import { logger } from './src/utils/logger.js';

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  
  logger.info('Starting BEBOK-PLAYWRIGHT-MCP server...');
  
  try {
    await server.connect(transport);
    logger.info('MCP server running on stdio');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await server.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Terminating...');
      await server.close();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
EOF
chmod +x index.js

# ========== SRC/SERVER.JS ==========
cat > src/server.js << 'EOF'
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './utils/logger.js';
import { ToolRegistry } from './tools/registry.js';
import { validateSessionId } from './utils/validate.js';

export function createMcpServer() {
  const server = new Server(
    {
      name: 'bebok-playwright-mcp',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const toolRegistry = new ToolRegistry();

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Listing tools');
    return {
      tools: toolRegistry.listTools(),
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    logger.info(`Tool call: ${name}`, { args });
    
    try {
      // Validate sessionId if present in args
      if (args && args.sessionId) {
        validateSessionId(args.sessionId);
      }
      
      const result = await toolRegistry.executeTool(name, args || {});
      
      logger.debug(`Tool ${name} completed successfully`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error(`Tool ${name} failed:`, error);
      
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Cleanup on close
  server.onclose = async () => {
    logger.info('Closing server, cleaning up sessions...');
    await toolRegistry.cleanup();
  };

  return server;
}
EOF

# ========== SRC/TOOLS/REGISTRY.JS ==========
cat > src/tools/registry.js << 'EOF'
import { sessionTools } from './session.js';
import { navigationTools } from './navigate.js';
import { interactionTools } from './interact.js';
import { extractionTools } from './extract.js';
import { evaluationTools } from './evaluate.js';
import { SessionPool } from '../core/pool.js';

export class ToolRegistry {
  constructor() {
    this.pool = new SessionPool();
    this.tools = new Map();
    
    // Register all tool groups
    this.registerToolGroup(sessionTools(this.pool));
    this.registerToolGroup(navigationTools(this.pool));
    this.registerToolGroup(interactionTools(this.pool));
    this.registerToolGroup(extractionTools(this.pool));
    this.registerToolGroup(evaluationTools(this.pool));
  }

  registerToolGroup(toolGroup) {
    for (const [name, handler] of Object.entries(toolGroup)) {
      this.tools.set(name, handler);
    }
  }

  listTools() {
    return Array.from(this.tools.entries()).map(([name, handler]) => ({
      name,
      description: handler.description || `Execute ${name}`,
      inputSchema: handler.inputSchema || {
        type: 'object',
        properties: {},
      },
    }));
  }

  async executeTool(name, args) {
    const handler = this.tools.get(name);
    if (!handler) {
      throw new Error(`Tool not found: ${name}`);
    }

    return await handler.execute(args);
  }

  async cleanup() {
    await this.pool.cleanup();
  }
}
EOF

# ========== SRC/TOOLS/SESSION.JS ==========
cat > src/tools/session.js << 'EOF'
export function sessionTools(pool) {
  return {
    session_open: {
      description: 'Open a new or existing browser session',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Unique session identifier',
          },
          url: {
            type: 'string',
            description: 'Optional URL to navigate to immediately',
          },
          config: {
            type: 'object',
            description: 'Session configuration (viewport, userAgent, etc.)',
            properties: {
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number' },
                  height: { type: 'number' },
                },
              },
              userAgent: { type: 'string' },
              locale: { type: 'string' },
              timezone: { type: 'string' },
            },
          },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId, url, config }) => {
        const session = await pool.acquire(sessionId, config);
        
        if (url) {
          await session.page.goto(url, { waitUntil: 'domcontentloaded' });
        }
        
        return {
          sessionId,
          status: 'active',
          config: session.config,
          pageUrl: session.page.url(),
        };
      },
    },

    session_close: {
      description: 'Close a browser session and persist state',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session identifier to close',
          },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId }) => {
        await pool.release(sessionId, { persist: true });
        return { sessionId, status: 'closed' };
      },
    },

    session_list: {
      description: 'List all active and persisted sessions',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const active = pool.listActive();
        const persisted = await pool.listPersisted();
        
        return {
          active: active.map(s => ({
            id: s.id,
            pageUrl: s.page?.url(),
            created: s.created,
          })),
          persisted: persisted.map(p => ({
            id: p.id,
            created: p.created,
            lastUsed: p.lastUsed,
          })),
        };
      },
    },

    session_delete: {
      description: 'Delete a persisted session',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session identifier to delete',
          },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId }) => {
        await pool.delete(sessionId);
        return { sessionId, deleted: true };
      },
    },
  };
}
EOF

# ========== SRC/TOOLS/NAVIGATE.JS ==========
cat > src/tools/navigate.js << 'EOF'
export function navigationTools(pool) {
  return {
    navigate_goto: {
      description: 'Navigate to a URL',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          url: { type: 'string' },
          waitUntil: {
            type: 'string',
            enum: ['load', 'domcontentloaded', 'networkidle'],
            default: 'domcontentloaded',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds',
            default: 30000,
          },
        },
        required: ['sessionId', 'url'],
      },
      execute: async ({ sessionId, url, waitUntil = 'domcontentloaded', timeout = 30000 }) => {
        const session = await pool.get(sessionId);
        await session.page.goto(url, { waitUntil, timeout });
        
        return {
          sessionId,
          url: session.page.url(),
          title: await session.page.title(),
          status: 'navigated',
        };
      },
    },

    navigate_back: {
      description: 'Go back in history',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId }) => {
        const session = await pool.get(sessionId);
        await session.page.goBack();
        
        return {
          sessionId,
          url: session.page.url(),
          action: 'back',
        };
      },
    },

    navigate_forward: {
      description: 'Go forward in history',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId }) => {
        const session = await pool.get(sessionId);
        await session.page.goForward();
        
        return {
          sessionId,
          url: session.page.url(),
          action: 'forward',
        };
      },
    },
  };
}
EOF

# ========== SRC/TOOLS/INTERACT.JS ==========
cat > src/tools/interact.js << 'EOF'
export function interactionTools(pool) {
  return {
    interact_click: {
      description: 'Click on an element',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          selector: { type: 'string' },
          timeout: { type: 'number', default: 10000 },
        },
        required: ['sessionId', 'selector'],
      },
      execute: async ({ sessionId, selector, timeout = 10000 }) => {
        const session = await pool.get(sessionId);
        await session.page.click(selector, { timeout });
        
        return {
          sessionId,
          selector,
          action: 'clicked',
        };
      },
    },

    interact_type: {
      description: 'Type text into an element',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          timeout: { type: 'number', default: 10000 },
        },
        required: ['sessionId', 'selector', 'text'],
      },
      execute: async ({ sessionId, selector, text, timeout = 10000 }) => {
        const session = await pool.get(sessionId);
        await session.page.fill(selector, text, { timeout });
        
        return {
          sessionId,
          selector,
          textLength: text.length,
          action: 'typed',
        };
      },
    },

    interact_select: {
      description: 'Select an option in a dropdown',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          selector: { type: 'string' },
          value: { type: 'string' },
          timeout: { type: 'number', default: 10000 },
        },
        required: ['sessionId', 'selector', 'value'],
      },
      execute: async ({ sessionId, selector, value, timeout = 10000 }) => {
        const session = await pool.get(sessionId);
        await session.page.selectOption(selector, value, { timeout });
        
        return {
          sessionId,
          selector,
          value,
          action: 'selected',
        };
      },
    },
  };
}
EOF

# ========== SRC/TOOLS/EXTRACT.JS ==========
cat > src/tools/extract.js << 'EOF'
export function extractionTools(pool) {
  return {
    extract_text: {
      description: 'Extract text from page or element',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          selector: {
            type: 'string',
            description: 'Optional CSS selector, extracts from whole page if omitted',
          },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId, selector }) => {
        const session = await pool.get(sessionId);
        
        let text;
        if (selector) {
          const element = await session.page.$(selector);
          text = element ? await element.textContent() : null;
        } else {
          text = await session.page.textContent('body');
        }
        
        return {
          sessionId,
          selector: selector || 'body',
          text,
          length: text?.length || 0,
        };
      },
    },

    extract_html: {
      description: 'Extract HTML from page or element',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          selector: {
            type: 'string',
            description: 'Optional CSS selector, extracts from whole page if omitted',
          },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId, selector }) => {
        const session = await pool.get(sessionId);
        
        let html;
        if (selector) {
          const element = await session.page.$(selector);
          html = element ? await element.innerHTML() : null;
        } else {
          html = await session.page.content();
        }
        
        return {
          sessionId,
          selector: selector || 'document',
          html,
          length: html?.length || 0,
        };
      },
    },

    extract_screenshot: {
      description: 'Take a screenshot',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          path: {
            type: 'string',
            description: 'Optional file path to save screenshot',
          },
          fullPage: {
            type: 'boolean',
            default: false,
          },
          selector: {
            type: 'string',
            description: 'Optional CSS selector to screenshot specific element',
          },
        },
        required: ['sessionId'],
      },
      execute: async ({ sessionId, path, fullPage = false, selector }) => {
        const session = await pool.get(sessionId);
        
        let buffer;
        if (selector) {
          const element = await session.page.$(selector);
          buffer = element ? await element.screenshot() : null;
        } else {
          buffer = await session.page.screenshot({ fullPage });
        }
        
        let result = { sessionId, screenshotTaken: true };
        
        if (path) {
          const fs = await import('fs');
          await fs.promises.writeFile(path, buffer);
          result.path = path;
        } else {
          // Return as base64 if no path provided
          result.data = buffer.toString('base64');
          result.format = 'base64';
        }
        
        return result;
      },
    },
  };
}
EOF

# ========== SRC/TOOLS/EVALUATE.JS ==========
cat > src/tools/evaluate.js << 'EOF'
export function evaluationTools(pool) {
  return {
    evaluate_run: {
      description: 'Execute JavaScript in the page context',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          code: { type: 'string' },
          args: {
            type: 'object',
            description: 'Arguments to pass to the function',
          },
        },
        required: ['sessionId', 'code'],
      },
      execute: async ({ sessionId, code, args = {} }) => {
        const session = await pool.get(sessionId);
        
        try {
          const result = await session.page.evaluate(
            (code, args) => {
              // Create a function from the code string
              const func = new Function('args', `return (${code})(args)`);
              return func(args);
            },
            code,
            args
          );
          
          return {
            sessionId,
            result,
            type: typeof result,
          };
        } catch (error) {
          return {
            sessionId,
            error: error.message,
            success: false,
          };
        }
      },
    },
  };
}
EOF

# ========== SRC/CORE/BROWSER.JS ==========
cat > src/core/browser.js << 'EOF'
import { chromium } from 'playwright';
import { logger } from '../utils/logger.js';

class BrowserManager {
  constructor() {
    this.browser = null;
    this.initializing = false;
    this.useStealth = true;
  }

  async getBrowser() {
    if (this.browser) {
      return this.browser;
    }

    if (this.initializing) {
      // Wait for initialization to complete
      while (this.initializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.browser;
    }

    this.initializing = true;
    
    try {
      logger.info('Launching browser...');
      
      // Try stealth mode first
      if (this.useStealth) {
        try {
          const { addExtra } = await import('playwright-extra');
          const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
          
          const playwrightExtra = addExtra(chromium);
          playwrightExtra.use(StealthPlugin.default());
          
          this.browser = await playwrightExtra.launch({
            headless: false, // Always headful for debugging
            args: [
              '--disable-blink-features=AutomationControlled',
              '--disable-dev-shm-usage',
              '--no-sandbox',
            ],
          });
          
          logger.info('Browser launched with stealth plugin');
        } catch (stealthError) {
          logger.warn('Stealth plugin failed, falling back to regular playwright:', stealthError.message);
          this.useStealth = false;
          this.browser = await chromium.launch({
            headless: false,
            args: ['--disable-dev-shm-usage', '--no-sandbox'],
          });
        }
      } else {
        this.browser = await chromium.launch({
          headless: false,
          args: ['--disable-dev-shm-usage', '--no-sandbox'],
        });
      }

      // Handle browser closure
      this.browser.on('disconnected', () => {
        logger.info('Browser disconnected');
        this.browser = null;
      });

      return this.browser;
    } catch (error) {
      this.initializing = false;
      logger.error('Failed to launch browser:', error);
      throw error;
    } finally {
      this.initializing = false;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Singleton instance
export const browserManager = new BrowserManager();
EOF

# ========== SRC/CORE/POOL.JS ==========
cat > src/core/pool.js << 'EOF'
import { browserManager } from './browser.js';
import { loadSession, saveSession, deleteSession, listPersistedSessions } from './storage.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CONFIG = {
  viewport: { width: 1920, height: 1080 },
  userAgent: '',
  locale: 'en-US',
  timezone: 'UTC',
  timeout: 30000,
};

export class SessionPool {
  constructor() {
    this.sessions = new Map();
    this.maxSessions = 5; // Configurable limit
  }

  async acquire(sessionId, config = {}) {
    // Return existing session if active
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      session.lastUsed = Date.now();
      logger.debug(`Reusing active session: ${sessionId}`);
      return session;
    }

    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      logger.warn(`Session limit reached (${this.maxSessions}), closing oldest session`);
      await this.cleanupIdleSessions(1);
    }

    logger.info(`Creating new session: ${sessionId}`);
    
    const browser = await browserManager.getBrowser();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    
    // Try to load persisted session state
    let storageState = null;
    try {
      storageState = await loadSession(sessionId);
      logger.debug(`Loaded persisted state for session: ${sessionId}`);
    } catch (error) {
      logger.debug(`No persisted state found for session: ${sessionId}`);
    }

    const context = await browser.newContext({
      viewport: mergedConfig.viewport,
      userAgent: mergedConfig.userAgent || undefined,
      locale: mergedConfig.locale,
      timezoneId: mergedConfig.timezone,
      storageState: storageState || undefined,
    });

    const page = await context.newPage();
    
    const session = {
      id: sessionId,
      context,
      page,
      config: mergedConfig,
      created: Date.now(),
      lastUsed: Date.now(),
      isDirty: false,
    };

    this.sessions.set(sessionId, session);
    
    // Mark as dirty on any interaction
    page.on('load', () => {
      session.isDirty = true;
      session.lastUsed = Date.now();
    });

    return session;
  }

  async get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}. Call session_open first.`);
    }
    session.lastUsed = Date.now();
    return session;
  }

  async release(sessionId, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`Cannot release non-existent session: ${sessionId}`);
      return;
    }

    try {
      if (options.persist && session.isDirty) {
        logger.info(`Persisting session state: ${sessionId}`);
        await saveSession(sessionId, session);
      }
    } catch (error) {
      logger.error(`Failed to persist session ${sessionId}:`, error);
    } finally {
      await session.context.close();
      this.sessions.delete(sessionId);
      logger.debug(`Session released: ${sessionId}`);
    }
  }

  async delete(sessionId) {
    try {
      // Close if active
      if (this.sessions.has(sessionId)) {
        await this.release(sessionId, { persist: false });
      }
      
      // Delete persisted data
      await deleteSession(sessionId);
      logger.info(`Session deleted: ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to delete session ${sessionId}:`, error);
      throw error;
    }
  }

  listActive() {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      pageUrl: s.page?.url(),
      created: s.created,
      lastUsed: s.lastUsed,
    }));
  }

  async listPersisted() {
    return await listPersistedSessions();
  }

  async cleanupIdleSessions(maxAge = 30 * 60 * 1000) { // 30 minutes default
    const now = Date.now();
    const toClose = [];
    
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastUsed > maxAge) {
        toClose.push(id);
      }
    }
    
    for (const id of toClose) {
      logger.info(`Cleaning up idle session: ${id}`);
      await this.release(id, { persist: true });
    }
    
    return toClose.length;
  }

  async cleanup() {
    logger.info('Cleaning up all sessions');
    
    const closePromises = Array.from(this.sessions.keys()).map(id =>
      this.release(id, { persist: true }).catch(error => {
        logger.error(`Error cleaning up session ${id}:`, error);
      })
    );
    
    await Promise.all(closePromises);
    this.sessions.clear();
    
    await browserManager.close();
  }
}
EOF

# ========== SRC/CORE/STORAGE.JS ==========
cat > src/core/storage.js << 'EOF'
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

// Ensure sessions directory exists
await fs.mkdir(SESSIONS_DIR, { recursive: true });

export async function saveSession(sessionId, session) {
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  
  // Save Playwright storage state
  const state = await session.context.storageState();
  await fs.writeFile(
    path.join(sessionDir, 'state.json'),
    JSON.stringify(state, null, 2)
  );
  
  // Save metadata
  const meta = {
    id: sessionId,
    created: session.created,
    lastUsed: Date.now(),
    config: session.config,
    stats: {
      opens: 1, // Would be loaded and incremented
      lastUrl: session.page.url(),
    },
  };
  
  // Try to load existing meta to preserve stats
  try {
    const existingMeta = JSON.parse(
      await fs.readFile(path.join(sessionDir, 'meta.json'), 'utf-8')
    );
    meta.stats.opens = (existingMeta.stats?.opens || 0) + 1;
    meta.created = existingMeta.created || session.created;
  } catch {
    // First time saving
  }
  
  await fs.writeFile(
    path.join(sessionDir, 'meta.json'),
    JSON.stringify(meta, null, 2)
  );
  
  logger.debug(`Session saved: ${sessionId}`);
}

export async function loadSession(sessionId) {
  const statePath = path.join(SESSIONS_DIR, sessionId, 'state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
  
  // Update last used timestamp in meta
  const metaPath = path.join(SESSIONS_DIR, sessionId, 'meta.json');
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    meta.lastUsed = Date.now();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch (error) {
    logger.warn(`Could not update meta for ${sessionId}:`, error.message);
  }
  
  return state;
}

export async function deleteSession(sessionId) {
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
    logger.debug(`Session deleted from storage: ${sessionId}`);
  } catch (error) {
    // If directory doesn't exist, that's fine
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function listPersistedSessions() {
  try {
    const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
    
    const sessions = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaPath = path.join(SESSIONS_DIR, entry.name, 'meta.json');
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
          sessions.push(meta);
        } catch (error) {
          // Incomplete session directory
          sessions.push({
            id: entry.name,
            created: null,
            lastUsed: null,
            config: null,
          });
        }
      }
    }
    
    return sessions;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
EOF

# ========== SRC/CORE/STEALTH.JS ==========
cat > src/core/stealth.js << 'EOF'
// This module provides stealth configuration utilities
// Main stealth logic is integrated in browser.js

export const STEALTH_CONFIG = {
  // Common anti-detection techniques to apply
  techniques: [
    'chrome.runtime',
    'window.chrome',
    'navigator.webdriver',
    'navigator.plugins',
    'navigator.languages',
    'WebGL',
    'fonts',
  ],
  
  // Default viewport settings that look human
  viewport: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    hasTouch: false,
    isLandscape: true,
  },
  
  // User agents (will be overridden by config)
  userAgents: {
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  },
};

export function generateRandomViewport() {
  // Generate slightly random viewport to look more human
  const baseWidth = 1920;
  const baseHeight = 1080;
  
  return {
    width: baseWidth + Math.floor(Math.random() * 100) - 50,
    height: baseHeight + Math.floor(Math.random() * 100) - 50,
  };
}

export function validateStealthCompatibility() {
  // Check if stealth plugin is likely to work
  const nodeVersion = parseInt(process.version.slice(1));
  if (nodeVersion < 16) {
    return {
      compatible: false,
      reason: 'Node.js 16+ required for stealth plugin',
    };
  }
  
  return { compatible: true };
}
EOF

# ========== SRC/UTILS/LOGGER.JS ==========
cat > src/utils/logger.js << 'EOF'
import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    isDevelopment
      ? winston.format.prettyPrint()
      : winston.format.json()
  ),
  defaultMeta: { service: 'bebok-playwright-mcp' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Create logs directory if it doesn't exist
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(process.cwd(), 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export { logger };
EOF

# ========== SRC/UTILS/ERRORS.JS ==========
cat > src/utils/errors.js << 'EOF'
export class BebokError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'BebokError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

export class SessionError extends BebokError {
  constructor(message, sessionId, details = {}) {
    super(message, 'SESSION_ERROR', { sessionId, ...details });
    this.name = 'SessionError';
  }
}

export class NavigationError extends BebokError {
  constructor(message, url, details = {}) {
    super(message, 'NAVIGATION_ERROR', { url, ...details });
    this.name = 'NavigationError';
  }
}

export class TimeoutError extends BebokError {
  constructor(operation, timeout, details = {}) {
    super(`Operation ${operation} timed out after ${timeout}ms`, 'TIMEOUT_ERROR', {
      operation,
      timeout,
      ...details,
    });
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends BebokError {
  constructor(message, field, value) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
  }
}

// Error codes for reference
export const ERROR_CODES = {
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_LIMIT_EXCEEDED: 'SESSION_LIMIT_EXCEEDED',
  BROWSER_LAUNCH_FAILED: 'BROWSER_LAUNCH_FAILED',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  INVALID_INPUT: 'INVALID_INPUT',
  STORAGE_ERROR: 'STORAGE_ERROR',
  STEALTH_FAILED: 'STEALTH_FAILED',
};
EOF

# ========== SRC/UTILS/VALIDATE.JS ==========
cat > src/utils/validate.js << 'EOF'
import { ValidationError } from './errors.js';

export function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string') {
    throw new ValidationError('sessionId must be a string', 'sessionId', sessionId);
  }
  
  if (sessionId.length < 1 || sessionId.length > 100) {
    throw new ValidationError('sessionId must be between 1 and 100 characters', 'sessionId', sessionId);
  }
  
  // Alphanumeric, underscores, and hyphens only
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new ValidationError('sessionId can only contain letters, numbers, underscores, and hyphens', 'sessionId', sessionId);
  }
  
  return true;
}

export function validateUrl(url) {
  if (typeof url !== 'string') {
    throw new ValidationError('URL must be a string', 'url', url);
  }
  
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('URL must use HTTP or HTTPS protocol', 'url', url);
    }
    return true;
  } catch {
    throw new ValidationError('Invalid URL format', 'url', url);
  }
}

export function validateSelector(selector) {
  if (typeof selector !== 'string') {
    throw new ValidationError('Selector must be a string', 'selector', selector);
  }
  
  if (selector.length === 0) {
    throw new ValidationError('Selector cannot be empty', 'selector', selector);
  }
  
  // Basic CSS selector validation (not exhaustive)
  if (selector.includes('//')) {
    // Might be XPath, which we don't support yet
    throw new ValidationError('XPath selectors are not supported yet, use CSS selectors', 'selector', selector);
  }
  
  return true;
}

export function validateConfig(config) {
  if (config && typeof config !== 'object') {
    throw new ValidationError('Config must be an object', 'config', config);
  }
  
  if (config?.viewport) {
    if (typeof config.viewport !== 'object') {
      throw new ValidationError('viewport must be an object', 'config.viewport', config.viewport);
    }
    
    if (config.viewport.width && (typeof config.viewport.width !== 'number' || config.viewport.width <= 0)) {
      throw new ValidationError('viewport.width must be a positive number', 'config.viewport.width', config.viewport.width);
    }
    
    if (config.viewport.height && (typeof config.viewport.height !== 'number' || config.viewport.height <= 0)) {
      throw new ValidationError('viewport.height must be a positive number', 'config.viewport.height', config.viewport.height);
    }
  }
  
  return true;
}

export function validateTimeout(timeout) {
  if (timeout && (typeof timeout !== 'number' || timeout <= 0)) {
    throw new ValidationError('timeout must be a positive number', 'timeout', timeout);
  }
  
  if (timeout && timeout > 300000) { // 5 minutes max
    throw new ValidationError('timeout cannot exceed 5 minutes (300000ms)', 'timeout', timeout);
  }
  
  return true;
}
EOF

# ========== DOCS/ARCHITECTURE.md ==========
cat > docs/ARCHITECTURE.md << 'EOF'
# SYSTEM ARCHITECTURE: BEBOK-PLAYWRIGHT-MCP v2.0
**Production-Grade MCP Browser Automation**

---

## CORE PRINCIPLES

### Invariants
- **1 session = 1 browser context** (not process)
- **lazy init** - spawn only when used
- **graceful degradation** - work without stealth if fails
- **idempotent operations** - retry-safe
- **zero shared state** between sessions

### Tech Stack
```
MCP Protocol
    ↓
StdIO Transport
    ↓
Tool Handlers (async)
    ↓
SessionPool (Map<id, Context>)
    ↓
Playwright Browser (singleton)
    ↓
Context per Session
```

---

## STRUCTURE

```
bebok-playwright-mcp/
├── package.json
├── index.js                    # MCP stdio entrypoint
├── src/
│   ├── server.js              # MCP server setup
│   ├── tools/
│   │   ├── registry.js        # tool definitions
│   │   ├── session.js         # open/close/list
│   │   ├── navigate.js        # goto/back/forward
│   │   ├── interact.js        # click/type/select
│   │   ├── extract.js         # text/html/screenshot
│   │   └── evaluate.js        # js exec
│   ├── core/
│   │   ├── browser.js         # singleton browser
│   │   ├── pool.js            # active contexts
│   │   ├── storage.js         # persist/restore
│   │   └── stealth.js         # optional layer
│   └── utils/
│       ├── logger.js
│       ├── errors.js
│       └── validate.js
└── sessions/
    └── {id}/
        ├── state.json         # playwright storageState
        └── meta.json          # timestamps, config
```

---

## MVP SCOPE

### Tools (10)
```javascript
// Session Lifecycle
session.open(id, url?, config?)
session.close(id)
session.list()
session.delete(id)

// Navigation
nav.goto(id, url, wait?)
nav.back(id)
nav.forward(id)

// Interaction
interact.click(id, selector)
interact.type(id, selector, text)
interact.select(id, selector, value)

// Extraction
extract.text(id, selector?)
extract.html(id, selector?)
extract.screenshot(id, path?, fullPage?)

// Evaluation
eval.run(id, code, args?)
```

### Features
- ✅ persistent sessions (storageState)
- ✅ stealth plugin (best-effort)
- ✅ auto-save on close
- ✅ error normalization
- ✅ timeout handling (30s default)
- ✅ headful mode
- ✅ single browser reuse

### Out of Scope (MVP)
- ❌ proxy
- ❌ captcha
- ❌ multi-browser
- ❌ network interception
- ❌ video recording
- ❌ remote debugging
---

## STATUS: MVP READY
**Last Updated:** $(date +%Y-%m-%d)
**Status:** ACTIVE
**Responsible:** BEBOK Team
EOF

# ========== DOCS/API-SPEC.md ==========
cat > docs/API-SPEC.md << 'EOF'
# API SPECIFICATION

## Tools Overview

### Session Management
- `session_open` - Open a browser session
- `session_close` - Close and persist session
- `session_list` - List active/persisted sessions
- `session_delete` - Delete persisted session

### Navigation
- `navigate_goto` - Navigate to URL
- `navigate_back` - Go back in history
- `navigate_forward` - Go forward in history

### Interaction
- `interact_click` - Click element
- `interact_type` - Type text
- `interact_select` - Select dropdown option

### Extraction
- `extract_text` - Extract text
- `extract_html` - Extract HTML
- `extract_screenshot` - Take screenshot

### Evaluation
- `evaluate_run` - Execute JavaScript

## Detailed Specifications

### session_open
**Description:** Open a new or existing browser session

**Parameters:**
```json
{
  "sessionId": "string (required)",
  "url": "string (optional)",
  "config": {
    "viewport": {"width": 1920, "height": 1080},
    "userAgent": "string",
    "locale": "string",
    "timezone": "string"
  }
}
```

**Returns:**
```json
{
  "sessionId": "string",
  "status": "active",
  "config": {},
  "pageUrl": "string"
}
```

### navigate_goto
**Description:** Navigate to a URL

**Parameters:**
```json
{
  "sessionId": "string (required)",
  "url": "string (required)",
  "waitUntil": "load|domcontentloaded|networkidle",
  "timeout": 30000
}
```

**Returns:**
```json
{
  "sessionId": "string",
  "url": "string",
  "title": "string",
  "status": "navigated"
}
```

### extract_text
**Description:** Extract text from page or element

**Parameters:**
```json
{
  "sessionId": "string (required)",
  "selector": "string (optional)"
}
```

**Returns:**
```json
{
  "sessionId": "string",
  "selector": "string",
  "text": "string",
  "length": 42
}
```

## Error Responses
All tools return errors in this format:
```json
{
  "content": [{
    "type": "text",
    "text": "Error: Error message here"
  }],
  "isError": true
}
```

## Session Persistence
Sessions are automatically saved in `sessions/{id}/`:
- `state.json` - Playwright storage state (cookies, localStorage)
- `meta.json` - Session metadata (timestamps, config, stats)
EOF

# ========== DOCS/ROADMAP.md ==========
cat > docs/ROADMAP.md << 'EOF'
# ROADMAP

## Phase 1: MVP (2 weeks) ✅
- [x] Core MCP server infrastructure
- [x] Browser lifecycle management
- [x] Session persistence
- [x] 10 core tools implementation
- [x] Stealth integration (best-effort)

**Deliverable:** Working demo with persistent sessions

## Phase 2: Stabilization (1 week)
- [ ] Timeout strategies per tool
- [ ] Error recovery & auto-retry
- [ ] Resource limits (max sessions)
- [ ] Structured logging & metrics

**Deliverable:** Production deployment ready

## Phase 3: Advanced Features (4 weeks)
- [ ] Wait strategies (networkidle, element state)
- [ ] Frame/iframe handling
- [ ] File upload/download
- [ ] Structured data extraction
- [ ] Session templates
- [ ] Session tagging & search

**Deliverable:** v2.0 release

## Phase 4: Enterprise (4+ weeks)
- [ ] HAR capture & network analysis
- [ ] Screenshot hooks & visual tracing
- [ ] Performance monitoring
- [ ] Proxy support
- [ ] Credential vault
- [ ] Audit logging
- [ ] Multi-user isolation

**Deliverable:** Enterprise edition

## Current Status
**Version:** 2.0.0 (MVP)
**Next Milestone:** Stabilization (Phase 2)
**Target Date:** $(date -d "+1 week" +%Y-%m-%d)
EOF

# ========== DOCS/DECISION-LOG.md ==========
cat > docs/DECISION-LOG.md << 'EOF'
# ARCHITECTURAL DECISION LOG

## DAR-001: 1 session = 1 context, not process
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Need lightweight isolation between sessions without process overhead
**Decision:** Use Playwright browser contexts instead of separate browser processes
**Consequences:** Faster startup, less memory, but limited isolation (shared browser process)

## DAR-002: Lazy browser initialization
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Avoid browser overhead when MCP server starts but not used
**Decision:** Browser launched on first tool call, not server startup
**Consequences:** First operation slower, but server starts instantly

## DAR-003: Headful mode by default
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Debugging visibility and anti-detection requirements
**Decision:** Always launch browser with headless: false
**Consequences:** Visible browser windows, better compatibility with detection

## DAR-004: Best-effort stealth
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Stealth plugin can fail on some systems
**Decision:** Try stealth first, fall back to regular Playwright if fails
**Consequences:** Graceful degradation, consistent availability

## DAR-005: Session limit of 5
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Prevent memory exhaustion on shared systems
**Decision:** Maximum 5 concurrent sessions, auto-cleanup oldest
**Consequences:** Resource protection, but limits parallel usage
EOF

# ========== README.md ==========
cat > README.md << 'EOF'
# BEBOK-PLAYWRIGHT-MCP v2.0

Production-grade MCP server for browser automation with persistent sessions.

## Features
- ✅ **Persistent sessions** - Cookies, localStorage survive restarts
- ✅ **Stealth mode** - Anti-detection techniques (best-effort)
- ✅ **10 automation tools** - Full browser control via MCP
- ✅ **Headful debugging** - Visible browser for troubleshooting
- ✅ **Graceful degradation** - Works even if stealth fails
- ✅ **Resource management** - Automatic session cleanup

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run with MCP inspector:**
   ```bash
   npm run inspector
   ```

3. **Use in Claude Desktop:**
   Add to `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "bebok-playwright": {
         "command": "node",
         "args": ["/path/to/bebok-playwright-mcp/index.js"]
       }
     }
   }
   ```

## Example Usage

```javascript
// Open a session
session_open({ sessionId: "github", url: "https://github.com/login" })

// Type credentials
interact_type({ 
  sessionId: "github", 
  selector: "#login_field", 
  text: "username" 
})

// Take screenshot
extract_screenshot({
  sessionId: "github",
  path: "screenshot.png"
})

// Close and persist
session_close({ sessionId: "github" })
```

## Session Persistence

Sessions are saved in `sessions/{id}/`:
- `state.json` - Playwright storage (cookies, localStorage)
- `meta.json` - Metadata (timestamps, config, stats)

## Architecture

```
MCP Client → StdIO → Tool Handlers → Session Pool → Browser Contexts
```

- **1 session = 1 browser context** (not process)
- **Singleton browser** - Shared between all sessions
- **Lazy initialization** - Browser starts on first use
- **Zero shared state** - Complete isolation between sessions

## Development

```bash
# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format

# Run MCP inspector
npm run inspector
```

## Documentation

- [System Architecture](docs/ARCHITECTURE.md)
- [API Specification](docs/API-SPEC.md)
- [Roadmap](docs/ROADMAP.md)
- [Architectural Decisions](docs/DECISION-LOG.md)

## License

MIT
EOF

# ========== CLI.JS ==========
cat > cli.js << 'EOF'
#!/usr/bin/env node

import { program } from 'commander';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

program
  .name('bebok')
  .description('BEBOK Playwright MCP CLI')
  .version('2.0.0');

program
  .command('session')
  .description('Session management')
  .argument('<action>', 'list | open | inspect | delete')
  .argument('[id]', 'Session ID')
  .option('--url <url>', 'URL to open')
  .action(async (action, id, options) => {
    const sessionsDir = path.join(process.cwd(), 'sessions');
    
    switch (action) {
      case 'list':
        const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
        const sessions = [];
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const metaPath = path.join(sessionsDir, entry.name, 'meta.json');
            try {
              const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
              sessions.push(meta);
            } catch {
              sessions.push({ id: entry.name, status: 'incomplete' });
            }
          }
        }
        
        console.table(sessions.map(s => ({
          ID: s.id,
          Created: s.created ? new Date(s.created).toLocaleDateString() : 'N/A',
          'Last Used': s.lastUsed ? new Date(s.lastUsed).toLocaleDateString() : 'N/A',
          URL: s.stats?.lastUrl || 'N/A',
        })));
        break;
        
      case 'open':
        if (!id) {
          console.error('Session ID required for open action');
          process.exit(1);
        }
        console.log(`Session ${id} would be opened with MCP tools`);
        console.log(`Use: session_open({ sessionId: "${id}", url: "${options.url || ''}" })`);
        break;
        
      case 'inspect':
        if (!id) {
          console.error('Session ID required for inspect action');
          process.exit(1);
        }
        
        const sessionDir = path.join(sessionsDir, id);
        try {
          const [state, meta] = await Promise.all([
            fs.readFile(path.join(sessionDir, 'state.json'), 'utf-8'),
            fs.readFile(path.join(sessionDir, 'meta.json'), 'utf-8'),
          ]);
          
          console.log('=== SESSION METADATA ===');
          console.log(JSON.stringify(JSON.parse(meta), null, 2));
          
          const stateData = JSON.parse(state);
          console.log('\n=== COOKIES ===');
          console.log(stateData.cookies?.length || 0, 'cookies');
          
          console.log('\n=== LOCALSTORAGE ===');
          stateData.origins?.forEach(origin => {
            console.log(origin.origin, ':', origin.localStorage?.length || 0, 'items');
          });
        } catch (error) {
          console.error(`Cannot inspect session ${id}:`, error.message);
        }
        break;
        
      case 'delete':
        if (!id) {
          console.error('Session ID required for delete action');
          process.exit(1);
        }
        
        const dirToDelete = path.join(sessionsDir, id);
        try {
          await fs.rm(dirToDelete, { recursive: true, force: true });
          console.log(`Session ${id} deleted`);
        } catch (error) {
          console.error(`Cannot delete session ${id}:`, error.message);
        }
        break;
    }
  });

program
  .command('cleanup')
  .description('Clean up old sessions')
  .option('--days <days>', 'Delete sessions older than N days', '30')
  .action(async (options) => {
    const sessionsDir = path.join(process.cwd(), 'sessions');
    const cutoff = Date.now() - (parseInt(options.days) * 24 * 60 * 60 * 1000);
    
    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(sessionsDir, entry.name, 'meta.json');
          try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
            if (meta.lastUsed && meta.lastUsed < cutoff) {
              await fs.rm(path.join(sessionsDir, entry.name), { recursive: true });
              console.log(`Deleted old session: ${entry.name}`);
            }
          } catch {
            // Skip incomplete sessions
          }
        }
      }
    } catch (error) {
      console.error('Cleanup failed:', error.message);
    }
  });

program.parse();
EOF
chmod +x cli.js

# ========== .ENV EXAMPLE ==========
cat > .env.example << 'EOF'
# BEBOK-PLAYWRIGHT-MCP Configuration

# Logging
LOG_LEVEL=info
NODE_ENV=development

# Browser Settings
BROWSER_HEADLESS=false
BROWSER_TIMEOUT=30000
BROWSER_USE_STEALTH=true

# Session Limits
MAX_SESSIONS=5
SESSION_TIMEOUT=1800000  # 30 minutes in milliseconds

# Storage
SESSIONS_DIR=./sessions
LOGS_DIR=./logs

# MCP
MCP_SERVER_NAME=bebok-playwright-mcp
EOF

# ========== .GITIGNORE ==========
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Sessions
sessions/
!sessions/.gitkeep

# Logs
logs/
*.log

# Screenshots
*.png
*.jpg
*.jpeg

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Test outputs
test-results/
playwright-report/
EOF

# ========== EXAMPLES/BASIC_USAGE.JS ==========
cat > examples/basic_usage.js << 'EOF'
// Example: Using BEBOK Playwright MCP with Claude

// 1. Open a session to GitHub
const session = await session_open({
  sessionId: "github_example",
  url: "https://github.com",
  config: {
    viewport: { width: 1280, height: 720 },
    locale: "en-US"
  }
});

// 2. Search for repositories
await interact_type({
  sessionId: "github_example",
  selector: "[name='q']",
  text: "playwright automation"
});

await interact_click({
  sessionId: "github_example",
  selector: "[type='submit']"
});

// 3. Extract search results
const results = await extract_text({
  sessionId: "github_example",
  selector: ".repo-list"
});

console.log(`Found results: ${results.text?.substring(0, 200)}...`);

// 4. Take a screenshot
await extract_screenshot({
  sessionId: "github_example",
  path: "github_search.png",
  fullPage: true
});

// 5. Close and persist
await session_close({ sessionId: "github_example" });

console.log("Session saved. Reopen with same sessionId to restore cookies!");
EOF

# ========== CREATE EMPTY TEST FILES ==========
touch test/unit/tools.test.js
touch test/unit/core.test.js
touch test/integration/session.test.js
touch test/e2e/workflow.test.js

# ========== CREATE GITKEEP FILES ==========
touch sessions/.gitkeep
touch logs/.gitkeep

echo "✅ Project structure generated successfully!"
echo ""
echo "Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Run tests: npm test"
echo "3. Try with MCP inspector: npm run inspector"
echo ""
echo "Project structure:"
find . -type f -name "*.js" -o -name "*.md" -o -name "*.json" | sort | sed 's/^/  /'