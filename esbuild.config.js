import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["linter.js"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/linter.mjs",
  banner: {
    // Shebang for global installs + restore __filename / __dirname and
    // a CJS-compatible require() so bundled CJS deps work at runtime.
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __createRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __dirname_ } from "path";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log("Built dist/linter.mjs");
