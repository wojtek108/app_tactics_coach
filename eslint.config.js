import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Preact is React-compatible: the React plugin + react-hooks plugin work
// as-is. JSX runtime is "automatic" so .jsx files don't need to import
// React (matches the existing src/ code, which never does).
export default [
  { ignores: ['dist/', 'node_modules/', 'prototype/', '.venv/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        // Browser globals for the app code; tests run in node via vitest.
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        Worker: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: {
        // Preact isn't "react" but is API-compatible; pin a version so the
        // plugin doesn't warn about a missing react package at every run.
        version: '18.0',
        pragma: 'h',
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Preact doesn't need React in scope for JSX.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Preact uses class= instead of className (matches src/Board.jsx).
      'react/no-unknown-property': 'off',
    },
  },
];
