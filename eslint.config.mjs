import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "**/dist/**",
            "**/coverage/**",
            "**/node_modules/**",
            "**/.turbo/**",
            "**/src/data/*.generated.ts",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        files: ["**/*.ts"],
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        },
    },
    {
        files: ["**/*.mjs", "**/*.js"],
        languageOptions: {
            globals: { console: "readonly", process: "readonly" },
        },
    },
);
