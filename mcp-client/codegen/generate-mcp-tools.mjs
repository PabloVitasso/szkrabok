#!/usr/bin/env node

import { spawnClient } from '../runtime/transport.js';
import { renderTools } from './render-tools.js';
import { readFile, writeFile, stat } from 'fs/promises';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'mcp-tools.js');

/**
 * Compute registry hash.
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
}

async function main() {
  console.log('Spawning MCP server...');
  const client = await spawnClient();

  console.log('Fetching tool list...');
  const { tools } = await client.listTools();

  await client.close();

  console.log(`Found ${tools.length} tools`);

  const hash = registryHash(tools);
  const timestamp = new Date().toISOString();

  console.log(`Registry hash: ${hash}`);

  const content = renderTools({ tools, hash, timestamp });

  // Check if file exists and compare
  try {
    const existing = await readFile(OUTPUT_PATH, 'utf8');
    if (existing === content) {
      console.log('No changes.');
      return;
    }
  } catch {
    // File doesn't exist, proceed
  }

  await writeFile(OUTPUT_PATH, content, 'utf8');
  console.log(`Generated ${OUTPUT_PATH} with ${tools.length} tools.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
