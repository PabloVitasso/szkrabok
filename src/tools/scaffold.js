import { readFile, writeFile, mkdir, rename, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

const tpl = path => readFile(join(TEMPLATES_DIR, path), 'utf8');

// Returns 'created' | 'skipped' | 'staged'.
// 'staged': file existed with different content — new template written as dest+'.new',
// original left untouched (dpkg-new convention).
async function writeOrStage(dest, content) {
  try {
    await writeFile(dest, content, { flag: 'wx' });
    return 'created';
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const current = await readFile(dest, 'utf8');
    if (current === content) return 'skipped';
    await writeFile(dest + '.new', content);
    return 'staged';
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
    devDependencies: { '@playwright/test': '^1.58.2', 'smol-toml': '^1.6.1' },
  };

  if (!existing) return base;

  return {
    ...existing,
    type: (() => { if (existing.type != null) return existing.type; return base.type; })(),
    scripts: { ...base.scripts, ...existing.scripts },
    devDependencies: { ...base.devDependencies, ...(existing.devDependencies != null ? existing.devDependencies : {}) },
  };
}

function track(status, name, created, staged, skipped) {
  if (status === 'created') created.push(name);
  else if (status === 'staged') staged.push(name);
  else skipped.push(name);
}

async function ensureGitignore(dir, entry) {
  const gitignorePath = join(dir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf8');
    const lines = content.split('\n').map(l => l.trim());
    if (lines.includes(entry)) return;
    const suffix = content.endsWith('\n') ? '' : '\n';
    await appendFile(gitignorePath, `${suffix}${entry}\n`);
  } else {
    await writeFile(gitignorePath, `${entry}\n`);
  }
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

// ── init ──────────────────────────────────────────────────────────────────────
// Returns which files were created / skipped / merged and which packages were
// installed.  Uses let+push for collecting result arrays — this is a script
// (not a library module) so imperative accumulation is appropriate here.
// The immutability rule is disabled for this file in eslint.config.js.

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
  const staged = [];
  const merged = [];
  const warnings = [];

  // playwright.config.js
  const configDest = join(dir, 'playwright.config.js');
  track(await writeOrStage(configDest, await tpl('playwright.config.js')), 'playwright.config.js', created, staged, skipped);

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

  // config files — write in parallel, then ensure .gitignore excludes the local one
  const [tomlStatus, localTomlStatus] = await Promise.all([
    writeOrStage(join(dir, 'szkrabok.config.toml'), await tpl('szkrabok.config.toml')),
    writeOrStage(join(dir, 'szkrabok.config.local.toml'), await tpl('szkrabok.config.local.toml')),
  ]);
  track(tomlStatus, 'szkrabok.config.toml', created, staged, skipped);
  track(localTomlStatus, 'szkrabok.config.local.toml', created, staged, skipped);
  await ensureGitignore(dir, 'szkrabok.config.local.toml');

  // full preset — automation scaffold
  if (preset === 'full') {
    const automationDir = join(dir, 'automation');
    await mkdir(automationDir, { recursive: true });

    const automationFiles = [
      'automation/fixtures.js',
      'automation/example.spec.js',
      'automation/example.mcp.spec.js',
    ];

    for (const rel of automationFiles) {
      track(await writeOrStage(join(dir, rel), await tpl(rel)), rel, created, staged, skipped);
    }
  }

  const installed = [];

  if (install) {
    const warn = await npmInstall(dir);
    if (warn) warnings.push(warn);
    else installed.push('@playwright/test', 'smol-toml');
  }

  return { created, skipped, staged, merged, installed, warnings };
}
