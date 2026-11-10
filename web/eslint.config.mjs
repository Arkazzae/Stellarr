import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// The flat exports of eslint-config-next are used directly. Going through
// FlatCompat re-serialises the Next plugin object, which contains a cycle, and
// ESLint throws before it lints anything.
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // AudioWorklet modules are served verbatim as plain JavaScript, and
      // `allowJs` is off, so there is nothing here for the TypeScript rules.
      "public/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Images come from the server with unknown dimensions, and a self-hosted
      // instance has no image optimiser to hand them to.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Components are presentational: they take data as props and import types
    // from @/ports. Reaching past that into a transport is a lint error, since
    // a convention only holds until someone is in a hurry.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/api",
                "@/lib/api/*",
                "@/lib/realtime",
                "@/lib/realtime/*",
                "@/lib/voice",
                "@/lib/voice/*",
                "@/adapters",
                "@/adapters/*",
                "@/state",
                "@/state/*",
              ],
              // UI copy is not a transport, so the language context is the one
              // state import a component may read.
              allowImportNames: ["useLanguage"],
              message:
                "Components are presentational. Import types from @/ports and take data as props; wire transports in src/containers or src/state.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
