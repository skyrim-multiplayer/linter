import express from "express";
import { randomUUID } from "crypto";
import os from "os";
import { ClaudeProvider } from "./ai-providers/claude.js";
import { GeminiProvider } from "./ai-providers/gemini.js";
import { EchoProvider } from "./ai-providers/echo.js";

const AI_PROVIDERS = {
  claude: ClaudeProvider,
  gemini: GeminiProvider,
  echo: EchoProvider,
};

/**
 * Create and return an Express app implementing the agent-check.js task API:
 *   POST /tasks  — submit a task, returns { taskId, status: "pending" }
 *   GET  /tasks/:taskId — poll task status, returns { status, progress?, result?, error? }
 *
 * @param {{ apiKey: string, provider?: string }} options
 */
export function createAgentServer({ apiKey, provider = "claude", model = null }) {
  const ProviderClass = AI_PROVIDERS[provider.toLowerCase()];
  if (!ProviderClass) {
    throw new Error(`Unknown provider "${provider}". Available: ${Object.keys(AI_PROVIDERS).join(", ")}`);
  }
  const aiProvider = provider.toLowerCase() === "gemini"
    ? new ProviderClass(model)
    : new ProviderClass();

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // In-memory task store: taskId → { status, progress?, result?, error? }
  const tasks = new Map();

  const authenticate = (req, res, next) => {
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token || token !== apiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };

  // POST /tasks
  app.post("/tasks", authenticate, (req, res) => {
    const { prompt, mode, primaryFile, files } = req.body ?? {};
    if (!prompt || !mode || !primaryFile || !files) {
      return res.status(400).json({ error: "Missing required fields: prompt, mode, primaryFile, files" });
    }
    if (mode !== "lint" && mode !== "fix") {
      return res.status(400).json({ error: `Invalid mode "${mode}". Expected "lint" or "fix"` });
    }

    const taskId = randomUUID();
    const task = { id: taskId, status: "pending", progress: undefined, result: undefined, error: undefined };
    tasks.set(taskId, task);

    // Fire-and-forget — agent-check polls for completion
    processTask(task, { prompt, mode, primaryFile, files }, aiProvider).catch(() => {});

    res.status(201).json({ taskId, status: "pending" });
  });

  // GET /tasks/:taskId
  app.get("/tasks/:taskId", authenticate, (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    const out = { status: task.status };
    if (task.progress !== undefined) out.progress = task.progress;
    if (task.result !== undefined) out.result = task.result;
    if (task.error !== undefined) out.error = task.error;
    res.json(out);
  });

  return app;
}

/**
 * Process a task: build a prompt from the payload, call the AI provider,
 * parse the JSON result, and update the task record.
 *
 * Expected AI responses:
 *   lint: { "pass": bool, "reason": "..." }
 *   fix:  { "pass": bool, "reason": "...", "files": { "<relPath>": "<content>" } }
 */
async function processTask(task, { prompt, mode, primaryFile, files }, aiProvider) {
  task.status = "running";
  task.progress = "Calling AI provider…";

  try {
    const fileContext = Object.entries(files)
      .map(([relPath, content]) => `### ${relPath}\n\`\`\`\n${content}\n\`\`\``)
      .join("\n\n");

    let fullPrompt;

    if (mode === "lint") {
      fullPrompt =
        `You are a code review assistant integrated into a linter.\n` +
        `Primary file: ${primaryFile}\n` +
        `Instruction: ${prompt}\n\n` +
        `${fileContext}\n\n` +
        `Respond with ONLY a JSON object (no markdown fences): ` +
        `{ "pass": true/false, "reason": "short explanation" }`;
    } else {
      fullPrompt =
        `You are a code fixing assistant integrated into a linter.\n` +
        `Primary file: ${primaryFile}\n` +
        `Instruction: ${prompt}\n\n` +
        `${fileContext}\n\n` +
        `Respond with ONLY a JSON object (no markdown fences): ` +
        `{ "pass": true/false, "reason": "short explanation", "files": { "<relPath>": "<full new file content>" } }. ` +
        `If no fix is needed, set pass to true and omit files. ` +
        `If a fix is applied, set pass to false and include only the changed files in "files".`;
    }

    const reply = await aiProvider.call(fullPrompt, { cwd: os.tmpdir() });

    let result;
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
    } catch {
      task.status = "failed";
      task.error = `AI returned invalid JSON: ${reply.slice(0, 300)}`;
      return;
    }

    task.status = "completed";
    task.progress = undefined;
    task.result = result;
  } catch (err) {
    task.status = "failed";
    task.progress = undefined;
    task.error = err.message;
  }
}
