import { promises as fs } from "fs";
import path from "path";
import { BaseCheck } from "./base-check.js";

/**
 * AI Prompt check — sends file content to an OpenAI-compatible API
 * with a user-defined prompt and evaluates the response.
 *
 * Options (from linter-config.json):
 *   prompt   — instruction telling the AI what to check (required)
 *   model    — model name (default: "gpt-4o-mini")
 *   apiUrl   — chat completions endpoint (default: "https://api.openai.com/v1/chat/completions")
 *   envVar   — environment variable holding the API key (default: "OPENAI_API_KEY")
 *
 * Lint mode:
 *   Sends the file content with the prompt to the AI and asks for a
 *   JSON verdict: { "pass": true/false, "reason": "..." }
 *
 * Fix mode:
 *   Asks the AI to return the corrected file content. Writes it back
 *   only if the AI indicates changes were needed.
 */
export class AiPromptCheck extends BaseCheck {
  #prompt;
  #model;
  #apiUrl;
  #envVar;

  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
    if (!options.prompt) throw new Error("AiPromptCheck requires options.prompt");

    this.#prompt = options.prompt;
    this.#model = options.model || "gpt-4o-mini";
    this.#apiUrl = options.apiUrl || "https://api.openai.com/v1/chat/completions";
    this.#envVar = options.envVar || "OPENAI_API_KEY";
  }

  get name() {
    return `AI Prompt (${this.#prompt.slice(0, 50)}${this.#prompt.length > 50 ? "…" : ""})`;
  }

  checkDeps() {
    const key = process.env[this.#envVar];
    if (!key) {
      console.log(`  ⚠ ${this.#envVar} not set — AI prompt check will be skipped`);
      return false;
    }
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

    const systemMessage =
      "You are a code review assistant integrated into a linter. " +
      "You will receive a file and an instruction describing what to check. " +
      "Respond with ONLY a JSON object (no markdown fences): " +
      '{ "pass": true/false, "reason": "short explanation" }';

    const userMessage =
      `File: ${relFile}\n` +
      `Instruction: ${this.#prompt}\n\n` +
      `--- file content ---\n${content}\n--- end of file ---`;

    let reply;
    try {
      reply = await this.#callApi(systemMessage, userMessage);
    } catch (err) {
      return { status: "error", output: `AI API error: ${err.message}` };
    }

    let verdict;
    try {
      verdict = JSON.parse(reply);
    } catch {
      return { status: "error", output: `AI returned invalid JSON: ${reply}` };
    }

    if (verdict.pass) {
      return { status: "pass" };
    }
    return { status: "fail", output: verdict.reason || "AI check failed (no reason provided)" };
  }

  async fix(file, _deps) {
    let content;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch (err) {
      return { status: "error", output: `cannot read file: ${err.message}` };
    }

    const relFile = path.relative(this.repoRoot, file);

    const systemMessage =
      "You are a code fixing assistant integrated into a linter. " +
      "You will receive a file and an instruction describing what to fix. " +
      "Respond with ONLY a JSON object (no markdown fences): " +
      '{ "changed": true/false, "content": "the full corrected file content", "reason": "short explanation" }. ' +
      "If no changes are needed set changed to false and omit content.";

    const userMessage =
      `File: ${relFile}\n` +
      `Instruction: ${this.#prompt}\n\n` +
      `--- file content ---\n${content}\n--- end of file ---`;

    let reply;
    try {
      reply = await this.#callApi(systemMessage, userMessage);
    } catch (err) {
      return { status: "error", output: `AI API error: ${err.message}` };
    }

    let result;
    try {
      result = JSON.parse(reply);
    } catch {
      return { status: "error", output: `AI returned invalid JSON: ${reply}` };
    }

    if (!result.changed) {
      return { status: "pass" };
    }

    try {
      await fs.writeFile(file, result.content, "utf-8");
    } catch (err) {
      return { status: "error", output: `cannot write file: ${err.message}` };
    }

    return { status: "fixed", output: result.reason || "AI applied fixes" };
  }

  async #callApi(systemMessage, userMessage) {
    const apiKey = process.env[this.#envVar];
    const response = await fetch(this.#apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.#model,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  static getHelp() {
    return {
      name: "AiPromptCheck",
      description:
        "Sends file content to an OpenAI-compatible AI with a user-defined prompt. " +
        "Lint asks the AI to evaluate pass/fail. Fix asks the AI to return corrected content.",
      options:
        "prompt — instruction for the AI (required); " +
        "model — AI model (default: gpt-4o-mini); " +
        "apiUrl — chat completions endpoint (default: OpenAI); " +
        "envVar — env var for API key (default: OPENAI_API_KEY)",
    };
  }
}
