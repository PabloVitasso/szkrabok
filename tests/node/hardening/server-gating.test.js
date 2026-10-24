/**
 * D1 / D5 / D6 / D7 / D8 / E5 — the real MCP server over stdio.
 *
 * Every check here must fire before any session lookup or browser launch, so
 * this file needs no browser. A refused call must leave no trace on disk.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnServer, expectStartupFailure, tmpTracker } from './helpers.js';

const tmp = tmpTracker();
after(() => tmp.cleanup());

/** work root + sibling spec root with a minimal config and one spec. */
const layout = () => {
  const base = tmp.make();
  const work = join(base, 'work');
  const spec = join(base, 'spec');
  mkdirSync(work);
  mkdirSync(join(spec, 'automation'), { recursive: true });
  writeFileSync(join(spec, 'playwright.config.js'), 'export default {};\n');
  writeFileSync(join(spec, 'automation', 'a.spec.js'), '');
  writeFileSync(join(spec, 'page-fn.js'), '() => 1');
  return { base, work, spec };
};

const withServer = async (opts, fn) => {
  const server = await spawnServer(opts);
  try {
    await fn(server);
  } finally {
    await server.close();
  }
};

const expectCode = (res, code, messagePart) => {
  assert.equal(res.isError, true, `expected isError, got ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, code, JSON.stringify(res.body));
  if (messagePart) assert.ok(res.body.message.includes(messagePart), res.body.message);
};

// ── default posture (no flags) ────────────────────────────────────────────────

test('no flags: test tools, scaffold_init and browser_run path are disabled, naming the flag', async () => {
  const { work } = layout();
  await withServer({ cwd: work }, async ({ callTool }) => {
    expectCode(
      await callTool('browser_run_test', { sessionName: 's1' }),
      'CAPABILITY_DISABLED',
      '--spec-root'
    );
    expectCode(
      await callTool('session_run_test', { session: { name: 's1' }, test: {} }),
      'CAPABILITY_DISABLED',
      '--spec-root'
    );
    expectCode(
      await callTool('scaffold_init', { dir: work }),
      'CAPABILITY_DISABLED',
      '--allow-node-code'
    );
    expectCode(
      await callTool('browser_run', { sessionName: 's1', path: 'x.js' }),
      'CAPABILITY_DISABLED'
    );
  });
  assert.deepEqual(
    readdirSync(work).filter(n => n !== 'sessions'),
    [],
    'nothing written to the work root'
  );
});

test('no flags: tool descriptions say what is disabled', async () => {
  const { work } = layout();
  await withServer({ cwd: work }, async ({ client }) => {
    const { tools } = await client.listTools();
    const desc = Object.fromEntries(tools.map(t => [t.name, t.description]));
    assert.match(desc.browser_run_test, /^\[disabled: .*--spec-root/);
    assert.match(desc.session_run_test, /^\[disabled: .*--spec-root/);
    assert.match(desc.scaffold_init, /^\[disabled: .*--allow-node-code/);
    assert.match(desc.browser_run, /^\[page sandbox/);
  });
});

test('list reports flags, roots and capabilities', async () => {
  const { work } = layout();
  await withServer({ cwd: work }, async ({ callTool }) => {
    const { body } = await callTool('session_manage', { action: 'list' });
    assert.equal(body.server.flags.workRoot, work);
    assert.equal(body.server.flags.specRoot, null);
    assert.deepEqual(body.server.capabilities, {
      browserRunCode: 'page',
      browserRunPath: 'off',
      testTools: 'off',
      scaffoldInit: false,
      privateNet: false,
      projectConfig: false,
    });
  });
});

test('--spec-root: confined test tools and page-mode path are reported', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool, client }) => {
    const { body } = await callTool('session_manage', { action: 'list' });
    assert.equal(body.server.capabilities.testTools, 'confined');
    assert.equal(body.server.capabilities.browserRunPath, 'page');
    const { tools } = await client.listTools();
    assert.match(tools.find(t => t.name === 'browser_run_test').description, /^\[confined/);
  });
});

// ── session names ─────────────────────────────────────────────────────────────

test('delete with traversal or glob is refused and the target survives', async () => {
  const { base, work } = layout();
  const decoy = join(base, 'decoy');
  mkdirSync(decoy);
  writeFileSync(join(decoy, 'keep.txt'), 'x');
  await withServer({ cwd: work }, async ({ callTool }) => {
    expectCode(
      await callTool('session_manage', { action: 'delete', sessionName: '../../decoy' }),
      'VALIDATION_ERROR'
    );
    expectCode(
      await callTool('session_manage', { action: 'delete', sessionName: '*' }),
      'VALIDATION_ERROR'
    );
    expectCode(
      await callTool('session_manage', { action: 'delete', sessionName: '..' }),
      'VALIDATION_ERROR'
    );
  });
  assert.ok(existsSync(join(decoy, 'keep.txt')));
});

test('open with a traversal name is refused before anything is created', async () => {
  const { base, work } = layout();
  await withServer({ cwd: work }, async ({ callTool }) => {
    expectCode(
      await callTool('session_manage', { action: 'open', sessionName: '../escape' }),
      'VALIDATION_ERROR'
    );
  });
  assert.ok(!existsSync(join(base, 'escape')));
});

test('sessions dir is pinned under the work root', async () => {
  const { work } = layout();
  await withServer({ cwd: work }, async ({ callTool }) => {
    await callTool('session_manage', { action: 'list' }); // list creates the sessions dir
  });
  assert.ok(existsSync(join(work, 'sessions')));
});

// ── navigation guard at the call site ─────────────────────────────────────────

test('open with a blocked URL is refused before launch', async () => {
  const { work } = layout();
  await withServer({ cwd: work }, async ({ callTool }) => {
    for (const url of [
      'file:///etc/hostname',
      'chrome://version',
      'http://127.0.0.1:8932/',
      'http://localhost/',
    ]) {
      expectCode(
        await callTool('session_manage', { action: 'open', sessionName: 'nav1', url }),
        'URL_BLOCKED'
      );
    }
    expectCode(
      await callTool('session_manage', {
        action: 'open',
        sessionName: 'nav1',
        url: 'file:///etc/hostname',
        launchOptions: { isClone: true },
      }),
      'URL_BLOCKED'
    );
    const { body } = await callTool('session_manage', { action: 'list' });
    assert.ok(!body.sessions.some(s => s.id === 'nav1'), 'no session was created');
  });
});

test('--allow-private-net does not lift the scheme block', async () => {
  const { work } = layout();
  await withServer({ cwd: work, flags: ['--allow-private-net'] }, async ({ callTool }) => {
    expectCode(
      await callTool('session_manage', {
        action: 'open',
        sessionName: 'nav2',
        url: 'file:///etc/hostname',
      }),
      'URL_BLOCKED'
    );
  });
});

test('session_run_test refuses a blocked navigation.url before opening a session', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool }) => {
    const res = await callTool('session_run_test', {
      session: { name: 'nav3', navigation: { policy: 'always', url: 'file:///etc/hostname' } },
      test: {},
    });
    assert.equal(res.body.code, 'URL_BLOCKED', JSON.stringify(res.body));
    assert.equal(res.body.phase, 'session');
  });
});

// ── confined test runner (D6, D9) ─────────────────────────────────────────────

test('confined: config outside the spec root is refused', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool }) => {
    for (const config of ['/etc/hostname', '../work/x.js', '../spec-evil/playwright.config.js']) {
      expectCode(
        await callTool('browser_run_test', { sessionName: 's1', config }),
        'PATH_NOT_ALLOWED'
      );
    }
  });
});

test('confined: option-like or escaping files are refused', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool }) => {
    for (const files of [['-c'], ['--output=/tmp/x'], ['../work'], ['/etc']]) {
      expectCode(
        await callTool('browser_run_test', { sessionName: 's1', files }),
        'PATH_NOT_ALLOWED'
      );
    }
  });
});

test('confined: reportFile with directories is refused', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool }) => {
    for (const reportFile of ['../x.json', 'a/b.json', '/tmp/x.json']) {
      expectCode(
        await callTool('browser_run_test', { sessionName: 's1', reportFile }),
        'VALIDATION_ERROR'
      );
    }
  });
});

test('confined: reserved params keys are refused (placeholder values)', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool }) => {
    for (const key of [
      'node_options',
      'PLAYWRIGHT_JSON_OUTPUT_NAME',
      'SZKRABOK_CDP_ENDPOINT',
      'PATH',
    ]) {
      expectCode(
        await callTool('browser_run_test', { sessionName: 's1', params: { [key]: 'x' } }),
        'VALIDATION_ERROR'
      );
    }
  });
});

test('confined: valid input reaches the session lookup (proves the order of checks)', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool }) => {
    const res = await callTool('browser_run_test', {
      sessionName: 'not-open',
      files: ['automation/a.spec.js'],
      params: { url: 'https://example.com' },
      reportFile: 'r.json',
    });
    assert.equal(res.isError, true);
    assert.match(res.body.message, /not open/);
  });
  assert.ok(!existsSync(join(spec, 'test-results')), 'nothing written to the spec root');
});

test('confined page-mode browser_run: path outside the spec root and fn are refused', async () => {
  const { work, spec } = layout();
  await withServer({ cwd: work, flags: ['--spec-root', spec] }, async ({ callTool }) => {
    expectCode(
      await callTool('browser_run', { sessionName: 's1', path: '../work/sessions/x/state.json' }),
      'PATH_NOT_ALLOWED'
    );
    expectCode(
      await callTool('browser_run', { sessionName: 's1', code: '() => 1', fn: 'x' }),
      'VALIDATION_ERROR'
    );
  });
});

// ── launch option scrubbing (E7) ──────────────────────────────────────────────

test('_-prefixed launchOptions do not reach the launcher', async () => {
  const { work } = layout();
  await withServer({ cwd: work }, async ({ callTool }) => {
    const res = await callTool('session_manage', {
      action: 'open',
      sessionName: 'seam1',
      launchOptions: { _launchImpl: 'x' },
    });
    // Without a browser the launch fails, but never with the test-seam crash.
    assert.ok(
      !/launchFn is not a function/.test(JSON.stringify(res.body)),
      JSON.stringify(res.body)
    );
  });
});

// ── config discovery and .env (D8, E5) ────────────────────────────────────────

test('toml and .env in cwd are not loaded; the toml is reported as ignored', async () => {
  const { work, base } = layout();
  const planted = join(base, 'planted.toml');
  writeFileSync(planted, '[default]\nuserAgent = "Planted"\n');
  writeFileSync(join(work, 'szkrabok.config.toml'), '[default]\nuserAgent = "Planted"\n');
  writeFileSync(join(work, '.env'), `SZKRABOK_CONFIG=${planted}\n`);
  await withServer(
    { cwd: work, env: { XDG_CONFIG_HOME: join(base, 'xdg') } },
    async ({ callTool }) => {
      const { body } = await callTool('session_manage', { action: 'list' });
      assert.match(body.config.source, /^none/, body.config.source);
      assert.deepEqual(body.config.ignored, [work]);
      const cwdStep = body.config.searched.find(e => e.step === 'cwd');
      assert.equal(cwdStep.ignored, true);
      assert.equal(cwdStep.found, true);
    }
  );
});

test('an ignored toml is never parsed (invalid toml does not break startup)', async () => {
  const { work, base } = layout();
  writeFileSync(join(work, 'szkrabok.config.toml'), 'this is = = not toml [[[');
  await withServer(
    { cwd: work, env: { XDG_CONFIG_HOME: join(base, 'xdg') } },
    async ({ callTool }) => {
      const { body } = await callTool('session_manage', { action: 'list' });
      assert.deepEqual(body.config.ignored, [work]);
    }
  );
});

test('--trust-project-config: cwd toml is loaded, .env still is not', async () => {
  const { work, base } = layout();
  const planted = join(base, 'planted.toml');
  writeFileSync(planted, '[default]\nuserAgent = "Planted"\n');
  writeFileSync(join(work, 'szkrabok.config.toml'), '[default]\nuserAgent = "Project"\n');
  writeFileSync(join(work, '.env'), `SZKRABOK_CONFIG=${planted}\n`);
  await withServer(
    { cwd: work, flags: ['--trust-project-config'], env: { XDG_CONFIG_HOME: join(base, 'xdg') } },
    async ({ callTool }) => {
      const { body } = await callTool('session_manage', { action: 'list' });
      assert.match(body.config.source, /^cwd \(/, body.config.source);
      assert.deepEqual(body.config.ignored, []);
      assert.equal(body.server.capabilities.projectConfig, true);
    }
  );
});

test('--trust-project-config: toml in an MCP root is loaded', async () => {
  const { work, base } = layout();
  const root = join(base, 'project');
  mkdirSync(root);
  writeFileSync(join(root, 'szkrabok.config.toml'), '[default]\nuserAgent = "Project"\n');
  await withServer(
    {
      cwd: work,
      roots: [root],
      flags: ['--trust-project-config'],
      env: { XDG_CONFIG_HOME: join(base, 'xdg') },
    },
    async ({ callTool }) => {
      const { body } = await callTool('session_manage', { action: 'list' });
      assert.match(body.config.source, /^mcp-root \(/, body.config.source);
    }
  );
});

test('toml in a client-declared MCP root is not loaded', async () => {
  const { work, base } = layout();
  const root = join(base, 'project');
  mkdirSync(root);
  writeFileSync(join(root, 'szkrabok.config.toml'), '[default]\nuserAgent = "Planted"\n');
  await withServer(
    { cwd: work, roots: [root], env: { XDG_CONFIG_HOME: join(base, 'xdg') } },
    async ({ callTool }) => {
      const { body } = await callTool('session_manage', { action: 'list' });
      assert.ok(!body.config.source.includes('mcp-root'), body.config.source);
      assert.match(body.config.source, /^none/);
      assert.deepEqual(body.config.ignored, [root]);
    }
  );
});

test('SZKRABOK_CONFIG from the real process env is still honoured', async () => {
  const { work, base } = layout();
  const trusted = join(base, 'trusted.toml');
  writeFileSync(trusted, '[default]\nuserAgent = "Trusted"\n');
  await withServer({ cwd: work, env: { SZKRABOK_CONFIG: trusted } }, async ({ callTool }) => {
    const { body } = await callTool('session_manage', { action: 'list' });
    assert.match(body.config.source, /SZKRABOK_CONFIG/);
  });
});

// ── startup refusal ───────────────────────────────────────────────────────────

test('overlapping roots refuse startup', async () => {
  const { work } = layout();
  mkdirSync(join(work, 'inner'));
  const { code, stderr } = await expectStartupFailure({
    cwd: work,
    flags: ['--work-root', work, '--spec-root', join(work, 'inner')],
  });
  assert.equal(code, 2);
  assert.match(stderr, /disjoint/);
});

test('unknown --allow-* flag refuses startup', async () => {
  const { work } = layout();
  const { code, stderr } = await expectStartupFailure({ cwd: work, flags: ['--allow-node-cod'] });
  assert.equal(code, 2);
  assert.match(stderr, /unknown flag/);
});

test('relative --spec-root refuses startup', async () => {
  const { work } = layout();
  const { code } = await expectStartupFailure({ cwd: work, flags: ['--spec-root', 'spec'] });
  assert.equal(code, 2);
});
