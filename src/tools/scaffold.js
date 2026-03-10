import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { spawn } from 'node:child_process';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const PLAYWRIGHT_CONFIG = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './automation',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { headless: false },
});
`;

const EXAMPLE_SPEC = `import { test, expect } from '@playwright/test';

test('example', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example Domain/);
});
`;

const TOML_EXAMPLE = `# szkrabok.config.local.toml
# Machine-specific overrides. Copy this file to szkrabok.config.local.toml and edit.
# This file is gitignored — never commit credentials or paths.

[default]
# executablePath = "/path/to/chrome"  # run: bash scripts/detect_browsers.sh
# log_level = "info"
`;

async function createFileAtomic(path, content) {
  try {
    await writeFile(path, content, { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

async function writeJsonAtomic(path, obj) {
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await rename(tmp, path);
}

function mergePackageJson(existing, name) {
  const base = {
    name,
    type: 'module',
    scripts: { test: 'playwright test' },
    dependencies: {
      '@szkrabok/runtime': 'latest',
      
    },
    devDependencies: {
      '@playwright/test': '^1.49.1',
    },
  };

  if (!existing) return base;

  return {
    ...existing,
    type: existing.type ?? base.type,
    scripts: { ...base.scripts, ...existing.scripts },
    dependencies: { ...base.dependencies, ...(existing.dependencies ?? {}) },
    devDependencies: { ...base.devDependencies, ...(existing.devDependencies ?? {}) },
  };
}

function npmInstall(dir) {
  return new Promise(resolve => {
    const child = spawn(npmBin, ['install'], { cwd: dir, stdio: 'inherit' });
    child.on('close', code => resolve(code === 0 ? null : `npm install exited ${code}`));
    child.on('error', err => resolve(`npm install failed: ${err.message}`));
  });
}

export async function init(args = {}) {
  const { dir: rawDir, name, preset = 'minimal', install = false } = args;

  const dir = rawDir ? resolve(rawDir) : process.cwd();
  const pkgName = name ?? basename(dir);

  const created = [];
  const skipped = [];
  const merged = [];
  const warnings = [];

  // playwright.config.js
  const configDest = join(dir, 'playwright.config.js');
  if (await createFileAtomic(configDest, PLAYWRIGHT_CONFIG))
    created.push('playwright.config.js');
  else
    skipped.push('playwright.config.js');

  // package.json
  const pkgDest = join(dir, 'package.json');
  let existing = null;

  if (existsSync(pkgDest)) {
    try {
      existing = JSON.parse(await readFile(pkgDest, 'utf8'));
    } catch {
      warnings.push('package.json invalid JSON — skipped');
      skipped.push('package.json');
    }
  }

  if (!skipped.includes('package.json')) {
    const mergedPkg = mergePackageJson(existing, pkgName);
    await writeJsonAtomic(pkgDest, mergedPkg);
    existing ? merged.push('package.json') : created.push('package.json');
  }

  // toml example
  const tomlDest = join(dir, 'szkrabok.config.local.toml.example');
  if (await createFileAtomic(tomlDest, TOML_EXAMPLE))
    created.push('szkrabok.config.local.toml.example');
  else
    skipped.push('szkrabok.config.local.toml.example');

  // example spec
  if (preset === 'full') {
    const automationDir = join(dir, 'automation');
    await mkdir(automationDir, { recursive: true });

    const specDest = join(automationDir, 'example.spec.js');
    if (await createFileAtomic(specDest, EXAMPLE_SPEC))
      created.push('automation/example.spec.js');
    else
      skipped.push('automation/example.spec.js');
  }

  const installed = [];

  if (install) {
    const warn = await npmInstall(dir);
    if (warn) warnings.push(warn);
    else installed.push('@playwright/test', '@szkrabok/runtime');
  }

  return { created, skipped, merged, installed, warnings };
}
