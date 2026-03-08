/**
 * Registry of built-in checks and file sources.
 *
 * After esbuild bundles the linter, dynamic `import(path)` won't work
 * for built-in modules. Instead, linter-config.json references built-ins
 * by their export name (e.g. "CrlfCheck") and we resolve them here.
 *
 * Custom / user-provided checks can still use "module" + "export" in config.
 */

// --- checks ---
import { CrlfCheck } from "./checks/crlf-check.js";
import { LinelintCheck } from "./checks/linelint-check.js";
import { ClangFormatCheck } from "./checks/clang-format-check.js";
import { PairedFilesCheck } from "./checks/paired-files-check.js";
import { CodegenCheck } from "./checks/codegen-check.js";
import { AiPromptCheck } from "./checks/ai-prompt-check.js";
import { RegexCheck } from "./checks/regex-check.js";

// --- file sources ---
import { AllFilesSource } from "./file-sources/all-files-source.js";
import { StagedFilesSource } from "./file-sources/staged-files-source.js";
import { DiffBaseSource } from "./file-sources/diff-base-source.js";

import { BaseCheck } from "./checks/base-check.js";
import { BaseFileSource } from "./file-sources/base-file-source.js";

export const builtinChecks = {
  CrlfCheck,
  LinelintCheck,
  ClangFormatCheck,
  PairedFilesCheck,
  CodegenCheck,
  AiPromptCheck,
  RegexCheck,
};

export const builtinFileSources = {
  AllFilesSource,
  StagedFilesSource,
  DiffBaseSource,
};

export const builtinRegistry = {
  ...builtinChecks,
  ...builtinFileSources,
};

export { BaseCheck, BaseFileSource };
