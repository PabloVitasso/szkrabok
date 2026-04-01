import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { initConfig, getConfig } from '../../config.js';
import {
  buildCandidates,
  populateCandidates,
  resolveChromium,
  validateCandidate,
} from '#runtime';

export function getGlobalConfigPath() {
  return process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'szkrabok', 'config.toml')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'szkrabok', 'config.toml');
}

export async function runDetect() {
  initConfig([]);
  let cfg;
  try {
    cfg = getConfig();
  } catch {
    cfg = {};
  }
  const candidates = buildCandidates({ executablePath: cfg.executablePath });
  await populateCandidates(candidates);
  const results = candidates.map(c => ({
    source: c.source, path: c.path, ...validateCandidate(c.path),
  }));
  const resolved = resolveChromium(candidates);
  const winner = resolved.found
    ? { found: true, path: resolved.path, source: resolved.source }
    : { found: false };
  return { winner, results };
}

export async function runInstall({ force = false } = {}) {
  // Convergence target: Playwright-managed Chromium is installed and resolvable.
  const { winner } = await runDetect();                                    // step 1: check current state

  if (winner.found && winner.source === 'playwright' && !force) {         // step 2: target already met
    console.log(`Playwright Chromium already installed: ${winner.path}`);
    return 0;
  }

  if (winner.found && winner.source !== 'playwright' && !force) {         // step 3: browser found, not target
    console.log(`Browser found via ${winner.source}: ${winner.path}`);
    console.log('To install Playwright-managed Chromium anyway: use --force');
    console.log('To pin this browser instead: szkrabok doctor detect --write-config');
    return 0;
  }

  // step 4: converge toward target — spawn npx playwright install chromium
  const exitCode = await new Promise((resolve) => {
    const proc = spawn('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });

    proc.on('error', (err) => {
      process.stderr.write(`\nFailed to run npx: ${err.message}\nRun: szkrabok doctor\n`);
      resolve(1);
    });

    proc.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {                                                    // step 6: install failed
    process.stderr.write(`\nInstallation failed (exit code ${exitCode}). Run: szkrabok doctor\n`);
    return exitCode;
  }

  // step 5: re-detect and print result + config hint
  const { winner: w2 } = await runDetect();
  if (w2.found && w2.source === 'playwright') {
    console.log(`\nChromium installed (playwright-managed).`);
    console.log(`  Path: ${w2.path}`);
    console.log(`\n  To use an existing browser instead of downloading next time:`);
    console.log(`    szkrabok doctor detect --write-config   (detect and save to config.toml)`);
    console.log(`    szkrabok doctor detect                  (see what was found without writing)`);
    console.log(`\n  To use an env var (current session only, not visible to MCP server):`);
    console.log(`    export CHROMIUM_PATH=/usr/bin/google-chrome`);
  } else if (w2.found) {
    console.log(`\nChromium resolved via ${w2.source}: ${w2.path}`);
    console.log(`  (playwright-managed binary not found — using ${w2.source} instead)`);
    console.log(`\n  To use an existing browser instead of downloading next time:`);
    console.log(`    szkrabok doctor detect --write-config   (detect and save to config.toml)`);
    console.log(`    export CHROMIUM_PATH=/usr/bin/google-chrome`);
  } else {
    process.stderr.write(
      `\nInstallation may have failed — playwright-managed Chromium not found after install.\n` +
      `Run: szkrabok doctor\n`
    );
    return 1;
  }

  return 0;
}

export async function writeExecPath(path) {
  const configPath = getGlobalConfigPath();

  // step 1: read lines (empty array if file absent)
  let lines;
  if (existsSync(configPath)) {
    lines = readFileSync(configPath, 'utf8').split('\n');
  } else {
    lines = [];
  }

  // step 2: count [default] sections
  const defaultSectionPattern = /^\[default\]\s*$/;
  const defaultCount = lines.filter(l => defaultSectionPattern.test(l)).length;
  if (defaultCount >= 2) {
    throw new Error('malformed config: multiple [default] sections');
  }

  // step 3: find defIdx (index of [default] line, -1 if absent)
  const defIdx = lines.findIndex(l => defaultSectionPattern.test(l));

  // step 4: find nextIdx — next section header after defIdx
  let nextIdx = lines.length;
  if (defIdx >= 0) {
    for (let i = defIdx + 1; i < lines.length; i++) {
      if (/^\[/.test(lines[i])) { nextIdx = i; break; }
    }
  }

  const execPattern = /^executablePath\s*=/;

  if (defIdx === -1) {
    // step 6: no [default] section — prepend
    lines = [`[default]`, `executablePath = "${path}"`, '', ...lines];
  } else {
    // step 5: search for executablePath within [default] block
    const sectionLines = lines.slice(defIdx + 1, nextIdx);
    const matches = sectionLines
      .map((l, i) => ({ l, i: defIdx + 1 + i }))
      .filter(({ l }) => execPattern.test(l));

    if (matches.length >= 2) {
      throw new Error('malformed config: multiple executablePath in [default]');
    } else if (matches.length === 1) {
      lines[matches[0].i] = `executablePath = "${path}"`;
    } else {
      lines.splice(defIdx + 1, 0, `executablePath = "${path}"`);
    }
  }

  // step 7: create dir if absent and write
  const configDir = configPath.slice(0, configPath.lastIndexOf('/'));
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  await writeFile(configPath, lines.join('\n'), 'utf8');

  return configPath;
}
