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
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-console': 'off',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
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
