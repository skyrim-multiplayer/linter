import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import { BaseCheck } from "./base-check.js";
import { ClaudeProvider } from "../ai-providers/claude.js";

const LOCKFILE_NAME = ".ai-prompt-lock.json";

/**
 * AI Prompt check — invokes the Claude CLI (`claude --print`) in a
 * text-only workflow.
 *
 * Options (from linter-config.json):
 *   prompt         — shared instruction (required unless lint/fix prompts are set)
 *   lintPrompt     — lint-specific instruction (overrides prompt)
 *   fixPrompt      — fix-specific instruction (overrides prompt)
 *   filesToRead    — additional files to include as context (array of paths)
 *                    Supports templates: {name} (filename without ext),
 *                    {basename} (filename with ext), {ext} (extension with dot),
 *                    {dir} (directory relative to repo root).
 *   lock           — if true, cache AI results per file in .ai-prompt-lock.json;
 *                    files whose content+prompt hash hasn't changed are skipped.
 *
 * Lint mode:
 *   Pipes selected file contents + prompt to `claude --print` and asks for a
 *   JSON verdict: { "pass": true/false, "reason": "..." }
 *
 * Fix mode:
 *   Sends selected file contents to `claude --print` and expects JSON with
 *   updated content for allowed files only. This check applies edits itself.
 */
export class AiPromptCheck extends BaseCheck {
  #prompt;
  #lintPrompt;
  #fixPrompt;
  #filesToRead;
  #lock;
  #provider;

  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
    const coerce = (v) => (v == null ? undefined : Array.isArray(v) ? v.join("\n") : v);
    const coerceArray = (v) => {
      if (v == null) return [];
      return Array.isArray(v) ? v : [v];
    };

    this.#prompt = coerce(options.prompt);
    this.#lintPrompt = coerce(options.lintPrompt);
    this.#fixPrompt = coerce(options.fixPrompt);

    if (!this.#prompt && !this.#lintPrompt && !this.#fixPrompt) {
      throw new Error("AiPromptCheck requires at least one of: prompt, lintPrompt, fixPrompt");
    }

    this.#filesToRead = coerceArray(options.filesToRead ?? options.contextFiles);
    this.#lock = !!options.lock;
    this.#provider = new ClaudeProvider();
  }

  get name() {
    const label = this.#prompt || this.#lintPrompt || this.#fixPrompt;
    return `AI Prompt (${label.slice(0, 50)}${label.length > 50 ? "…" : ""})`;
  }

  checkDeps() {
    return true;
  }

  async lint(file, _deps) {
    const relFile = path.relative(this.repoRoot, file);
    const instruction = this.#lintPrompt || this.#prompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for lint (set prompt or lintPrompt)" };
    }

    const promptFiles = this.#dedupePaths([file, ...this.#resolvePaths(this.#filesToRead, file)]);
    const context = await this.#buildFileContext(promptFiles);
    if (context.error) {
      return { status: "error", output: context.error };
    }

    if (this.#lock) {
      const hash = this.#hash(context.value + "\n" + instruction);
      if (await this.#lockMatches(relFile, hash)) {
        return { status: "pass" };
      }
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
      return { status: "error", output: `Claude CLI error: ${err.message}` };
    }

    let verdict;
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      verdict = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
    } catch {
      return { status: "error", output: `Claude returned invalid JSON: ${reply}` };
    }

    if (verdict.pass) {
      if (this.#lock) {
        const hash = this.#hash(context.value + "\n" + instruction);
        await this.#lockWrite(relFile, hash);
      }
      return { status: "pass" };
    }
    return { status: "fail", output: verdict.reason || "AI check failed (no reason provided)" };
  }

  async fix(file, _deps) {
    const relFile = path.relative(this.repoRoot, file);
    const instruction = this.#fixPrompt || this.#prompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for fix (set prompt or fixPrompt)" };
    }

    const absFile = path.resolve(file);
    const filesToRead = this.#dedupePaths([absFile, ...this.#resolvePaths(this.#filesToRead, file)]);

    const context = await this.#buildFileContext(filesToRead);
    if (context.error) {
      return { status: "error", output: context.error };
    }

    if (this.#lock) {
      const hash = this.#hash(context.value + "\n" + instruction);
      if (await this.#lockMatches(relFile, hash)) {
        return { status: "pass" };
      }
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
      return { status: "error", output: `Claude CLI error: ${err.message}` };
    }

    let result;
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
    } catch {
      return { status: "error", output: `Claude returned invalid JSON: ${reply}` };
    }

    if (!result.changed || typeof result.content !== "string") {
      if (this.#lock) {
        const hash = this.#hash(context.value + "\n" + instruction);
        await this.#lockWrite(relFile, hash);
      }
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

    if (this.#lock) {
      const newContext = await this.#buildFileContext(filesToRead);
      if (!newContext.error) {
        const hash = this.#hash(newContext.value + "\n" + instruction);
        await this.#lockWrite(relFile, hash);
      }
    }

    return { status: "fixed", output: result.reason || "AI applied fixes" };
  }

  #resolvePaths(paths, file) {
    return paths.map((p) => {
      const expanded = file ? this.#expandTemplate(p, file) : p;
      const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(this.repoRoot, expanded);
      return path.resolve(candidate);
    });
  }

  #expandTemplate(template, file) {
    const absFile = path.resolve(file);
    const rel = path.relative(this.repoRoot, absFile);
    const ext = path.extname(rel);
    const basename = path.basename(rel);
    const name = path.basename(rel, ext);
    const dir = path.dirname(rel);
    return template
      .replace(/\{name\}/g, name)
      .replace(/\{basename\}/g, basename)
      .replace(/\{ext\}/g, ext)
      .replace(/\{dir\}/g, dir);
  }

  #hash(content) {
    return createHash("sha256").update(content).digest("hex");
  }

  async #readLockfile() {
    const lockPath = path.join(this.repoRoot, LOCKFILE_NAME);
    try {
      return JSON.parse(await fs.readFile(lockPath, "utf-8"));
    } catch { 
      return {};
    }
  }

  async #lockMatches(relFile, hash) {
    const lock = await this.#readLockfile();
    return lock[this.name]?.[relFile] === hash;
  }

  async #lockWrite(relFile, hash) {
    const lockPath = path.join(this.repoRoot, LOCKFILE_NAME);
    const lock = await this.#readLockfile();
    if (!lock[this.name]) lock[this.name] = {};
    lock[this.name][relFile] = hash;
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
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
        "Invokes the Claude CLI with a user-defined prompt. " +
        "Lint asks Claude to evaluate pass/fail. Fix asks Claude for updated file content and applies it.",
      options:
        "prompt — shared instruction for the AI (string or array); " +
        "lintPrompt — lint-specific instruction (overrides prompt); " +
        "fixPrompt — fix-specific instruction (overrides prompt); " +
        "filesToRead — additional context files (array of paths, supports {name}/{basename}/{ext}/{dir} templates); " +
        "lock — cache AI results per file in .ai-prompt-lock.json (boolean, default false)",
    };
  }
}
