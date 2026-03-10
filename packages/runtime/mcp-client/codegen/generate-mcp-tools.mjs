#!/usr/bin/env node

import { spawnClient } from '../runtime/transport.js';
import { renderTools, renderDts } from './render-tools.js';
import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'mcp-tools.js');
const DTS_PATH = join(__dirname, '..', 'mcp-tools.d.ts');

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
  const dts = renderDts({ tools, timestamp });

  async function writeIfChanged(path, next) {
    try {
      const existing = await readFile(path, 'utf8');
      if (existing === next) { console.log(`No changes: ${path}`); return; }
    } catch { /* file doesn't exist */ }
    await writeFile(path, next, 'utf8');
    console.log(`Generated ${path}`);
  }

  await writeIfChanged(OUTPUT_PATH, content);
  await writeIfChanged(DTS_PATH, dts);
  console.log(`Done. ${tools.length} tools.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
