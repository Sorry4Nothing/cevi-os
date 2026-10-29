// https://docs.expo.dev/guides/using-eslint/
const { fixupPluginRules } = require("@eslint/compat");
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const a11y = require("eslint-plugin-react-native-a11y");

module.exports = defineConfig([
  expoConfig,
  {
    // Das Plugin kennt die Flat-Config nicht, darum über @eslint/compat
    plugins: { "react-native-a11y": fixupPluginRules(a11y) },
    rules: a11y.configs.all.rules,
  },
  {
    // Aus der API nur Typen, sonst bündelt Metro Servercode; eslint-config-expo kennt das Plugin nur für .ts und .tsx
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@cevi-os/api",
              allowTypeImports: true,
              message: "Aus der API nur «import type».",
            },
          ],
          patterns: [
            {
              regex: "(^|/)api/src(/|$)",
              message:
                'Die API nur über «import type … from "@cevi-os/api"» einbinden.',
            },
          ],
        },
      ],
    },
  },
]);
