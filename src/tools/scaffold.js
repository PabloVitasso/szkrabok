import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');
let npmBin;
if (process.platform === 'win32') {
  npmBin = 'npm.cmd';
} else {
  npmBin = 'npm';
}

const { version: PKG_VERSION } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url))
);

const tpl = path => readFile(join(TEMPLATES_DIR, path), 'utf8');

async function createFileAtomic(dest, content) {
  try {
    await writeFile(dest, content, { flag: 'wx' });
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
    dependencies: { '@pablovitasso/szkrabok': `^${PKG_VERSION}` },
    devDependencies: { '@playwright/test': '^1.49.1' },
  };

  if (!existing) return base;

  return {
    ...existing,
    type: (() => { if (existing.type != null) return existing.type; return base.type; })(),
    scripts: { ...base.scripts, ...existing.scripts },
    dependencies: { ...base.dependencies, ...(existing.dependencies != null ? existing.dependencies : {}) },
    devDependencies: { ...base.devDependencies, ...(existing.devDependencies != null ? existing.devDependencies : {}) },
  };
}

function npmInstall(dir) {
  return new Promise(resolve => {
    const child = spawn(npmBin, ['install'], { cwd: dir, stdio: 'inherit' });
    child.on('close', code => {
      if (code === 0) {
        resolve(null);
      } else {
        resolve(`npm install exited ${code}`);
      }
    });
    child.on('error', err => resolve(`npm install failed: ${err.message}`));
  });
}

export async function init(args = {}) {
  const { dir: rawDir, name, preset = 'minimal', install = false } = args;

  let dir;
  if (rawDir) {
    dir = resolve(rawDir);
  } else {
    dir = process.cwd();
  }
  let pkgName;
  if (name != null) {
    pkgName = name;
  } else {
    pkgName = basename(dir);
  }

  await mkdir(dir, { recursive: true });

  const created = [];
  const skipped = [];
  const merged = [];
  const warnings = [];

  // playwright.config.js
  const configDest = join(dir, 'playwright.config.js');
  if (await createFileAtomic(configDest, await tpl('playwright.config.js')))
    created.push('playwright.config.js');
  else
    skipped.push('playwright.config.js');

  // package.json — merge if exists
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
    if (existing) {
      merged.push('package.json');
    } else {
      created.push('package.json');
    }
  }

  // szkrabok.config.local.toml.example
  const tomlDest = join(dir, 'szkrabok.config.local.toml.example');
  if (await createFileAtomic(tomlDest, await tpl('szkrabok.config.local.toml.example')))
    created.push('szkrabok.config.local.toml.example');
  else
    skipped.push('szkrabok.config.local.toml.example');

  // full preset — complete automation scaffold with fixtures + both spec patterns
  if (preset === 'full') {
    const automationDir = join(dir, 'automation');
    await mkdir(automationDir, { recursive: true });

    const automationFiles = [
      'automation/fixtures.js',
      'automation/example.spec.js',
      'automation/example.mcp.spec.js',
    ];

    for (const rel of automationFiles) {
      const dest = join(dir, rel);
      if (await createFileAtomic(dest, await tpl(rel)))
        created.push(rel);
      else
        skipped.push(rel);
    }
  }

  const installed = [];

  if (install) {
    const warn = await npmInstall(dir);
    if (warn) warnings.push(warn);
    else installed.push('@playwright/test', '@pablovitasso/szkrabok');
  }

  return { created, skipped, merged, installed, warnings };
}
