import { createRequire as __createRequire } from "module";
import { fileURLToPath as __fileURLToPath } from "url";
import { dirname as __dirname_ } from "path";
const require = __createRequire(import.meta.url);

// linter.js
import fs12 from "fs";
import path9 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { spawnSync as spawnSync3 } from "child_process";

// node_modules/yocto-queue/index.js
var Node = class {
  value;
  next;
  constructor(value) {
    this.value = value;
  }
};
var Queue = class {
  #head;
  #tail;
  #size;
  constructor() {
    this.clear();
  }
  enqueue(value) {
    const node = new Node(value);
    if (this.#head) {
      this.#tail.next = node;
      this.#tail = node;
    } else {
      this.#head = node;
      this.#tail = node;
    }
    this.#size++;
  }
  dequeue() {
    const current = this.#head;
    if (!current) {
      return;
    }
    this.#head = this.#head.next;
    this.#size--;
    if (!this.#head) {
      this.#tail = void 0;
    }
    return current.value;
  }
  peek() {
    if (!this.#head) {
      return;
    }
    return this.#head.value;
  }
  clear() {
    this.#head = void 0;
    this.#tail = void 0;
    this.#size = 0;
  }
  get size() {
    return this.#size;
  }
  *[Symbol.iterator]() {
    let current = this.#head;
    while (current) {
      yield current.value;
      current = current.next;
    }
  }
  *drain() {
    while (this.#head) {
      yield this.dequeue();
    }
  }
};

// node_modules/p-limit/index.js
function pLimit(concurrency) {
  let rejectOnClear = false;
  if (typeof concurrency === "object") {
    ({ concurrency, rejectOnClear = false } = concurrency);
  }
  validateConcurrency(concurrency);
  if (typeof rejectOnClear !== "boolean") {
    throw new TypeError("Expected `rejectOnClear` to be a boolean");
  }
  const queue = new Queue();
  let activeCount = 0;
  const resumeNext = () => {
    if (activeCount < concurrency && queue.size > 0) {
      activeCount++;
      queue.dequeue().run();
    }
  };
  const next = () => {
    activeCount--;
    resumeNext();
  };
  const run = async (function_, resolve, arguments_) => {
    const result = (async () => function_(...arguments_))();
    resolve(result);
    try {
      await result;
    } catch {
    }
    next();
  };
  const enqueue = (function_, resolve, reject, arguments_) => {
    const queueItem = { reject };
    new Promise((internalResolve) => {
      queueItem.run = internalResolve;
      queue.enqueue(queueItem);
    }).then(run.bind(void 0, function_, resolve, arguments_));
    if (activeCount < concurrency) {
      resumeNext();
    }
  };
  const generator = (function_, ...arguments_) => new Promise((resolve, reject) => {
    enqueue(function_, resolve, reject, arguments_);
  });
  Object.defineProperties(generator, {
    activeCount: {
      get: () => activeCount
    },
    pendingCount: {
      get: () => queue.size
    },
    clearQueue: {
      value() {
        if (!rejectOnClear) {
          queue.clear();
          return;
        }
        const abortError = AbortSignal.abort().reason;
        while (queue.size > 0) {
          queue.dequeue().reject(abortError);
        }
      }
    },
    concurrency: {
      get: () => concurrency,
      set(newConcurrency) {
        validateConcurrency(newConcurrency);
        concurrency = newConcurrency;
        queueMicrotask(() => {
          while (activeCount < concurrency && queue.size > 0) {
            resumeNext();
          }
        });
      }
    },
    map: {
      async value(iterable, function_) {
        const promises = Array.from(iterable, (value, index) => this(function_, value, index));
        return Promise.all(promises);
      }
    }
  });
  return generator;
}
function validateConcurrency(concurrency) {
  if (!((Number.isInteger(concurrency) || concurrency === Number.POSITIVE_INFINITY) && concurrency > 0)) {
    throw new TypeError("Expected `concurrency` to be a number from 1 and up");
  }
}

// tool-resolve/clang-format.js
import fs2 from "fs";
import path2 from "path";
import os2 from "os";
import { spawnSync as spawnSync2 } from "child_process";

// tool-resolve/tool-utils.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec, spawnSync } from "child_process";
import os from "os";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var TOOLS_DIR = path.join(__dirname, "..", "tools");
var CACHE_PATH = path.join(TOOLS_DIR, "cache");
var EXTRACTED_PATH = path.join(TOOLS_DIR, "extracted");
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
function checkInPath(exeName) {
  const command = os.platform() === "win32" ? "where" : "which";
  try {
    const result = spawnSync(command, [exeName], { encoding: "utf8", stdio: "pipe" });
    if (result.error || result.status !== 0) {
      return null;
    }
    const foundPath = result.stdout.trim().split(os.EOL)[0];
    return foundPath || null;
  } catch {
    return null;
  }
}
function verifySha256(filePath, expectedSha256) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => {
      const actual = hash.digest("hex");
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
        reject(new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actual}`));
      } else {
        resolve();
      }
    });
  });
}
async function downloadFile(url, destPath, expectedSha256) {
  if (fs.existsSync(destPath)) {
    console.log(`Validating cached ${path.basename(destPath)}...`);
    try {
      await verifySha256(destPath, expectedSha256);
      return;
    } catch (err) {
      console.warn(`Cached file is corrupted: ${err.message}`);
      console.warn(`Deleting and re-downloading...`);
      fs.unlinkSync(destPath);
    }
  }
  console.log(`Downloading ${path.basename(destPath)} from ${url}...`);
  await new Promise((resolve, reject) => {
    exec(
      `curl -fSL --retry 3 --retry-delay 5 -o '${destPath}' '${url}'`,
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          try {
            fs.unlinkSync(destPath);
          } catch {
          }
          reject(new Error(`Download failed: ${error.message}
${stderr}`));
          return;
        }
        resolve();
      }
    );
  });
  try {
    await verifySha256(destPath, expectedSha256);
  } catch (err) {
    try {
      fs.unlinkSync(destPath);
    } catch {
    }
    throw err;
  }
}
function extractArchive(archivePath, destDir, members = []) {
  return new Promise((resolve, reject) => {
    const platform = os.platform();
    let command;
    if (platform === "win32") {
      command = `powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`;
    } else {
      ensureDirExists(destDir);
      const memberArgs = members.map((m) => `'${m}'`).join(" ");
      command = `tar -xf '${archivePath}' -C '${destDir}' ${memberArgs}`;
    }
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

// tool-resolve/clang-format.js
var VERSION = "21.1.8";
function checkVersion(exePath) {
  try {
    const child = spawnSync2(exePath, ["--version"], { encoding: "utf-8", stdio: "pipe" });
    if (child.error || child.status !== 0) return "unknown";
    const match = child.stdout.match(/\bclang-format\s+version\s+([0-9]+(?:\.[0-9]+)*)\b/i);
    return match ? match[1] : "unknown";
  } catch {
    return "unknown";
  }
}
async function getClangFormatPath({ shouldDownload, shouldSearchInPath }) {
  const exeName = os2.platform() === "win32" ? "clang-format.exe" : "clang-format";
  if (shouldSearchInPath) {
    const systemPath = checkInPath(exeName);
    if (systemPath) {
      const systemVersion = checkVersion(systemPath);
      const systemMajor = parseInt(systemVersion.split(".")[0], 10);
      const requiredMajor = parseInt(VERSION.split(".")[0], 10);
      if (systemMajor >= requiredMajor) {
        console.log(`Using ${systemPath} from system path (version ${systemVersion})`);
        return systemPath;
      }
      console.log(
        `System clang-format is version ${systemVersion}, need ${requiredMajor}+. Will download ${VERSION}.`
      );
    } else {
      console.log(`${exeName} not found in PATH`);
    }
  }
  if (!shouldDownload) {
    console.warn("clang-format not found and downloading is disabled");
    return void 0;
  }
  const platform = os2.platform();
  let url = "";
  let archiveName = "";
  let archiveSha256 = "";
  let archivePathToClangFormat = "";
  if (platform === "linux") {
    url = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${VERSION}/LLVM-${VERSION}-Linux-X64.tar.xz`;
    archiveName = `LLVM-${VERSION}-Linux-X64.tar.xz`;
    archiveSha256 = "b3b7f2801d15d50736acea3c73982994d025b01c2f035b91ae3b49d1b575732b";
    archivePathToClangFormat = `LLVM-${VERSION}-Linux-X64/bin/clang-format`;
  } else {
    console.warn(`Platform ${platform} not supported for clang-format download`);
    return void 0;
  }
  ensureDirExists(CACHE_PATH);
  ensureDirExists(EXTRACTED_PATH);
  const archivePath = path2.join(CACHE_PATH, archiveName);
  const extractDir = path2.join(EXTRACTED_PATH, `llvm-${VERSION}`);
  const expectedExe = path2.join(extractDir, archivePathToClangFormat);
  if (fs2.existsSync(expectedExe)) {
    console.log(`Using downloaded ${expectedExe}, version ${checkVersion(expectedExe)}`);
    return expectedExe;
  }
  await downloadFile(url, archivePath, archiveSha256);
  ensureDirExists(extractDir);
  console.log(`Extracting clang-format from ${archiveName} (single binary, not full LLVM)...`);
  await extractArchive(archivePath, extractDir, [archivePathToClangFormat]);
  if (fs2.existsSync(expectedExe)) {
    console.log(`Using downloaded ${expectedExe}, version ${checkVersion(expectedExe)}`);
    return expectedExe;
  }
  console.warn("Could not find clang-format binary after extraction");
  return void 0;
}

// tool-resolve/linelint.js
import fs3 from "fs";
import path3 from "path";
import os3 from "os";
var VERSION2 = "0.0.6";
async function getLinelintPath({ shouldDownload, shouldSearchInPath }) {
  const exeName = os3.platform() === "win32" ? "linelint.exe" : "linelint";
  if (shouldSearchInPath) {
    const systemPath = checkInPath(exeName);
    if (systemPath) {
      console.log(`Using ${systemPath} from system path instead of downloading`);
      return systemPath;
    }
    console.log(`${exeName} not found in PATH`);
  }
  if (!shouldDownload) {
    console.warn("linelint not found and downloading is disabled");
    return void 0;
  }
  const platform = os3.platform();
  let url = "";
  let exeSha256 = "";
  if (platform === "linux") {
    url = `https://github.com/fernandrone/linelint/releases/download/${VERSION2}/linelint-linux-amd64`;
    exeSha256 = "16b70fb7b471d6f95cbdc0b4e5dc2b0ac9e84ba9ecdc488f7bdf13df823aca4b";
  } else if (platform === "win32") {
    url = `https://github.com/fernandrone/linelint/releases/download/${VERSION2}/linelint-windows-amd64`;
    exeSha256 = "69793b89716c4a3ed02ff95d922ef95e0224bb987c938e2f8e85af1c79820bf3";
  } else if (platform === "darwin") {
    url = `https://github.com/fernandrone/linelint/releases/download/${VERSION2}/linelint-darwin-amd64`;
    exeSha256 = "2c6264704ea0479666ce2be7140e84c74f6fef8e7e9d9203db9d8bf8ca438e84";
  } else {
    console.warn(`Platform ${platform} not supported for linelint download`);
    return void 0;
  }
  ensureDirExists(CACHE_PATH);
  const destPath = path3.join(CACHE_PATH, exeName);
  if (fs3.existsSync(destPath)) {
    console.log(`Using cached ${destPath}`);
    return destPath;
  }
  console.log(`Downloading linelint v${VERSION2}...`);
  await downloadFile(url, destPath, exeSha256);
  if (platform !== "win32") {
    fs3.chmodSync(destPath, 493);
  }
  if (fs3.existsSync(destPath)) {
    console.log(`Using downloaded ${destPath}`);
    return destPath;
  }
  console.warn("Could not find linelint binary after download");
  return void 0;
}

// util.js
function ensureCleanExit(child) {
  if (child.error) {
    throw child.error;
  }
  if (child.signal) {
    throw new Error(`child terminated by signal: ${child.signal}`);
  }
  if (child.status !== 0) {
    throw new Error(`child exited with code ${child.status}`);
  }
  return child;
}

// checks/crlf-check.js
import fs5 from "fs/promises";

// checks/base-check.js
import path4 from "path";
import fs4 from "fs/promises";
var BaseCheck = class {
  #extensions;
  #excludePaths;
  #textOnly;
  constructor(repoRoot, options = {}) {
    this.repoRoot = repoRoot;
    this.#extensions = (options.extensions || []).map((e) => e.toLowerCase());
    this.#excludePaths = options.excludePaths || [];
    this.#textOnly = options.textOnly ?? false;
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
    for (const p of this.#excludePaths) {
      if (file.includes(p)) return false;
    }
    if (this.#extensions.length > 0) {
      const ext = path4.extname(file).toLowerCase();
      if (!this.#extensions.includes(ext)) return false;
    }
    if (this.#textOnly) {
      let fh;
      try {
        fh = await fs4.open(file, "r");
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
};

// checks/crlf-check.js
var CrlfCheck = class extends BaseCheck {
  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
  }
  get name() {
    return "CRLF";
  }
  async lint(file) {
    try {
      const content = await fs5.readFile(file);
      if (content.includes("\r\n")) {
        return { status: "fail", output: "contains CRLF line endings" };
      }
      return { status: "pass" };
    } catch (err) {
      return { status: "error", output: err.message };
    }
  }
  async fix(file) {
    try {
      const before = await fs5.readFile(file);
      if (before.includes("\r\n")) {
        const fixed = before.toString("utf-8").replace(/\r\n/g, "\n");
        await fs5.writeFile(file, Buffer.from(fixed, "utf-8"));
        return { status: "fixed" };
      }
      return { status: "pass" };
    } catch (err) {
      return { status: "error", output: err.message };
    }
  }
};

// checks/linelint-check.js
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs6 } from "fs";
var execFileAsync = promisify(execFile);
var LinelintCheck = class extends BaseCheck {
  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
  }
  get name() {
    return "Linelint";
  }
  checkDeps(deps) {
    return deps.linelintPath !== void 0;
  }
  async lint(file, deps) {
    try {
      await execFileAsync(deps.linelintPath, [file], { cwd: this.repoRoot });
      return { status: "pass" };
    } catch (err) {
      if (err.code === "ENOENT") {
        return { status: "error", output: err.message };
      }
      const out = (err.stderr || err.stdout || "").toString().trim();
      return { status: "fail", output: out || "linelint failed" };
    }
  }
  async fix(file, deps) {
    let before;
    try {
      before = await fs6.readFile(file);
    } catch (err) {
      return { status: "error", output: err.message };
    }
    try {
      await execFileAsync(deps.linelintPath, ["-a", file], { cwd: this.repoRoot });
    } catch (err) {
      if (err.code === "ENOENT") {
        return { status: "error", output: err.message };
      }
    }
    try {
      const after = await fs6.readFile(file);
      if (!before.equals(after)) {
        return { status: "fixed" };
      }
      return { status: "pass" };
    } catch (err) {
      return { status: "error", output: err.message };
    }
  }
};

// checks/clang-format-check.js
import { promises as fs7 } from "fs";
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
var execFileAsync2 = promisify2(execFile2);
var ClangFormatCheck = class extends BaseCheck {
  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
  }
  get name() {
    return "Clang Format";
  }
  checkDeps(deps) {
    return deps.clangFormatPath !== void 0;
  }
  async lint(file, deps) {
    try {
      await execFileAsync2(deps.clangFormatPath, ["--dry-run", "--Werror", file]);
      return { status: "pass" };
    } catch (err) {
      if (err.code === "ENOENT") {
        return { status: "error", output: err.message };
      }
      const output = (err.stderr || err.stdout || "").toString().trim();
      return { status: "fail", output };
    }
  }
  async fix(file, deps) {
    let before;
    try {
      before = await fs7.readFile(file);
    } catch (err) {
      return { status: "error", output: err.message };
    }
    try {
      await execFileAsync2(deps.clangFormatPath, ["-i", file]);
    } catch (err) {
      if (err.code === "ENOENT") {
        return { status: "error", output: err.message };
      }
      const output = (err.stderr || err.stdout || "").toString().trim();
      return { status: "error", output };
    }
    try {
      const after = await fs7.readFile(file);
      if (!before.equals(after)) {
        return { status: "fixed" };
      }
      return { status: "pass" };
    } catch (err) {
      return { status: "error", output: err.message };
    }
  }
};

// checks/paired-files-check.js
import { promises as fs8 } from "fs";
import path5 from "path";
var PairedFilesCheck = class extends BaseCheck {
  #absDirs;
  #exclude;
  constructor(repoRoot, options = {}) {
    super(repoRoot, options);
    const dirs = options.dirs || [];
    if (dirs.length !== 2) {
      throw new Error("PairedFilesCheck requires exactly 2 entries in options.dirs");
    }
    this.#absDirs = dirs.map((d) => ({
      abs: path5.resolve(repoRoot, d.path),
      ext: d.ext
    }));
    this.#exclude = new Set((options.exclude || []).map((f) => f.toLowerCase()));
  }
  get name() {
    return "Paired Files Check";
  }
  async appliesTo(file) {
    const basename = path5.basename(file).toLowerCase();
    if (this.#exclude.has(basename)) return false;
    return this.#absDirs.some((d) => file.startsWith(d.abs + path5.sep));
  }
  async lint(file) {
    const ext = path5.extname(file);
    const baseName = path5.basename(file, ext);
    const ownDir = this.#absDirs.find((d) => file.startsWith(d.abs + path5.sep));
    const pairDir = this.#absDirs.find((d) => d !== ownDir);
    let pairFiles;
    try {
      pairFiles = await fs8.readdir(pairDir.abs);
    } catch (err) {
      return { status: "error", output: `cannot read pair directory ${pairDir.abs}: ${err.message}` };
    }
    const expected = `${baseName}${pairDir.ext}`;
    const found = pairFiles.find(
      (c) => c.toLowerCase() === expected.toLowerCase()
    );
    if (!found) {
      return { status: "fail", output: `pair file not found (expected ${expected} in ${pairDir.abs})` };
    }
    return { status: "pass" };
  }
  async fix(file) {
    return this.lint(file);
  }
};

// file-sources/all-files-source.js
import fs9 from "fs";
import path6 from "path";
import simpleGit from "simple-git";

// file-sources/base-file-source.js
var BaseFileSource = class {
  constructor(repoRoot, options = {}) {
    this.repoRoot = repoRoot;
    this.options = options;
  }
  /**
   * @returns {string} Human-readable name of the source.
   */
  get name() {
    throw new Error("Not implemented: name");
  }
  /**
   * Resolve the list of absolute file paths to process.
   * @param {object} context - { args: string[] } CLI args for parametric sources.
   * @returns {Promise<string[]>} Absolute paths.
   */
  async resolve(context) {
    throw new Error("Not implemented: resolve");
  }
};

// file-sources/all-files-source.js
var AllFilesSource = class extends BaseFileSource {
  get name() {
    return "All tracked files";
  }
  async resolve() {
    const git = simpleGit(this.repoRoot);
    const output = await git.raw(["ls-files"]);
    return output.split("\n").filter((f) => f.trim() !== "").map((f) => path6.resolve(this.repoRoot, f)).filter((f) => fs9.existsSync(f));
  }
};

// file-sources/staged-files-source.js
import fs10 from "fs";
import path7 from "path";
import simpleGit2 from "simple-git";
var StagedFilesSource = class extends BaseFileSource {
  get name() {
    return "Staged files";
  }
  async resolve() {
    const git = simpleGit2(this.repoRoot);
    const output = await git.diff(["--name-only", "--cached"]);
    return output.split("\n").filter((f) => f.trim() !== "").map((f) => path7.resolve(this.repoRoot, f)).filter((f) => fs10.existsSync(f));
  }
};

// file-sources/diff-base-source.js
import fs11 from "fs";
import path8 from "path";
import simpleGit3 from "simple-git";
var DiffBaseSource = class extends BaseFileSource {
  get name() {
    return "Diff vs base";
  }
  async resolve() {
    const baseRef = this.#detectBaseRef();
    console.log(`DiffBaseSource: diffing against ${baseRef}`);
    const git = simpleGit3(this.repoRoot);
    const output = await git.diff(["--name-only", "--diff-filter=ACMR", baseRef]);
    return output.split("\n").filter((f) => f.trim() !== "").map((f) => path8.resolve(this.repoRoot, f)).filter((f) => fs11.existsSync(f));
  }
  #detectBaseRef() {
    if (this.options.baseRef) {
      console.log(`DiffBaseSource: using options.baseRef = "${this.options.baseRef}"`);
      return this.options.baseRef;
    }
    const ghBaseRef = process.env.GITHUB_BASE_REF;
    if (ghBaseRef) {
      console.log(`DiffBaseSource: using GITHUB_BASE_REF = "${ghBaseRef}" \u2192 origin/${ghBaseRef}`);
      return `origin/${ghBaseRef}`;
    }
    if (process.env.GITHUB_EVENT_NAME === "push") {
      const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || "main";
      console.log(`DiffBaseSource: GITHUB_EVENT_NAME = "push", using default branch "${defaultBranch}" \u2192 origin/${defaultBranch}`);
      return `origin/${defaultBranch}`;
    }
    throw new Error(
      "DiffBaseSource: cannot determine base ref. Set options.baseRef in config, or run in GitHub Actions (GITHUB_BASE_REF / GITHUB_EVENT_NAME)."
    );
  }
};

// registry.js
var builtinRegistry = {
  // checks
  CrlfCheck,
  LinelintCheck,
  ClangFormatCheck,
  PairedFilesCheck,
  // file sources
  AllFilesSource,
  StagedFilesSource,
  DiffBaseSource
};

// linter.js
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path9.dirname(__filename2);
var getRepoRoot = () => {
  const result = spawnSync3("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8"
  });
  if (result.error || result.status !== 0) {
    console.warn("Warning: not a git repository, using cwd as repo root");
    return process.cwd();
  }
  return result.stdout.trim();
};
var REPO_ROOT = getRepoRoot();
var resolveClass = async (entry) => {
  const exportName = entry.export;
  if (entry.module) {
    const mod = await import(entry.module);
    const Cls2 = mod[exportName];
    if (!Cls2) {
      throw new Error(`Export "${exportName}" not found in "${entry.module}"`);
    }
    return Cls2;
  }
  const Cls = builtinRegistry[exportName];
  if (!Cls) {
    throw new Error(
      `Export "${exportName}" not found in built-in registry. Available: ${Object.keys(builtinRegistry).join(", ")}. For custom checks, specify "module" in config.`
    );
  }
  return Cls;
};
var loadConfig = async (mode) => {
  const configPath = path9.join(REPO_ROOT, "linter-config.json");
  const config = JSON.parse(fs12.readFileSync(configPath, "utf-8"));
  const modeConfig = config.modes[mode];
  if (!modeConfig) {
    throw new Error(`Unknown mode "${mode}". Available: ${Object.keys(config.modes).join(", ")}`);
  }
  const srcEntry = modeConfig.fileSource;
  const SrcClass = await resolveClass(srcEntry);
  const fileSource = new SrcClass(REPO_ROOT, srcEntry.options || {});
  const checks = [];
  for (const entry of config.checks) {
    if (!entry.modes.includes(mode)) {
      console.log(`Skipping check "${entry.name}": not enabled for mode "${mode}"`);
      continue;
    }
    const CheckClass = await resolveClass(entry);
    checks.push(new CheckClass(REPO_ROOT, entry.options || {}));
  }
  return { fileSource, checks };
};
var relPath = (file) => {
  if (file.startsWith(REPO_ROOT + path9.sep)) {
    return file.slice(REPO_ROOT.length + 1);
  }
  return file;
};
var formatFileResults = (results, file) => {
  const rel = relPath(file);
  const lines = [];
  let isFail = false;
  const stats = { pass: 0, fixed: 0, fail: 0, error: 0 };
  const passed = [];
  const fixed = [];
  const bad = [];
  for (const { res, checkName } of results) {
    switch (res.status) {
      case "pass":
        passed.push(checkName);
        stats.pass++;
        break;
      case "fixed":
        fixed.push(checkName);
        stats.fixed++;
        break;
      case "fail":
        bad.push({ res, checkName });
        stats.fail++;
        break;
      case "error":
      default:
        bad.push({ res, checkName });
        stats.error++;
        break;
    }
  }
  if (bad.length === 0) {
    if (fixed.length === 0) {
      lines.push(`[PASS] ${rel} [${passed.join(", ")}]`);
    } else if (passed.length === 0) {
      lines.push(`[FIXED] ${rel} [${fixed.join(", ")}]`);
    } else {
      const parts = [];
      if (passed.length) parts.push(`passed: ${passed.join(", ")}`);
      if (fixed.length) parts.push(`fixed: ${fixed.join(", ")}`);
      lines.push(`[OK] ${rel} [${parts.join(" | ")}]`);
    }
  } else {
    isFail = true;
    for (const name of passed) {
      lines.push(`[PASS] ${rel} [${name}]`);
    }
    for (const name of fixed) {
      lines.push(`[FIXED] ${rel} [${name}]`);
    }
    for (const { res, checkName } of bad) {
      const status = res.status === "fail" ? "FAIL" : res.status === "error" ? "ERROR" : "UNKNOWN";
      lines.push(`[${status}] ${rel} [${checkName}]`);
      if (res.output) lines.push(`  ${res.output}`);
    }
  }
  return { lines, isFail, stats };
};
var runChecks = async (files, checks, { lintOnly = false, verbose = false, clangFormatPath, linelintPath }) => {
  const deps = { clangFormatPath, linelintPath };
  const fileToChecks = /* @__PURE__ */ new Map();
  let totalChecks = 0;
  for (const check of checks) {
    if (!check.checkDeps(deps)) {
      console.warn(`Skipped ${check.name}: failed deps check`);
      continue;
    }
    for (const file of files) {
      if (await check.appliesTo(file)) {
        if (!fileToChecks.has(file)) {
          fileToChecks.set(file, []);
        }
        fileToChecks.get(file).push(check);
        totalChecks++;
      }
    }
  }
  const groupedWork = Array.from(fileToChecks.entries()).map(([file, fileChecks]) => ({ file, checks: fileChecks }));
  if (groupedWork.length === 0) {
    console.log("No matching files found for checks.");
    return;
  }
  console.log(`${lintOnly ? "Linting" : "Fixing"} ${totalChecks} check(s) across ${groupedWork.length} file(s)...`);
  let fail = false;
  const counters = { pass: 0, fixed: 0, fail: 0, error: 0 };
  if (lintOnly) {
    const limit = pLimit(10);
    await Promise.all(
      groupedWork.map(
        ({ file, checks: checks2 }) => limit(async () => {
          const results = await Promise.all(
            checks2.map(async (check) => {
              try {
                const res = await check.lint(file, deps);
                return { res, checkName: check.name };
              } catch (err) {
                return { res: { status: "error", output: err.message }, checkName: check.name };
              }
            })
          );
          const { lines, isFail, stats } = formatFileResults(results, file);
          counters.pass += stats.pass;
          counters.fixed += stats.fixed;
          counters.fail += stats.fail;
          counters.error += stats.error;
          if (lines.length > 0) {
            if (isFail) {
              console.error(lines.join("\n"));
            } else if (verbose) {
              console.log(lines.join("\n"));
            }
          }
          if (isFail) fail = true;
        })
      )
    );
  } else {
    for (const { file, checks: checks2 } of groupedWork) {
      const fileResults = [];
      for (const check of checks2) {
        try {
          const res = await check.fix(file, deps);
          fileResults.push({ res, checkName: check.name });
        } catch (err) {
          fileResults.push({ res: { status: "error", output: err.message }, checkName: check.name });
        }
      }
      const { lines, isFail, stats } = formatFileResults(fileResults, file);
      counters.pass += stats.pass;
      counters.fixed += stats.fixed;
      counters.fail += stats.fail;
      counters.error += stats.error;
      if (lines.length > 0) {
        if (isFail) {
          console.error(lines.join("\n"));
        } else if (verbose) {
          console.log(lines.join("\n"));
        }
      }
      if (isFail) fail = true;
    }
  }
  const parts = [`${totalChecks} check(s)`];
  if (counters.pass > 0) parts.push(`${counters.pass} passed`);
  if (counters.fixed > 0) parts.push(`${counters.fixed} fixed`);
  if (counters.fail > 0) parts.push(`${counters.fail} failed`);
  if (counters.error > 0) parts.push(`${counters.error} errored`);
  console.log(`Summary: ${parts.join(", ")}`);
  if (fail) {
    process.exit(1);
  }
  console.log(`${lintOnly ? "Linting" : "Fixing"} completed.`);
};
(async () => {
  const args = process.argv.slice(2);
  const shouldLint = args.includes("--lint");
  const shouldFix = args.includes("--fix");
  const shouldAdd = args.includes("--add");
  const verbose = args.includes("--verbose");
  const shouldDownload = !args.includes("--no-download");
  const shouldSearchInPath = !args.includes("--no-path");
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex !== -1 && args[modeIndex + 1] ? args[modeIndex + 1] : "manual";
  if (!shouldLint && !shouldFix) {
    console.error("Either --lint or --fix must be specified");
    process.exit(1);
  }
  if (!shouldFix && shouldAdd) {
    console.error("--add makes no sense without --fix");
    process.exit(1);
  }
  try {
    const { fileSource, checks } = await loadConfig(mode);
    if (checks.length === 0) {
      console.log(`No checks enabled for mode "${mode}".`);
      process.exit(0);
    }
    console.log(`Mode: ${mode} | Source: ${fileSource.name} | Checks: ${checks.map((c) => c.name).join(", ")}`);
    const clangFormatPath = await getClangFormatPath({
      shouldDownload,
      shouldSearchInPath
    });
    const linelintPath = await getLinelintPath({
      shouldDownload,
      shouldSearchInPath
    });
    const files = await fileSource.resolve();
    console.log(`${fileSource.name}: ${files.length} file(s)`);
    const startTime = Date.now();
    await runChecks(files, checks, { lintOnly: shouldLint, verbose, clangFormatPath, linelintPath });
    const elapsedMs = Date.now() - startTime;
    const minutes = Math.floor(elapsedMs / 6e4);
    const seconds = (elapsedMs % 6e4 / 1e3).toFixed(2);
    const timeStr = minutes > 0 ? `${minutes} minutes, ${seconds} seconds` : `${seconds} seconds`;
    console.log(`Completed in ${timeStr}`);
    if (files.length === 0) {
      console.log("No files were processed.");
      process.exit(0);
    }
    if (!shouldFix) {
      process.exit(0);
    }
    if (shouldAdd) {
      files.forEach(
        (file) => ensureCleanExit(spawnSync3("git", ["add", file], { stdio: "inherit" }))
      );
    } else {
      console.log(
        "Files were not staged (use --add to stage automatically)."
      );
    }
  } catch (err) {
    console.error("Error during processing:", err.message);
    process.exit(1);
  }
})();
