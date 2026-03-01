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

const CONSUMER_FILES = ['src/**/*.js', 'automation/**/*.js', 'selftest/**/*.js', 'mcp-client/**/*.js'];

export default [
  {
    ignores: ['roll.js', 'node_modules/**', 'vendor/**'],
  },

  // ── Base rules — all JS files ──────────────────────────────────────────
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...prettierConfig.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['off'],
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
