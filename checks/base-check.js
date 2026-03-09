import path from "path";
import fs from "fs/promises";

/**
 * @typedef {"pass" | "fail" | "fixed" | "error"} CheckStatus
 */

/**
 * @typedef {Object} CheckResult
 * @property {CheckStatus} status  - Outcome of the check.
 * @property {string}      [output] - Optional diagnostic text (diff, error message, etc.).
 */

/**
 * Base class for all linter checks.
 * Subclasses must implement: name, checkDeps, lint, fix.
 *
 * appliesTo() is provided by BaseCheck using options from config:
 *   options.extensions   - array of extensions to include (e.g. [".cpp", ".h"])
 *   options.includePaths - array of path substrings; file must match at least one (if set)
 *   options.excludePaths - array of path substrings to skip
 *   options.textOnly     - if true, skip binary files (default: false)
 *   options.priority     - numeric priority (lower runs first, default: 0)
 *
 * All methods that touch files are async.
 * appliesTo(), lint() and fix() return Promises.
 *
 * Checks must NOT write to stdout/stderr directly.
 */
export class BaseCheck {
  #extensions;
  #includePaths;
  #excludePaths;
  #textOnly;
  #priority;

  constructor(repoRoot, options = {}) {
    this.repoRoot = repoRoot;
    this.#extensions = (options.extensions || []).map((e) => e.toLowerCase());
    this.#includePaths = options.includePaths || [];
    this.#excludePaths = options.excludePaths || [];
    this.#textOnly = options.textOnly ?? false;
    this.#priority = options.priority ?? 0;
  }

  /**
   * @returns {number} Numeric priority (lower runs first).
   */
  get priority() {
    return this.#priority;
  }

  /**
   * @returns {string} Human-readable name of the check.
   */
  get name() {
    throw new Error("Not implemented: name");
  }

  /**
   * Whether this check's dependencies are satisfied.
   * @param {object} deps - Resolved dependencies (e.g. { clangFormatPath }).
   * @returns {boolean}
   */
  checkDeps(deps) {
    return true;
  }

  /**
   * Whether this check applies to the given file.
   * Uses config-driven extensions, excludePaths, and textOnly.
   * Subclasses can override for extra logic but should await super.appliesTo().
   * @param {string} file - Absolute path to the file.
   * @returns {Promise<boolean>}
   */
  async appliesTo(file) {
    // includePaths check (if set, file must match at least one)
    if (this.#includePaths.length > 0) {
      if (!this.#includePaths.some((p) => file.includes(p))) return false;
    }

    // excludePaths check
    for (const p of this.#excludePaths) {
      if (file.includes(p)) return false;
    }

    // extensions filter (empty = all extensions allowed)
    if (this.#extensions.length > 0) {
      const ext = path.extname(file).toLowerCase();
      if (!this.#extensions.includes(ext)) return false;
    }

    // binary file detection
    if (this.#textOnly) {
      let fh;
      try {
        fh = await fs.open(file, "r");
        const buffer = Buffer.alloc(1024);
        const { bytesRead } = await fh.read(buffer, 0, 1024, 0);
        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] === 0) return false;
        }
      } catch {
        return false;
      } finally {
        if (fh) await fh.close();
      }
    }

    return true;
  }

  /**
   * Resolve and download tools this check depends on.
   * Called once before running lint/fix. The returned object is merged
   * into the shared deps bag.
   * Subclasses should override to download/locate their tools.
   * @param {{ shouldDownload: boolean, shouldSearchInPath: boolean, toolsDir: string }} options
   * @returns {Promise<object>} Key-value pairs to merge into deps.
   */
  async resolveDeps(_options) {
    return {};
  }

  /**
   * Lint (read-only check) a single file.
   * @param {string} file - Absolute path.
   * @param {object} deps - Resolved dependencies.
   * @returns {Promise<CheckResult>}
   */
  async lint(file, deps) {
    throw new Error("Not implemented: lint");
  }

  /**
   * Fix (in-place modify) a single file.
   * @param {string} file - Absolute path.
   * @param {object} deps - Resolved dependencies.
   * @returns {Promise<CheckResult>}
   */
  async fix(file, deps) {
    throw new Error("Not implemented: fix");
  }

  /**
   * Optional combined lint+fix in a single operation.
   * Checks that can evaluate and fix in one step (e.g. a single AI call)
   * should override this. Return null to signal that the check does not
   * support combined mode — the runner will fall back to fix().
   * @param {string} file - Absolute path.
   * @param {object} deps - Resolved dependencies.
   * @returns {Promise<CheckResult | null>}
   */
  async lintAndFix(file, deps) {
    return null;
  }

  /**
   * Return template placeholders this check supports.
   * Keys are placeholder strings, values are functions (context) => replacement.
   * Subclasses override to provide their own templates.
   * @param {object} [context] - Contextual info (e.g. { file, repoRoot }).
   * @returns {Record<string, (ctx: object) => string>}
   */
  getTemplates() {
    return {};
  }

  /**
   * Expand all placeholders from getTemplates() in the given string.
   * @param {string} template - String containing placeholders.
   * @param {object} context  - Passed to each template function.
   * @returns {string}
   */
  resolveTemplate(template, context) {
    let result = template;
    for (const [placeholder, fn] of Object.entries(this.getTemplates())) {
      result = result.replaceAll(placeholder, fn(context));
    }
    return result;
  }

  /**
   * Return help info for this check class.
   * Subclasses should override to provide specific details.
   * @returns {{ name: string, description: string, options: string }}
   */
  static getHelp() {
    return { name: "BaseCheck", description: "Abstract base class for checks.", options: "extensions, includePaths, excludePaths, textOnly, priority" };
  }
}
