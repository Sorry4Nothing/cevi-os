import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Skript für Postman (#186) läuft in Node; nur die benutzten Namen
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", console: "readonly" } },
  },
  {
    // Skripte der Verwaltung laufen im Browser; ohne Abhängigkeit «globals» nur die benutzten Namen
    files: ["public/admin/**/*.js", "public/website/**/*.js"],
    languageOptions: {
      globals: {
        Blob: "readonly",
        Node: "readonly",
        URLSearchParams: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
        Event: "readonly",
        CSS: "readonly",
        HTMLInputElement: "readonly",
        Element: "readonly",
        queueMicrotask: "readonly",
        MutationObserver: "readonly",
        window: "readonly",
      },
    },
  },
);
