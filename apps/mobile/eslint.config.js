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
]);
