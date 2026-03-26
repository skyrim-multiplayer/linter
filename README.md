# linter

A configurable, single-file linter runner with built-in checks for clang-format, CRLF line endings, linelint, and paired-file validation. Designed to run as a git pre-commit hook or in CI.

## Installation

The bundled linter is a single ESM file (`dist/linter.mjs`) with no runtime dependencies beyond Node.js 18+.

### Via yarn (global)

Install from the repo at a specific commit:

```sh
yarn global add "https://github.com/skyrim-multiplayer/linter#main"
```

This makes `skymp-linter` available on your PATH:

```sh
skymp-linter --lint --mode ci
skymp-linter --install-hook
```

### Via curl (single-file)

Download and install as a git pre-commit hook in one go:

```sh
curl -fsSL https://raw.githubusercontent.com/skyrim-multiplayer/linter/main/dist/linter.mjs -o .git/hooks/linter.mjs && node .git/hooks/linter.mjs --install-hook
```

This downloads `linter.mjs` into `.git/hooks/` and creates a `pre-commit` hook next to it. If a pre-commit hook already exists, it is backed up to `pre-commit.bak`.

## Quick Start

```sh
# Generate a minimal linter-config.json
skymp-linter --init

# Scaffold a custom check
skymp-linter --create-check ./checks/my-check.js

# Lint / fix
skymp-linter --lint
skymp-linter --fix --add
```

## Usage

Run `skymp-linter --help` for the full list of commands, options, built-in checks, and file sources.

## License

See [LICENSE](LICENSE).
