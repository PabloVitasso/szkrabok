import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { init } from '../../src/tools/scaffold.js';

const makeTmp = () => mkdtemp(join(tmpdir(), 'scaffold-test-'));

test('scaffold_init creates expected files in empty dir (minimal)', async () => {
  const dir = await makeTmp();
  try {
    const result = await init({ dir, name: 'test-project' });

    assert.deepEqual(
      result.created.sort(),
      [
        'package.json',
        'playwright.config.js',
        'szkrabok.config.local.toml',
        'szkrabok.config.toml',
      ].sort()
    );
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.warnings, []);

    assert.ok(existsSync(join(dir, 'playwright.config.js')));
    assert.ok(existsSync(join(dir, 'package.json')));
    assert.ok(existsSync(join(dir, 'szkrabok.config.toml')));
    assert.ok(existsSync(join(dir, 'szkrabok.config.local.toml')));
    assert.ok(!existsSync(join(dir, 'automation/fixtures.js')));
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffold_init creates .gitignore with szkrabok.config.local.toml entry', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });
    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('szkrabok.config.local.toml'), '.gitignore must contain entry');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffold_init appends to existing .gitignore without duplicating', async () => {
  const dir = await makeTmp();
  try {
    await writeFile(join(dir, '.gitignore'), 'node_modules\n', 'utf8');
    await init({ dir });
    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('node_modules'), 'existing entries preserved');
    assert.ok(gitignore.includes('szkrabok.config.local.toml'), 'new entry appended');

    // idempotent — second run must not duplicate
    await init({ dir });
    const gitignore2 = await readFile(join(dir, '.gitignore'), 'utf8');
    const count = gitignore2
      .split('\n')
      .filter(l => l.trim() === 'szkrabok.config.local.toml').length;
    assert.equal(count, 1, 'entry must appear exactly once');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffold_init full preset creates all automation files', async () => {
  const dir = await makeTmp();
  try {
    const result = await init({ dir, preset: 'full' });

    const expected = [
      'automation/fixtures.js',
      'automation/example.spec.js',
      'automation/example.mcp.spec.js',
    ];
    for (const f of expected) {
      assert.ok(result.created.includes(f), `missing in created: ${f}`);
      assert.ok(existsSync(join(dir, f)), `file not on disk: ${f}`);
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffold_init skips existing files when content is unchanged', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });
    const result2 = await init({ dir });

    assert.deepEqual(result2.created, []);
    assert.deepEqual(result2.staged, []);
    assert.ok(result2.skipped.length > 0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffold_init stages .new file when existing file differs from template', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });

    // Simulate user having modified playwright.config.js
    const configPath = join(dir, 'playwright.config.js');
    await writeFile(configPath, '// my custom config\n', 'utf8');

    const result2 = await init({ dir });

    assert.ok(result2.staged.includes('playwright.config.js'), 'modified file should be staged');
    assert.ok(!result2.created.includes('playwright.config.js'));
    assert.ok(!result2.skipped.includes('playwright.config.js'));

    // Original untouched
    assert.equal(await readFile(configPath, 'utf8'), '// my custom config\n');
    // .new written with current template content
    assert.ok(existsSync(join(dir, 'playwright.config.js.new')));
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffold_init merges into existing package.json', async () => {
  const dir = await makeTmp();
  try {
    const existing = {
      name: 'my-app',
      version: '1.0.0',
      scripts: { start: 'node index.js' },
    };
    const pkgPath = join(dir, 'package.json');
    await writeFile(pkgPath, JSON.stringify(existing), 'utf8');

    const result = await init({ dir });

    assert.ok(result.merged.includes('package.json'), 'package.json should be in merged list');

    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    assert.equal(pkg.name, 'my-app');
    assert.equal(pkg.version, '1.0.0');
    assert.equal(pkg.scripts.start, 'node index.js');
    assert.equal(pkg.scripts.test, 'playwright test');
    assert.equal(pkg.type, 'module');
    assert.ok(pkg.devDependencies['@playwright/test']);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffold_init package.json has type:module', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.type, 'module');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffolded szkrabok.config.toml is committed skeleton', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });
    const src = await readFile(join(dir, 'szkrabok.config.toml'), 'utf8');
    assert.ok(src.includes('commit this file'), 'must say commit this file');
    assert.ok(src.includes('szkrabok.config.local.toml'), 'must reference local file');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffolded szkrabok.config.local.toml is gitignored machine override', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });
    const src = await readFile(join(dir, 'szkrabok.config.local.toml'), 'utf8');
    assert.ok(src.includes('do not commit'), 'must say do not commit');
    assert.ok(src.includes('executablePath'), 'must show executablePath');
    assert.ok(src.includes('szkrabok doctor detect'), 'must reference doctor detect');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffolded fixtures.js is the thin shim', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir, preset: 'full' });
    const src = await readFile(join(dir, 'automation/fixtures.js'), 'utf8');
    assert.ok(
      src.includes('@pablovitasso/szkrabok/fixtures'),
      'shim must re-export from @pablovitasso/szkrabok/fixtures'
    );
    assert.ok(
      !src.includes('connectOverCDP'),
      'implementation must live in the package, not the shim'
    );
    assert.ok(!src.includes('process.env'), 'shim must not read process.env');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffolded playwright.config.js has szkrabokProfile and no env bridging', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });
    const src = await readFile(join(dir, 'playwright.config.js'), 'utf8');
    assert.ok(src.includes('szkrabokProfile'), 'config must declare szkrabokProfile');
    assert.ok(
      !src.includes('SZKRABOK_CDP_ENDPOINT'),
      'env bridging must not be in config (belongs in fixtures.js)'
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
