import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'coverage/**', '*.tsbuildinfo']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // TypeScript already resolves every identifier; leaving this on only
      // produces false positives for globals the compiler knows about.
      'no-undef': 'off',
      // The codebase deliberately uses `void promise` to fire-and-forget.
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      // Metadata from Mojang, Modrinth and CurseForge is cast through `any` in
      // a few places where a full schema would be more noise than value.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },

  {
    // The main process is bundled as CommonJS and lazily `require()`s its
    // optional native dependencies — better-sqlite3, mineflayer — so that a
    // machine missing one still starts. That is deliberate, not legacy.
    files: ['src/main/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },

  {
    // Build-time helper scripts are plain CommonJS Node, not app code.
    files: ['scripts/**/*.js', '*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        console: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off'
    }
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  prettier
)
