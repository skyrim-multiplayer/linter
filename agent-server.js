import http from "http";
import crypto from "crypto";
import { ClaudeProvider } from "./ai-providers/claude.js";
import { GeminiProvider } from "./ai-providers/gemini.js";

const AI_PROVIDERS = {
  claude: ClaudeProvider,
  gemini: GeminiProvider,
};

/**
 * Start the agent server that implements the async task API
 * expected by AgentCheck.
 *
 * Protocol:
 *   POST /tasks          — create a new task
 *   GET  /tasks/{taskId} — poll task status
 *
 * @param {{ port?: number, apiKey?: string, aiProvider?: string, repoRoot?: string }} options
 * @returns {Promise<http.Server>}
 */
export async function startAgentServer(options = {}) {
  const port = options.port || 3000;
  const apiKey = options.apiKey || null;
  const providerName = (options.aiProvider || "claude").toLowerCase();
  const repoRoot = options.repoRoot || process.cwd();

  const ProviderClass = AI_PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new Error(`Unknown aiProvider "${providerName}". Available: ${Object.keys(AI_PROVIDERS).join(", ")}`);
  }
  const provider = new ProviderClass();

  /** @type {Map<string, { status: string, result?: object, error?: string }>} */
  const tasks = new Map();

  /**
   * Process a task asynchronously using the AI provider.
   */
  function processTask(taskId, payload) {
    const { prompt, mode, primaryFile, files } = payload;

    // Build context from files map
    let context = "";
    if (files && typeof files === "object") {
      for (const [filePath, content] of Object.entries(files)) {
        context += `--- ${filePath} ---\n${content}\n\n`;
      }
    }

    let aiPrompt;
    if (mode === "lint") {
      aiPrompt =
        `You are a code review assistant.\n` +
        `Primary file: ${primaryFile}\n` +
        `Instruction: ${prompt}\n\n` +
        `${context}\n` +
        `Respond with ONLY a JSON object (no markdown fences):\n` +
        `{ "pass": true/false, "reason": "short explanation" }`;
    } else {
      // fix mode
      aiPrompt =
        `You are a code fixing assistant.\n` +
        `Primary file: ${primaryFile}\n` +
        `Instruction: ${prompt}\n\n` +
        `${context}\n` +
        `Evaluate the file and fix it if needed.\n` +
        `Respond with ONLY a JSON object (no markdown fences):\n` +
        `If the file is fine: { "pass": true, "reason": "short explanation" }\n` +
        `If fixes are needed: { "pass": false, "reason": "what was wrong", "files": { "relative/path": "full new content", ... } }\n` +
        `Only include files that actually changed.`;
    }

    tasks.get(taskId).status = "running";

    provider.call(aiPrompt, { cwd: repoRoot }).then(
      (reply) => {
        let parsed;
        try {
          const jsonMatch = reply.match(/\{[\s\S]*\}/);
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
        } catch {
          tasks.set(taskId, { status: "failed", error: `AI returned invalid JSON: ${reply.slice(0, 500)}` });
          return;
        }
        tasks.set(taskId, { status: "completed", result: parsed });
      },
      (err) => {
        tasks.set(taskId, { status: "failed", error: err.message });
      },
    );
  }

  /**
   * Read the full request body (with a size limit).
   * @returns {Promise<string>}
   */
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const MAX_BODY = 10 * 1024 * 1024; // 10 MB
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  function sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    });
    res.end(data);
  }

  function checkAuth(req, res) {
    if (!apiKey) return true;
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== apiKey) {
      sendJson(res, 401, { error: "Unauthorized" });
      return false;
    }
    return true;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname.replace(/\/+$/, "");

      // POST /tasks
      if (req.method === "POST" && pathname === "/tasks") {
        if (!checkAuth(req, res)) return;

        let payload;
        try {
          const body = await readBody(req);
          payload = JSON.parse(body);
        } catch (err) {
          sendJson(res, 400, { error: `Invalid JSON: ${err.message}` });
          return;
        }

        if (!payload.prompt || !payload.primaryFile) {
          sendJson(res, 400, { error: "Missing required fields: prompt, primaryFile" });
          return;
        }

        const taskId = crypto.randomUUID();
        tasks.set(taskId, { status: "pending" });
        sendJson(res, 201, { taskId, status: "pending" });

        // Start processing asynchronously
        processTask(taskId, payload);
        return;
      }

      // GET /tasks/{taskId}
      const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/);
      if (req.method === "GET" && taskMatch) {
        if (!checkAuth(req, res)) return;

        const taskId = decodeURIComponent(taskMatch[1]);
        const task = tasks.get(taskId);
        if (!task) {
          sendJson(res, 404, { error: "Task not found" });
          return;
        }

        sendJson(res, 200, { taskId, ...task });

        // Clean up completed/failed tasks after they're polled
        if (task.status === "completed" || task.status === "failed") {
          tasks.delete(taskId);
        }
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: "Internal server error" });
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => {
      console.log(`Agent server listening on http://localhost:${port}`);
      console.log(`AI provider: ${provider.name}`);
      if (apiKey) {
        console.log(`API key: configured`);
      } else {
        console.log(`API key: none (open access)`);
      }
      resolve(server);
    });
  });
}
