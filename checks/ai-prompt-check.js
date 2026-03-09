import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { BaseCheck } from "./base-check.js";
import { ClaudeProvider } from "../ai-providers/claude.js";
import { GeminiProvider } from "../ai-providers/gemini.js";

const AI_PROVIDERS = {
  claude: ClaudeProvider,
  gemini: GeminiProvider,
};

const LOCKFILE_NAME = ".ai-prompt-lock.json";

/**
 * AI Prompt check — invokes an AI CLI (Claude or Gemini) in a
 * text-only workflow.
 *
 * Options (from linter-config.json):
 *   aiProvider     — which AI provider to use: "claude" (default) or "gemini"
 *   lintPrompt     — lint-specific instruction
 *   fixPrompt      — fix-specific instruction
 *   filesToRead    — additional files to include as context (array of paths)
 *                    Supports templates: {name_without_ext} (filename without ext),
 *                    {name_with_ext} (filename with ext), {ext} (extension with dot),
 *                    {dir} (directory relative to repo root).
 *   lock           — if true, cache AI results per file in .ai-prompt-lock.json;
 *                    files whose normalized-content hash hasn't changed are skipped.
 *                    Legacy lock value 1 is treated as a universal match.
 *   lockValue      — optional lock write mode; set to 1 to keep writing
 *                    universal lock entries instead of file hashes.
 *
 * Lint mode:
 *   Pipes selected file contents + prompt to the AI CLI and asks for a
 *   JSON verdict: { "pass": true/false, "reason": "..." }
 *
 * Fix mode:
 *   Sends selected file contents to the AI CLI and expects JSON with
 *   updated content for allowed files only. This check applies edits itself.
 */
export class AiPromptCheck extends BaseCheck {
  #lintPrompt;
  #fixPrompt;
  #filesToRead;
  #lock;
  #lockValue;
  #provider;

  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
    const coerce = (v) => (v == null ? undefined : Array.isArray(v) ? v.join("\n") : v);
    const coerceArray = (v) => {
      if (v == null) return [];
      return Array.isArray(v) ? v : [v];
    };

    this.#lintPrompt = coerce(options.lintPrompt);
    this.#fixPrompt = coerce(options.fixPrompt);

    if (!this.#lintPrompt && !this.#fixPrompt) {
      throw new Error("AiPromptCheck requires at least one of: lintPrompt, fixPrompt");
    }

    this.#filesToRead = coerceArray(options.filesToRead ?? options.contextFiles);
    this.#lock = !!options.lock;
    this.#lockValue = options.lockValue;

    const providerName = (options.aiProvider || "claude").toLowerCase();
    const ProviderClass = AI_PROVIDERS[providerName];
    if (!ProviderClass) {
      throw new Error(`Unknown aiProvider "${providerName}". Available: ${Object.keys(AI_PROVIDERS).join(", ")}`);
    }
    this.#provider = new ProviderClass();
  }

  get name() {
    const label = this.#lintPrompt || this.#fixPrompt;
    return `AI Prompt (${label.slice(0, 50)}${label.length > 50 ? "…" : ""})`;
  }

  checkDeps() {
    return true;
  }

  getTemplates() {
    return {
      "{name_without_ext}": (ctx) => path.basename(ctx.file, path.extname(ctx.file)),
      "{name_with_ext}":    (ctx) => path.basename(ctx.file),
      "{ext}":      (ctx) => path.extname(ctx.file),
      "{dir}":      (ctx) => path.dirname(path.relative(ctx.repoRoot, ctx.file)),
    };
  }

  async lint(file, _deps) {
    const relFile = path.relative(this.repoRoot, file);
    const instruction = this.#lintPrompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for lint (set lintPrompt)" };
    }

    const promptFiles = this.#dedupePaths([file, ...this.#resolvePaths(this.#filesToRead, file)]);
    const context = await this.#buildFileContext(promptFiles);
    if (context.error) {
      return { status: "error", output: context.error };
    }

    if (this.#lock && await this.#lockMatches(relFile, file)) {
      return { status: "pass" };
    }

    const prompt =
      `You are a code review assistant integrated into a linter.\n` +
      `Primary file: ${relFile}\n` +
      `Instruction: ${instruction}\n\n` +
      `${context.value}\n\n` +
      `Respond with ONLY a JSON object (no markdown fences): ` +
      `{ "pass": true/false, "reason": "short explanation" }`;

    let reply;
    try {
      reply = await this.#provider.call(prompt, { cwd: this.repoRoot });
    } catch (err) {
      return { status: "error", output: `${this.#provider.name} error: ${err.message}` };
    }

    let verdict;
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      verdict = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
    } catch {
      return { status: "error", output: `${this.#provider.name} returned invalid JSON: ${reply}` };
    }

    if (verdict.pass) {
      if (this.#lock) await this.#lockWrite(relFile, file);
      return { status: "pass" };
    }
    return { status: "fail", output: verdict.reason || "AI check failed (no reason provided)" };
  }

  async fix(file, _deps) {
    const relFile = path.relative(this.repoRoot, file);
    const instruction = this.#fixPrompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for fix (set fixPrompt)" };
    }

    const absFile = path.resolve(file);
    const filesToRead = this.#dedupePaths([absFile, ...this.#resolvePaths(this.#filesToRead, file)]);

    const context = await this.#buildFileContext(filesToRead);
    if (context.error) {
      return { status: "error", output: context.error };
    }

    if (this.#lock && await this.#lockMatches(relFile, absFile)) {
      return { status: "pass" };
    }

    const prompt =
      `You are a code fixing assistant integrated into a linter.\n` +
      `File to fix: ${relFile}\n` +
      `Instruction: ${instruction}\n\n` +
      `${context.value}\n\n` +
      `Respond with ONLY a JSON object (no markdown fences): ` +
      `{ "changed": true/false, "reason": "short explanation", "content": "full new file content" }. ` +
      `If no changes are needed, set changed to false and omit content.`;

    let reply;
    try {
      reply = await this.#provider.call(prompt, { cwd: this.repoRoot });
    } catch (err) {
      return { status: "error", output: `${this.#provider.name} error: ${err.message}` };
    }

    let result;
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
    } catch {
      return { status: "error", output: `${this.#provider.name} returned invalid JSON: ${reply}` };
    }

    if (!result.changed || typeof result.content !== "string") {
      if (this.#lock) await this.#lockWrite(relFile, absFile);
      return { status: "pass" };
    }

    let current;
    try {
      current = await fs.readFile(absFile, "utf-8");
    } catch (err) {
      return { status: "error", output: `cannot read file before applying AI fix: ${err.message}` };
    }

    if (current === result.content) {
      return { status: "pass", output: result.reason || "AI reported changes but file content was identical" };
    }

    await fs.writeFile(absFile, result.content, "utf-8");

    if (this.#lock) await this.#lockWrite(relFile, absFile);

    return { status: "fixed", output: result.reason || "AI applied fixes" };
  }

  /**
   * Combined lint + fix in a single AI call.
   * When both lintPrompt and fixPrompt are configured, evaluates the file
   * against lint criteria and applies the fix if needed — one round-trip.
   * Returns null when combined mode is not available (only one prompt set).
   */
  async lintAndFix(file, _deps) {
    if (!this.#lintPrompt || !this.#fixPrompt) return null;

    const relFile = path.relative(this.repoRoot, file);
    const absFile = path.resolve(file);
    const filesToRead = this.#dedupePaths([absFile, ...this.#resolvePaths(this.#filesToRead, file)]);

    const context = await this.#buildFileContext(filesToRead);
    if (context.error) {
      return { status: "error", output: context.error };
    }

    if (this.#lock && await this.#lockMatches(relFile, absFile)) {
      return { status: "pass" };
    }

    const prompt =
      `You are a code review and fixing assistant integrated into a linter.\n` +
      `File: ${relFile}\n\n` +
      `Lint criteria: ${this.#lintPrompt}\n` +
      `Fix instruction: ${this.#fixPrompt}\n\n` +
      `${context.value}\n\n` +
      `First evaluate the file against the lint criteria.\n` +
      `If the file PASSES, respond with ONLY a JSON object (no markdown fences):\n` +
      `{ "pass": true, "reason": "short explanation" }\n\n` +
      `If the file FAILS, apply the fix instruction and respond with ONLY a JSON object (no markdown fences):\n` +
      `{ "pass": false, "reason": "short explanation of what was wrong", "content": "full corrected file content" }\n` +
      `If the file fails but cannot be fixed, set pass to false and omit content.`;

    let reply;
    try {
      reply = await this.#provider.call(prompt, { cwd: this.repoRoot });
    } catch (err) {
      return { status: "error", output: `${this.#provider.name} error: ${err.message}` };
    }

    let result;
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
    } catch {
      return { status: "error", output: `${this.#provider.name} returned invalid JSON: ${reply}` };
    }

    if (result.pass) {
      if (this.#lock) await this.#lockWrite(relFile, absFile);
      return { status: "pass" };
    }

    if (typeof result.content !== "string") {
      return { status: "fail", output: result.reason || "AI check failed and could not produce a fix" };
    }

    let current;
    try {
      current = await fs.readFile(absFile, "utf-8");
    } catch (err) {
      return { status: "error", output: `cannot read file before applying AI fix: ${err.message}` };
    }

    if (current === result.content) {
      return { status: "pass", output: result.reason || "AI reported changes but file content was identical" };
    }

    await fs.writeFile(absFile, result.content, "utf-8");

    if (this.#lock) await this.#lockWrite(relFile, absFile);

    return { status: "fixed", output: result.reason || "AI applied fixes" };
  }

  #resolvePaths(paths, file) {
    return paths.map((p) => {
      const expanded = file
        ? this.resolveTemplate(p, { file: path.resolve(file), repoRoot: this.repoRoot })
        : p;
      const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(this.repoRoot, expanded);
      return path.resolve(candidate);
    });
  }

  async #readLockfile() {
    const lockPath = path.join(this.repoRoot, LOCKFILE_NAME);
    try {
      return JSON.parse(await fs.readFile(lockPath, "utf-8"));
    } catch { 
      return {};
    }
  }

  async #lockMatches(relFile, absFile) {
    const lock = await this.#readLockfile();
    const entry = lock[this.name]?.[relFile];

    if (entry == null) return false;
    if (entry === 1) return true;
    if (typeof entry !== "string") return false;

    try {
      const hash = await this.#getFileHash(absFile);
      return hash === entry;
    } catch {
      return false;
    }
  }

  async #lockWrite(relFile, absFile) {
    const lockPath = path.join(this.repoRoot, LOCKFILE_NAME);
    const lock = await this.#readLockfile();
    if (!lock[this.name]) lock[this.name] = {};

    const writeUniversal = this.#lockValue === 1 || this.#lockValue === "1";
    lock[this.name][relFile] = writeUniversal ? 1 : await this.#getFileHash(absFile);

    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
  }

  async #getFileHash(file) {
    const raw = await fs.readFile(path.resolve(file), "utf-8");
    const normalized = raw.replace(/\r\n?/g, "\n");
    return createHash("sha256").update(normalized).digest("hex");
  }

  #dedupePaths(paths) {
    return Array.from(new Set(paths.map((p) => path.resolve(p))));
  }

  async #buildFileContext(absPaths) {
    const chunks = [];
    for (const absPath of absPaths) {
      const rel = path.relative(this.repoRoot, absPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return { error: `path outside repo root is not allowed: ${absPath}` };
      }
      let content;
      try {
        content = await fs.readFile(absPath, "utf-8");
      } catch (err) {
        return { error: `cannot read context file ${rel}: ${err.message}` };
      }
      chunks.push(`--- file: ${rel} ---\n${content}\n--- end file: ${rel} ---`);
    }
    return { value: chunks.join("\n\n") };
  }

  static getHelp() {
    return {
      name: "AiPromptCheck",
      description:
        "Invokes an AI CLI (Claude or Gemini) with a user-defined prompt. " +
        "Lint asks the AI to evaluate pass/fail. Fix asks the AI for updated file content and applies it.",
      options:
        "aiProvider — which AI provider to use: 'claude' (default) or 'gemini'; " +
        "lintPrompt — lint-specific instruction (string or array); " +
        "fixPrompt — fix-specific instruction (string or array); " +
        "filesToRead — additional context files (array of paths, supports {name_without_ext}/{name_with_ext}/{ext}/{dir} templates); " +
        "lock — cache AI results per file in .ai-prompt-lock.json (boolean, default false); " +
        "lockValue — optional write mode, set to 1 to store universal lock entries instead of file hashes",
    };
  }
}
