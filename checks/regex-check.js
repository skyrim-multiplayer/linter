import fs from "fs/promises";
import path from "path";
import { BaseCheck } from "./base-check.js";

/**
 * Generic regex-based check, fully driven by options in linter-config.json.
 *
 * Options:
 *   pattern        — regex string to find violations (required)
 *   patternFlags   — regex flags (default: "g")
 *   replacement    — replacement string for fix mode (uses $1, $2, … groups)
 *                    Supports templates: {name} (filename without ext),
 *                    {name_we} (filename with ext), {ext} (extension with dot),
 *                    {dir} (directory relative to repo root).
 *   multiline      — if true, regex operates on entire file content instead of
 *                    per-line (default: false). Useful for multi-line patterns.
 *   message        — error message shown on violation (default: "regex violation")
 *   skipLinePatterns — array of regex strings; matching lines are skipped
 *                    (ignored when multiline is true)
 *
 * Example config entry (localization enforcement):
 *   {
 *     "name": "localization",
 *     "export": "RegexCheck",
 *     "modes": ["manual", "hook", "ci"],
 *     "options": {
 *       "extensions": [".js", ".ts", ".cpp", ".h"],
 *       "pattern": "(?<!_L\\()([\"'`])([^\"'`]*[\\u0400-\\u04FF]+[^\"'`]*)\\1",
 *       "replacement": "_L($1$2$1, user)",
 *       "message": "Cyrillic string not wrapped with _L()",
 *       "skipLinePatterns": ["^\\s*\\/\\/", "^\\s*\\*"]
 *     }
 *   }
 */
export class RegexCheck extends BaseCheck {
  #pattern;
  #replacement;
  #message;
  #multiline;
  #skipLineRes;

  constructor(repoRoot, options = {}) {
    super(repoRoot, options);

    if (!options.pattern) {
      throw new Error("RegexCheck requires a 'pattern' option");
    }

    const flags = options.patternFlags ?? "g";
    this.#pattern = new RegExp(options.pattern, flags);
    this.#replacement = options.replacement ?? null;
    this.#message = options.message ?? "regex violation";
    this.#multiline = !!options.multiline;
    this.#skipLineRes = (options.skipLinePatterns || []).map(
      (p) => new RegExp(p)
    );
  }

  get name() {
    return this.#message;
  }

  getTemplates() {
    return {
      "{name}":     (ctx) => path.basename(ctx.file, path.extname(ctx.file)),
      "{name_we}": (ctx) => path.basename(ctx.file),
      "{ext}":      (ctx) => path.extname(ctx.file),
      "{dir}":      (ctx) => path.dirname(path.relative(ctx.repoRoot, ctx.file)),
    };
  }

  async lint(file) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const violations = [];

      if (this.#multiline) {
        const re = new RegExp(this.#pattern.source, this.#pattern.flags);
        let m;
        while ((m = re.exec(content)) !== null) {
          const lineNo = content.slice(0, m.index).split("\n").length;
          violations.push(`  line ${lineNo}: ${m[0].length > 80 ? m[0].slice(0, 80) + "…" : m[0]}`);
          if (!re.global) break;
        }
      } else {
        for (const [lineNo, line] of content.split("\n").entries()) {
          if (this.#skipLineRes.some((re) => re.test(line))) continue;

          const re = new RegExp(this.#pattern.source, this.#pattern.flags);
          let m;
          while ((m = re.exec(line)) !== null) {
            violations.push(`  line ${lineNo + 1}: ${m[0]}`);
            if (!re.global) break;
          }
        }
      }

      if (violations.length > 0) {
        return {
          status: "fail",
          output: `${this.#message} (${violations.length} hit(s)):\n${violations.join("\n")}`,
        };
      }
      return { status: "pass" };
    } catch (err) {
      return { status: "error", output: err.message };
    }
  }

  async fix(file) {
    if (!this.#replacement) {
      return this.lint(file);
    }

    try {
      const original = await fs.readFile(file, "utf-8");
      const replacement = this.resolveTemplate(this.#replacement, {
        file: path.resolve(file),
        repoRoot: this.repoRoot,
      });

      let fixed;
      if (this.#multiline) {
        const re = new RegExp(this.#pattern.source, this.#pattern.flags);
        fixed = original.replace(re, replacement);
      } else {
        const lines = original.split("\n");
        fixed = lines
          .map((line) => {
            if (this.#skipLineRes.some((re) => re.test(line))) return line;
            const re = new RegExp(this.#pattern.source, this.#pattern.flags);
            return line.replace(re, replacement);
          })
          .join("\n");
      }

      if (fixed !== original) {
        await fs.writeFile(file, fixed, "utf-8");
        return { status: "fixed" };
      }
      return { status: "pass" };
    } catch (err) {
      return { status: "error", output: err.message };
    }
  }

  static getHelp() {
    return {
      name: "RegexCheck",
      description:
        "Generic regex-based check. Finds lines matching a pattern and " +
        "optionally auto-fixes them using a replacement string. " +
        "Fully configured via options in linter-config.json.",
      options:
        "pattern — regex to match violations (required)\n" +
        '    patternFlags — regex flags (default: "g")\n' +
        "    replacement — replacement string for fix mode ($1, $2, … for groups; supports {name}/{name_we}/{ext}/{dir} templates)\n" +
        "    multiline — if true, regex operates on entire file content instead of per-line (default: false)\n" +
        '    message — error message (default: "regex violation")\n' +
        "    skipLinePatterns — array of regex strings; matching lines are skipped (ignored when multiline is true)",
    };
  }
}
