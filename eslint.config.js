import js from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

// ── Boundary rules ──────────────────────────────────────────────────────────
// Enforce architectural invariants from docs/separation-plan.md.
// All three rules apply to the same file set — no exceptions.

// Rule 1: No chromium.launch* outside packages/runtime
const noDirectLaunchRule = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='chromium'][callee.property.name=/^launch/]",
      message: 'Only @szkrabok/runtime may call chromium.launch*(). Use runtime.launch() instead.',
    },
  ],
};

// Rule 2: No stealth imports outside packages/runtime
const noStealthImportRule = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['*szkrabok_stealth*', 'puppeteer-extra-plugin-stealth*', 'playwright-extra*'],
          message: 'Stealth imports are only allowed inside packages/runtime.',
        },
      ],
    },
  ],
};

// Rule 3: No runtime internal subpaths — only the public API entry point
const noRuntimeInternalsRule = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@szkrabok/runtime/*'],
          message:
            'Import only from @szkrabok/runtime (public API). Subpath imports are not allowed.',
        },
      ],
    },
  ],
};

const CONSUMER_FILES = ['src/**/*.js', 'tests/**/*.js', 'packages/mcp-client/**/*.js'];

export default [
  {
    ignores: ['node_modules/**'],
  },

  // ── Base rules — all JS/MJS files ─────────────────────────────────────
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...prettierConfig.rules,
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-console': 'off',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      // Rule 4: Prioritize Immutability — prefer spread/reduce/flatMap over mutation
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="push"]',
          message: 'Prefer immutable array operations (spread, flatMap, reduce) over .push().',
        },
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="splice"]',
          message: 'Prefer immutable array operations over .splice().',
        },
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="shift"]',
          message: 'Prefer immutable array operations over .shift().',
        },
        {
          selector: 'UnaryExpression[operator="delete"]',
          message: 'Avoid deleting object properties; use object spread with rest instead.',
        },
      ],
    },
  },

  // ── Browser-context files ──────────────────────────────────────────────────
  // page.evaluate() and addInitScript() closures run inside the browser where
  // mutation (Array.push) is the only way to collect results.  These files are
  // opted out of the immutability rule entirely so push() inside evaluate() is
  // allowed.
  {
    files: ['tests/playwright/**/*.js', 'tests/playwright/**/*.mjs'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── Node test files ────────────────────────────────────────────────────────
  // Tests legitimately use `delete process.env` to isolate config discovery
  // between test cases.  Turn off the delete rule here; all other immutability
  // rules (prefer-const, no-var) remain active.
  {
    files: ['tests/node/**/*.test.js', 'tests/node/**/*.spec.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── Runtime storage — internal concurrency queue ─────────────────────────────
  // pLimit() and cloneDir() mutate private local queue arrays.  This is the
  // standard JS pattern for implementing task queues and BFS walkers where
  // mutation is localized and unavoidable.
  {
    files: ['packages/runtime/storage.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── Runtime launch — sanitize local options object ───────────────────────────
  // launch() removes internal keys from a freshly-destructured local copy before
  // passing it to chromium.launchPersistentContext().  delete is safe here.
  {
    files: ['packages/runtime/launch.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── Browser-in-process scripts ──────────────────────────────────────────────
  // workflow.js runs page.evaluate() in the browser context.  push() inside
  // evaluate() is exempt (see browser-context rule above), but the outer file
  // also contains non-evaluate code, so we silence the rule entirely here.
  {
    files: ['src/tools/workflow.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── Browser-context globals ────────────────────────────────────────────
  // Files that pass callbacks to page.evaluate() / addInitScript(), or are
  // pure browser scripts. ESLint can't tell those closures run in the page —
  // add browser globals so document/window/location don't trigger no-undef.
  {
    files: [
      'packages/runtime/launch.js',
      'src/tools/workflow.js',
      'tests/playwright/**/*.js',
      'tests/playwright/**/*.mjs',
    ],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // ── Test globals — node:test ────────────────────────────────────────────
  {
    files: ['tests/node/**/*.test.js', 'tests/node/**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        test: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },

  // ── Boundary rules — no exceptions ─────────────────────────────────────
  {
    files: CONSUMER_FILES,
    rules: {
      ...noDirectLaunchRule,
      ...noStealthImportRule,
      ...noRuntimeInternalsRule,
    },
  },
];
