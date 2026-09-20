import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/node_modules/**', '**/dev-dist/**',
      'apps/frontend/playwright-report/**', 'apps/frontend/test-results/**',
      'apps/backend/prisma/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
    rules: {
      // Signal, not style. Everything switched off below is a formatting or idiom preference
      // that Prettier already settles or that this codebase uses deliberately.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none',
      }],

      // `any` is used deliberately in a handful of RTK Query/Prisma boundary types where the
      // library's own types are unusable; flagging every one of them is pure noise.
      '@typescript-eslint/no-explicit-any': 'off',
      // Non-null assertions are load-bearing throughout (validated ids, known-present cache
      // entries); they are a reviewed choice, not an accident.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `interface Foo extends Bar {}` marker types and empty catch blocks are intentional.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Not enabled: type-aware linting (no-floating-promises et al.) would need a
      // project-service pass over four tsconfigs on every run; `void`-prefixed promises are
      // already the house style and `tsc --noEmit` runs in CI beside this.
    },
  },

  // Frontend: React hook rules are the reason this config exists at all.
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Plain-JS config/entrypoint files.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
