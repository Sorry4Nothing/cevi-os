import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Skripte der Verwaltung laufen im Browser; ohne Abhängigkeit «globals» nur die benutzten Namen
    files: ["public/admin/**/*.js"],
    languageOptions: {
      globals: {
        Node: "readonly",
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        window: "readonly",
      },
    },
  },
);
