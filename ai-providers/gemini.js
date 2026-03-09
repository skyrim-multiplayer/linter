import { spawn } from "child_process";
import { BaseAiProvider } from "./base-ai-provider.js";

/**
 * AI provider that invokes the Gemini CLI (`gemini -p`).
 */
export class GeminiProvider extends BaseAiProvider {
  get name() {
    return "Gemini CLI";
  }

  checkDeps() {
    return true;
  }

  /**
   * Send a prompt to `gemini` via stdin and return the response.
   * The Gemini CLI detects non-TTY stdin and uses it as a headless prompt.
   * @param {string} prompt
   * @param {{ cwd?: string }} options
   * @returns {Promise<string>}
   */
  async call(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn("gemini", [], {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => { stdout += data; });
      proc.stderr.on("data", (data) => { stderr += data; });

      proc.on("error", (err) => {
        if (err.code === "ENOENT") {
          reject(new Error("gemini CLI not found on PATH"));
        } else {
          reject(err);
        }
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          const parts = [`gemini exited with code ${code}`];
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
      name: "GeminiProvider",
      description: "Invokes the Gemini CLI (gemini) to get AI responses via stdin in headless mode.",
    };
  }
}
