import tsParser from "@typescript-eslint/parser";
import solid from "eslint-plugin-solid/configs/typescript";
import globals from "globals";

const browserGlobals = {
  ...globals.browser,
  ...globals.es2021,
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/src-tauri/target/**",
      "packages/desktop/src/bindings.ts",
    ],
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    ...solid,
    languageOptions: {
      ...(solid.languageOptions ?? {}),
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: browserGlobals,
    },
  },
  {
    files: [
      "packages/app/src/components/message-item.tsx",
      "packages/app/src/components/search-bar.tsx",
      "packages/app/src/components/supervisor/event-renderers.tsx",
    ],
    rules: {
      "solid/no-innerhtml": "off",
    },
  },
];
