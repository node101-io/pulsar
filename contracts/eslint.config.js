import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsp from '@typescript-eslint/parser';
import o1js from 'eslint-plugin-o1js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'src/test/**/*.ts'],
    ignores: ['node_modules/', 'dist/', 'build/'],
    languageOptions: {
      ecmaVersion: 'latest',
      parser: tsp,
    },
    plugins: {
      '@typescript-eslint': tseslint,
      o1js: o1js,
    },
    rules: {
      'no-undef': 'off',
      'no-constant-condition': 'off',
      'prefer-const': 'off',
    },
  },
];
