const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

const tsRecommended = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: ["**/*.ts", "**/*.tsx"],
}));

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: ["**/dist/**", "**/node_modules/**", ".demo-repo/**", ".a5c/**", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tsRecommended,
  eslintConfigPrettier,
  {
    files: ["eslint.config.cjs", "**/*.cjs", "packages/sdk/test/**/*.js", "apps/*/test/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },
  {
    files: ["apps/vscode-extension/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: ["apps/vscode-extension/media/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        acquireVsCodeApi: "readonly",
      },
    },
    rules: {
      "no-empty": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    rules: {
      "no-console": "off",
    },
  },
];
