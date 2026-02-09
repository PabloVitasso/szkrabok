export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      quotes: ['error', 'single'],
      semi: ['error', 'never'],
      indent: ['error', 2],
      'no-unused-vars': ['warn'],
      'no-console': ['off'],
    },
  },
]
