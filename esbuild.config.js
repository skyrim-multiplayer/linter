import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["linter.js"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/linter.mjs",
  banner: {
    // Restore __filename / __dirname and a CJS-compatible require()
    // so that bundled CJS deps (like simple-git internals) work at runtime.
    js: [
      'import { createRequire as __createRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __dirname_ } from "path";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log("Built dist/linter.mjs");
