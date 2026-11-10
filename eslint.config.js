import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    "apps/api/src/generated/**",
    "apps/api/.local-db/**",
  ]),

  js.configs.recommended,

  // TypeScript : règles avec information de type (projet résolu par tsconfig).
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Les nombres dans les gabarits sont explicitement convertis par String().
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: false }],
      // Classes NestJS : modules vides décorés et méthodes statiques forRoot.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },

  // Interface React.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
  },

  // Scripts Node en JavaScript (sans information de type).
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
);
