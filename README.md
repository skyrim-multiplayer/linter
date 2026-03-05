# linter

A configurable, single-file linter runner with built-in checks for clang-format, CRLF line endings, linelint, and paired-file validation. Designed to run as a git pre-commit hook or in CI.

## Installation

The bundled linter is a single ESM file (`dist/linter.mjs`) with no runtime dependencies beyond Node.js 18+.

Download and install as a git pre-commit hook in one go:

```sh
curl -fsSL https://raw.githubusercontent.com/skyrim-multiplayer/linter/main/dist/linter.mjs -o .git/hooks/linter.mjs && node .git/hooks/linter.mjs --install-hook
```

This downloads `linter.mjs` into `.git/hooks/` and creates a `pre-commit` hook next to it. If a pre-commit hook already exists, it is backed up to `pre-commit.bak`.

## Configuration

Create a `linter-config.json` in the root of your repository:

```jsonc
{
  // Optional: directory for downloaded tool binaries (default: <repoRoot>/tools)
  "toolsDir": "tools",

  "modes": {
    "manual": {
      "fileSource": { "export": "AllFilesSource" }
    },
    "hook": {
      "fileSource": { "export": "StagedFilesSource" }
    },
    "ci": {
      "fileSource": { "export": "DiffBaseSource", "options": {} }
    }
  },

  "checks": [
    {
      "name": "crlf",
      "export": "CrlfCheck",
      "modes": ["manual", "hook", "ci"],
      "options": { "extensions": [".cpp", ".h", ".js", ".ts", ".json"] }
    },
    {
      "name": "clang-format",
      "export": "ClangFormatCheck",
      "modes": ["manual", "hook", "ci"],
      "options": { "extensions": [".cpp", ".h"] }
    },
    {
      "name": "linelint",
      "export": "LinelintCheck",
      "modes": ["manual", "hook", "ci"],
      "options": {}
    },
    {
      "name": "paired-files",
      "export": "PairedFilesCheck",
      "modes": ["manual", "ci"],
      "options": {
        "dirs": [
          { "path": "src", "ext": ".cpp" },
          { "path": "include", "ext": ".h" }
        ]
      }
    }
  ]
}
```

## Usage

```sh
# Lint (read-only, exits 1 on failure)
node .git/hooks/linter.mjs --lint

# Fix files in-place
node .git/hooks/linter.mjs --fix

# Fix and stage changed files automatically
node .git/hooks/linter.mjs --fix --add

# Use a specific mode (default: manual)
node .git/hooks/linter.mjs --lint --mode ci

# Show passing checks too
node .git/hooks/linter.mjs --lint --verbose

# Install as git pre-commit hook
node .git/hooks/linter.mjs --install-hook
```

### CLI flags

| Flag | Description |
|---|---|
| `--lint` | Run checks in read-only mode. Exit 1 on any failure. |
| `--fix` | Run checks in fix mode — modify files in-place. |
| `--add` | Stage fixed files with `git add` (requires `--fix`). |
| `--verbose` | Print `[PASS]` lines (hidden by default). |
| `--mode <name>` | Execution mode from config (default: `manual`). |
| `--install-hook` | Install as a git pre-commit hook and exit. |
| `--no-download` | Do not download tools (clang-format, linelint) if missing. |
| `--no-path` | Do not search for tools in `PATH`. |

### Modes and file sources

| File source | Typical mode | Description |
|---|---|---|
| `AllFilesSource` | `manual` | All git-tracked files. |
| `StagedFilesSource` | `hook` | Files staged via `git add`. |
| `DiffBaseSource` | `ci` | Files changed relative to a base branch. Auto-detects `GITHUB_BASE_REF` in GitHub Actions. |

### Built-in checks

| Check | Description |
|---|---|
| `CrlfCheck` | Detects/fixes CRLF (`\r\n`) line endings. |
| `ClangFormatCheck` | Runs `clang-format` (auto-downloaded if needed). |
| `LinelintCheck` | Runs `linelint` (auto-downloaded if needed). |
| `PairedFilesCheck` | Ensures matching files exist across two directories (lint-only, no auto-fix). |

### Custom checks

You can provide your own check by extending `BaseCheck` and referencing it with `"module"` in config:

```json
{
  "name": "my-check",
  "export": "MyCheck",
  "module": "./my-check.js",
  "modes": ["manual"],
  "options": {}
}
```

## License

See [LICENSE](LICENSE).
