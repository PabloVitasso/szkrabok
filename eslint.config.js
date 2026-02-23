import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['packages/**', 'roll.js', 'node_modules/**'],
  },
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
];
