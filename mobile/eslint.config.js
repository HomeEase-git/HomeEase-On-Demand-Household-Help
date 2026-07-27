// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    files: [
      'jest.setup.js',
      '**/__tests__/**/*.{js,ts,tsx}',
      '**/*.test.{js,ts,tsx}',
    ],
    languageOptions: {
      globals: {
        __DEV__: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        jest: 'readonly',
        require: 'readonly',
        test: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/*'],
  },
]);
