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
      // shadcn components export their cva variants next to the component.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true, allowExportNames: ["badgeVariants", "buttonVariants"] },
      ],
    },
  },
  {
    // Icons come from src/components/icons, not direct Lucide imports.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message: "icons come from src/components/icons.",
            },
          ],
        },
      ],
    },
  },
  {
    // Radix and CVA stay behind the wrappers in src/components/ui/, so replacing
    // them later touches only that folder. This block overrides the one above
    // for the files it matches, so it repeats the Lucide entry.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message: "icons come from src/components/icons.",
            },
            {
              name: "class-variance-authority",
              message: "use the wrappers in src/components/ui.",
            },
          ],
          patterns: [
            {
              group: ["@radix-ui/*"],
              message: "use the wrappers in src/components/ui.",
            },
          ],
        },
      ],
    },
  },
);
