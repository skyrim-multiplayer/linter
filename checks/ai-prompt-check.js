import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { BaseCheck } from "./base-check.js";

/**
 * AI Prompt check — invokes the Claude CLI (`claude`) with
 * `--dangerously-skip-permissions` to let it run any commands and
 * edit any files autonomously.
 *
 * Options (from linter-config.json):
 *   prompt — instruction telling the AI what to check (required)
 *   model  — Claude model name (optional, uses CLI default if omitted)
 *
 * Lint mode:
 *   Pipes file content + prompt to `claude --print` and asks for a
 *   JSON verdict: { "pass": true/false, "reason": "..." }
 *
 * Fix mode:
 *   Invokes Claude CLI with full permissions. Claude reads and edits
 *   the file directly, then reports what it changed.
 */
export class AiPromptCheck extends BaseCheck {
  #prompt;
  #lintPrompt;
  #fixPrompt;
  #model;

  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
    const coerce = (v) => (v == null ? undefined : Array.isArray(v) ? v.join("\n") : v);

    this.#prompt = coerce(options.prompt);
    this.#lintPrompt = coerce(options.lintPrompt);
    this.#fixPrompt = coerce(options.fixPrompt);

    if (!this.#prompt && !this.#lintPrompt && !this.#fixPrompt) {
      throw new Error("AiPromptCheck requires at least one of: prompt, lintPrompt, fixPrompt");
    }

    this.#model = options.model || undefined;
  }

  get name() {
    const label = this.#prompt || this.#lintPrompt || this.#fixPrompt;
    return `AI Prompt (${label.slice(0, 50)}${label.length > 50 ? "…" : ""})`;
  }

  checkDeps() {
    return true;
  }

  async lint(file, _deps) {
    let content;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch (err) {
      return { status: "error", output: `cannot read file: ${err.message}` };
    }

    const relFile = path.relative(this.repoRoot, file);
    const instruction = this.#lintPrompt || this.#prompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for lint (set prompt or lintPrompt)" };
    }

    const prompt =
      `You are a code review assistant integrated into a linter.\n` +
      `File: ${relFile}\n` +
      `Instruction: ${instruction}\n\n` +
      `--- file content ---\n${content}\n--- end of file ---\n\n` +
      `Respond with ONLY a JSON object (no markdown fences): ` +
      `{ "pass": true/false, "reason": "short explanation" }`;

    let reply;
    try {
      reply = await this.#callClaude(prompt, { print: true });
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
      return { status: "pass" };
    }
    return { status: "fail", output: verdict.reason || "AI check failed (no reason provided)" };
  }

  async fix(file, _deps) {
    const absFile = path.resolve(file);
    const relFile = path.relative(this.repoRoot, file);
    const instruction = this.#fixPrompt || this.#prompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for fix (set prompt or fixPrompt)" };
    }

    const prompt =
      `You are a code fixing assistant integrated into a linter.\n` +
      `The file to fix is: ${absFile}\n` +
      `Instruction: ${instruction}\n\n` +
      `Read the file, apply the fix directly by editing it, then respond ` +
      `with ONLY a JSON object (no markdown fences): ` +
      `{ "changed": true/false, "reason": "short explanation" }. ` +
      `If no changes are needed set changed to false.`;

    let reply;
    try {
      reply = await this.#callClaude(prompt, { print: false });
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

    if (!result.changed) {
      return { status: "pass" };
    }

    return { status: "fixed", output: result.reason || "AI applied fixes" };
  }

  /**
   * @param {string} prompt
   * @param {{ print?: boolean }} opts  — print: true for lint (text-only),
   *                                      false for fix (agentic, can edit files)
   */
  #callClaude(prompt, { print = true } = {}) {
    return new Promise((resolve, reject) => {
      const args = ["--dangerously-skip-permissions"];
      if (print) {
        args.push("--print");
      }
      if (this.#model) {
        args.push("--model", this.#model);
      }

      const proc = spawn("claude", args, {
        cwd: this.repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => { stdout += data; });
      proc.stderr.on("data", (data) => { stderr += data; });

      proc.on("error", (err) => {
        if (err.code === "ENOENT") {
          reject(new Error("claude CLI not found on PATH"));
        } else {
          reject(err);
        }
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          const parts = [`claude exited with code ${code}`];
          if (stderr.trim()) parts.push(`stderr: ${stderr.trim()}`);
          if (stdout.trim()) parts.push(`stdout: ${stdout.trim()}`);
          reject(new Error(parts.join("\n")));
          return;
        }
        resolve(stdout.trim());
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  static getHelp() {
    return {
      name: "AiPromptCheck",
      description:
        "Invokes the Claude CLI with a user-defined prompt. " +
        "Lint asks Claude to evaluate pass/fail. Fix lets Claude edit the file directly.",
      options:
        "prompt — shared instruction for the AI (string or array); " +
        "lintPrompt — lint-specific instruction (overrides prompt); " +
        "fixPrompt — fix-specific instruction (overrides prompt); " +
        "model — Claude model (optional, uses CLI default)",
    };
  }
}
