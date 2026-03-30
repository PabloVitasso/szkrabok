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

    assert.deepEqual(result.created.sort(), [
      'package.json',
      'playwright.config.js',
      'szkrabok.config.local.toml.example',
    ].sort());
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.warnings, []);

    assert.ok(existsSync(join(dir, 'playwright.config.js')));
    assert.ok(existsSync(join(dir, 'package.json')));
    assert.ok(existsSync(join(dir, 'szkrabok.config.local.toml.example')));
    assert.ok(!existsSync(join(dir, 'automation/fixtures.js')));
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

test('scaffolded fixtures.js is the thin shim', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir, preset: 'full' });
    const src = await readFile(join(dir, 'automation/fixtures.js'), 'utf8');
    assert.ok(src.includes('@pablovitasso/szkrabok/fixtures'), 'shim must re-export from @pablovitasso/szkrabok/fixtures');
    assert.ok(!src.includes('connectOverCDP'), 'implementation must live in the package, not the shim');
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
    assert.ok(!src.includes('SZKRABOK_CDP_ENDPOINT'), 'env bridging must not be in config (belongs in fixtures.js)');
  } finally {
    await rm(dir, { recursive: true });
  }
});
