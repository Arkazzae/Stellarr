import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // UI parts come from the shared @stellarr/ui package and icons from
    // src/components/icons, which draws the package's set. These libraries
    // were Cockpit's own copy of them; a new import would bring that back.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "lucide-react", message: "icons come from src/components/icons." },
            { name: "class-variance-authority", message: "UI parts come from @stellarr/ui." },
            { name: "clsx", message: "join class names with cx from @stellarr/ui." },
            { name: "tailwind-merge", message: "join class names with cx from @stellarr/ui." },
          ],
          patterns: [{ group: ["@radix-ui/*"], message: "UI parts come from @stellarr/ui." }],
        },
      ],
    },
  },
);
