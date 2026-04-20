import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { BaseCheck } from "./base-check.js";
import {
  coerce, coerceArray, standardTemplates, resolvePaths, dedupePaths,
  buildFilesMap, lockfilePath, lockMatches, lockWrite,
} from "./check-utils.js";

const DEFAULT_POLL_INTERVAL = 3000;
const DEFAULT_TIMEOUT = 300_000;

/**
 * Agent check — sends files to a remote agent server for analysis/fixing
 * in a sandboxed environment via async HTTP task API.
 *
 * Options (from linter-config.json):
 *   agentUrl        — base URL of the agent server (required)
 *   agentApiKey     — API key; if starts with "$", read from env var (required)
 *   lintPrompt      — instruction for lint mode
 *   fixPrompt       — instruction for fix mode
 *   filesToRead     — additional context files (array of paths, supports templates)
 *   allowedWritePaths — glob patterns for paths the agent may write to (required for fix)
 *   compileCommand  — shell command to verify fix, supports templates (e.g. "tsc --noEmit", "g++ -c {dir}/{name_with_ext} -o /dev/null -I include/")
 *   maxRetries      — max AI retry attempts when compile fails (default: 3)
 *   timeout         — overall timeout in ms (default: 300000)
 *   pollInterval    — polling interval in ms (default: 3000)
 *   lock            — cache results per file in .ai-prompt-lock.json (default: false)
 *
 * Protocol:
 *   POST {agentUrl}/tasks  → { taskId, status: "pending" }
 *   GET  {agentUrl}/tasks/{taskId} → { status, progress?, result?, error? }
 *   Statuses: pending → running → completed | failed
 */
export class AgentCheck extends BaseCheck {
  #agentUrl;
  #agentApiKey;
  #lintPrompt;
  #fixPrompt;
  #filesToRead;
  #allowedWritePatterns;
  #compileCommand;
  #maxRetries;
  #timeout;
  #pollInterval;
  #lock;

  constructor(repoRoot, options = {}) {
    super(repoRoot, options);

    if (!options.agentUrl) {
      throw new Error("AgentCheck requires options.agentUrl");
    }
    if (!options.agentApiKey) {
      throw new Error("AgentCheck requires options.agentApiKey");
    }

    const coerceStr = (v) => (v == null ? undefined : Array.isArray(v) ? v.join("\n") : v);

    this.#agentUrl = options.agentUrl.replace(/\/+$/, "");
    this.#agentApiKey = options.agentApiKey;
    this.#lintPrompt = coerceStr(options.lintPrompt);
    this.#fixPrompt = coerceStr(options.fixPrompt);

    if (!this.#lintPrompt && !this.#fixPrompt) {
      throw new Error("AgentCheck requires at least one of: lintPrompt, fixPrompt");
    }

    this.#filesToRead = coerceArray(options.filesToRead ?? options.contextFiles);
    this.#allowedWritePatterns = coerceArray(options.allowedWritePaths);
    this.#compileCommand = options.compileCommand ?? null;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.#pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.#lock = !!options.lock;
  }

  get name() {
    const label = this.#lintPrompt || this.#fixPrompt;
    return `Agent (${label.slice(0, 50)}${label.length > 50 ? "…" : ""})`;
  }

  checkDeps() {
    return true;
  }

  getTemplates() {
    return standardTemplates();
  }

  // ── lint ────────────────────────────────────────────────────────────

  async lint(file, _deps) {
    const instruction = this.#lintPrompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for lint (set lintPrompt)" };
    }

    const relFile = path.relative(this.repoRoot, file);

    if (this.#lock && await lockMatches(this.name, relFile, file, this.repoRoot)) {
      return { status: "pass" };
    }

    const filesMap = await this.#buildFilesMap(file);
    if (filesMap.error) {
      return { status: "error", output: filesMap.error };
    }

    let result;
    try {
      result = await this.#runAgent({
        prompt: instruction,
        mode: "lint",
        primaryFile: relFile,
        files: filesMap.value,
      });
    } catch (err) {
      return { status: "error", output: `Agent error: ${err.message}` };
    }

    if (result.pass) {
      if (this.#lock) await lockWrite(this.name, relFile, file, this.repoRoot);
      return { status: "pass" };
    }
    return { status: "fail", output: result.reason || "Agent check failed (no reason provided)" };
  }

  // ── fix ─────────────────────────────────────────────────────────────

  async fix(file, _deps) {
    const instruction = this.#fixPrompt;
    if (!instruction) {
      return { status: "error", output: "No prompt configured for fix (set fixPrompt)" };
    }

    const absFile = path.resolve(file);
    const relFile = path.relative(this.repoRoot, absFile);
    const lockPath = lockfilePath(this.repoRoot);

    if (this.#lock && await lockMatches(this.name, relFile, absFile, this.repoRoot)) {
      return { status: "pass" };
    }

    if (this.#compileCommand) {
      for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
        const compile = await this.#runCompile(absFile);

        if (!compile.failed) {
          if (this.#lock) await lockWrite(this.name, relFile, absFile, this.repoRoot);
          const status = attempt === 0 ? "pass" : "fixed";
          return { status, ...(this.#lock && { extraFiles: [lockPath] }) };
        }

        if (attempt === this.#maxRetries) {
          return { status: "error", output: `Compilation still failing after ${this.#maxRetries} attempt(s):\n${compile.output}` };
        }

        const filesMap = await this.#buildFilesMap(file);
        if (filesMap.error) return { status: "error", output: filesMap.error };

        const compileNote = attempt === 0
          ? `\n\nCompiler output:\n${compile.output}`
          : `\n\nPrevious fix did not compile. Compiler output:\n${compile.output}`;

        let result;
        try {
          result = await this.#runAgent({
            prompt: instruction + compileNote,
            mode: "fix",
            primaryFile: relFile,
            files: filesMap.value,
          });
        } catch (err) {
          return { status: "error", output: `Agent error: ${err.message}` };
        }

        if (result.pass || !result.files || Object.keys(result.files).length === 0) {
          return { status: "fail", output: `AI reported no fix needed but compilation failed:\n${compile.output}` };
        }

        const written = await this.#applyFiles(result.files, absFile);
        if (written.error) return { status: "error", output: written.error };
        if (written.paths.length === 0) {
          return { status: "fail", output: result.reason || "Agent returned files but none matched allowedWritePaths" };
        }
      }
    }

    const filesMap = await this.#buildFilesMap(file);
    if (filesMap.error) {
      return { status: "error", output: filesMap.error };
    }

    let result;
    try {
      result = await this.#runAgent({
        prompt: instruction,
        mode: "fix",
        primaryFile: relFile,
        files: filesMap.value,
      });
    } catch (err) {
      return { status: "error", output: `Agent error: ${err.message}` };
    }

    if (result.pass || !result.files || Object.keys(result.files).length === 0) {
      if (this.#lock) await lockWrite(this.name, relFile, absFile, this.repoRoot);
      return { status: "pass", ...(this.#lock && { extraFiles: [lockPath] }) };
    }

    const written = await this.#applyFiles(result.files, absFile);
    if (written.error) {
      return { status: "error", output: written.error };
    }

    if (written.paths.length === 0) {
      return { status: "fail", output: result.reason || "Agent returned files but none matched allowedWritePaths" };
    }

    if (this.#lock) await lockWrite(this.name, relFile, absFile, this.repoRoot);

    const extras = written.paths.filter((p) => p !== absFile);
    if (this.#lock) extras.push(lockPath);

    return {
      status: "fixed",
      output: result.reason || "Agent applied fixes",
      ...(extras.length > 0 && { extraFiles: extras }),
    };
  }

  // ── lintAndFix ──────────────────────────────────────────────────────

  async lintAndFix(file, _deps) {
    if (!this.#lintPrompt || !this.#fixPrompt) return null;

    const absFile = path.resolve(file);
    const relFile = path.relative(this.repoRoot, absFile);
    const lockPath = lockfilePath(this.repoRoot);

    if (this.#lock && await lockMatches(this.name, relFile, absFile, this.repoRoot)) {
      return { status: "pass" };
    }

    const filesMap = await this.#buildFilesMap(file);
    if (filesMap.error) {
      return { status: "error", output: filesMap.error };
    }

    let result;
    try {
      result = await this.#runAgent({
        prompt: `Lint criteria: ${this.#lintPrompt}\nFix instruction: ${this.#fixPrompt}`,
        mode: "fix",
        primaryFile: relFile,
        files: filesMap.value,
      });
    } catch (err) {
      return { status: "error", output: `Agent error: ${err.message}` };
    }

    if (result.pass) {
      if (this.#lock) await lockWrite(this.name, relFile, absFile, this.repoRoot);
      return { status: "pass", ...(this.#lock && { extraFiles: [lockPath] }) };
    }

    if (!result.files || Object.keys(result.files).length === 0) {
      return { status: "fail", output: result.reason || "Agent check failed and could not produce a fix" };
    }

    const written = await this.#applyFiles(result.files, absFile);
    if (written.error) {
      return { status: "error", output: written.error };
    }

    if (written.paths.length === 0) {
      return { status: "fail", output: result.reason || "Agent returned files but none matched allowedWritePaths" };
    }

    if (this.#compileCommand) {
      for (let attempt = 0; attempt < this.#maxRetries; attempt++) {
        const compile = await this.#runCompile(absFile);
        if (!compile.failed) break;

        if (attempt === this.#maxRetries - 1) {
          return { status: "error", output: `Compilation still failing after ${this.#maxRetries} attempt(s):\n${compile.output}` };
        }

        const retryFilesMap = await this.#buildFilesMap(file);
        if (retryFilesMap.error) return { status: "error", output: retryFilesMap.error };

        let retryResult;
        try {
          retryResult = await this.#runAgent({
            prompt: `Lint criteria: ${this.#lintPrompt}\nFix instruction: ${this.#fixPrompt}\n\nPrevious fix did not compile. Compiler output:\n${compile.output}`,
            mode: "fix",
            primaryFile: relFile,
            files: retryFilesMap.value,
          });
        } catch (err) {
          return { status: "error", output: `Agent error: ${err.message}` };
        }

        if (retryResult.pass || !retryResult.files || Object.keys(retryResult.files).length === 0) {
          return { status: "fail", output: `AI reported no fix needed but compilation failed:\n${compile.output}` };
        }

        const retryWritten = await this.#applyFiles(retryResult.files, absFile);
        if (retryWritten.error) return { status: "error", output: retryWritten.error };
        if (retryWritten.paths.length === 0) {
          return { status: "fail", output: retryResult.reason || "Agent returned files but none matched allowedWritePaths" };
        }
      }
    }

    if (this.#lock) await lockWrite(this.name, relFile, absFile, this.repoRoot);

    const extras = written.paths.filter((p) => p !== absFile);
    if (this.#lock) extras.push(lockPath);

    return {
      status: "fixed",
      output: result.reason || "Agent applied fixes",
      ...(extras.length > 0 && { extraFiles: extras }),
    };
  }

  // ── HTTP transport ──────────────────────────────────────────────────

  async #runAgent(payload) {
    const apiKey = this.#resolveApiKey();
    if (!apiKey) {
      throw new Error("Agent API key not configured. Set agentApiKey in options or the referenced env var.");
    }

    // POST /tasks — create task
    const createRes = await fetch(`${this.#agentUrl}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new Error(`POST /tasks failed (${createRes.status}): ${body}`);
    }

    const { taskId } = await createRes.json();
    if (!taskId) {
      throw new Error("POST /tasks response missing taskId");
    }

    // Poll GET /tasks/{taskId}
    const deadline = Date.now() + this.#timeout;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.#pollInterval));

      const pollRes = await fetch(`${this.#agentUrl}/tasks/${encodeURIComponent(taskId)}`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!pollRes.ok) {
        const body = await pollRes.text().catch(() => "");
        throw new Error(`GET /tasks/${taskId} failed (${pollRes.status}): ${body}`);
      }

      const task = await pollRes.json();

      if (task.status === "completed") {
        return task.result || { pass: true };
      }
      if (task.status === "failed") {
        throw new Error(task.error || "Agent task failed (no details)");
      }
      // pending / running — continue polling
    }

    throw new Error(`Agent task ${taskId} timed out after ${this.#timeout}ms`);
  }

  // ── Compile verification ────────────────────────────────────────────

  #runCompile(absCurrentFile) {
    const cmd = this.resolveTemplate(this.#compileCommand, { file: absCurrentFile, repoRoot: this.repoRoot });
    return new Promise((resolve) => {
      const proc = spawn(cmd, [], {
        cwd: this.repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });

      let output = "";
      proc.stdout.on("data", (d) => { output += d; });
      proc.stderr.on("data", (d) => { output += d; });

      proc.on("close", (code) => resolve({ failed: code !== 0, output: output.trim() }));
      proc.on("error", (err) => resolve({ failed: true, output: err.message }));
    });
  }

  #resolveApiKey() {
    let key = this.#agentApiKey;
    if (key && key.startsWith("$")) {
      key = process.env[key.slice(1)] || null;
    }
    return key || null;
  }

  // ── File I/O helpers ────────────────────────────────────────────────

  async #buildFilesMap(file) {
    const absFile = path.resolve(file);
    const contextPaths = resolvePaths(this.#filesToRead, file, this.resolveTemplate.bind(this), this.repoRoot);
    const allPaths = dedupePaths([absFile, ...contextPaths]);
    return buildFilesMap(allPaths, this.repoRoot);
  }

  /**
   * Apply file changes from agent response, filtered by allowedWritePaths.
   * @returns {{ paths: string[], error?: string }}
   */
  async #applyFiles(files, absCurrentFile) {
    const written = [];
    const resolvedPatterns = this.#resolveWritePatterns(absCurrentFile);

    for (const [relPath, content] of Object.entries(files)) {
      // Normalize and validate
      const normalized = path.normalize(relPath);
      if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        continue; // skip paths outside repo
      }

      if (!this.#isAllowedPath(normalized, resolvedPatterns)) {
        continue; // skip paths not matching allowedWritePaths
      }

      const absPath = path.resolve(this.repoRoot, normalized);

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, "utf-8");
      written.push(absPath);
    }

    return { paths: written };
  }

  /**
   * Expand template placeholders in allowedWritePatterns for the current file.
   * Normalizes result to forward slashes and strips any leading "./".
   */
  #resolveWritePatterns(absCurrentFile) {
    if (!absCurrentFile) return this.#allowedWritePatterns;
    return this.#allowedWritePatterns.map((pattern) =>
      this.resolveTemplate(pattern, { file: absCurrentFile, repoRoot: this.repoRoot })
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
    );
  }

  /**
   * Check if a relative path matches any of the resolved allowedWritePaths globs.
   * Supports simple glob patterns: * (any within segment), ** (any segments).
   */
  #isAllowedPath(relPath, resolvedPatterns) {
    if (resolvedPatterns.length === 0) return true;

    for (const pattern of resolvedPatterns) {
      if (this.#matchGlob(pattern, relPath)) return true;
    }
    return false;
  }

  /**
   * Minimal glob matcher for path filtering.
   * Supports: **\/ (zero or more path segments), ** (catch-all), * (within one segment).
   */
  #matchGlob(pattern, filePath) {
    const p = pattern.replace(/\\/g, "/");
    const f = filePath.replace(/\\/g, "/");
    let regex = "";
    let i = 0;
    while (i < p.length) {
      if (p[i] === "*" && p[i + 1] === "*") {
        if (p[i + 2] === "/") {
          regex += "(?:.+/)?"; // **/ = zero or more path segments
          i += 3;
        } else {
          regex += ".*"; // ** at end
          i += 2;
        }
      } else if (p[i] === "*") {
        regex += "[^/]*";
        i++;
      } else {
        regex += p[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
        i++;
      }
    }
    return new RegExp(`^${regex}$`).test(f);
  }

  // ── Help ────────────────────────────────────────────────────────────

  static getHelp() {
    return {
      name: "AgentCheck",
      description:
        "Sends files to a remote agent server for analysis/fixing in a sandboxed environment. " +
        "Uses async HTTP task API (POST /tasks, GET /tasks/{id}) with polling.",
      options:
        "agentUrl — base URL of agent server (required); " +
        "agentApiKey — API key, prefix with $ to read from env var (required); " +
        "lintPrompt — instruction for lint mode; " +
        "fixPrompt — instruction for fix mode; " +
        "filesToRead — additional context files (supports templates); " +
        "allowedWritePaths — glob patterns for paths agent may write to; " +
        "compileCommand — shell command to verify fix compiles, supports templates (e.g. 'tsc --noEmit' or 'g++ -c {dir}/{name_with_ext} -o /dev/null -I include/'); " +
        "maxRetries — max AI retry attempts when compile fails (default: 3); " +
        "timeout — overall timeout in ms (default: 300000); " +
        "pollInterval — polling interval in ms (default: 3000); " +
        "lock — cache results in .ai-prompt-lock.json (boolean)",
    };
  }
}
