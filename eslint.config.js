import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  { extends: [js.configs.recommended, ...tseslint.configs.recommended], files: ["**/*.ts"] },
  { files: ["test/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
