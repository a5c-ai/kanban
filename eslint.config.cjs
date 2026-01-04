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
    rules: {
      "no-console": "off",
    },
  },
];
