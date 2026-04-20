/**
 * Represents a single unit of work for a check.
 *
 * By default the unit is a file, but subclasses can represent
 * virtual sub-units: a JSON array element, a binary record, etc.
 *
 * --- WHY Entry EXISTS (not just string paths) ---
 *
 * An Expander answers "how many times to run a check on this file".
 * An Entry answers "what exactly to pass to each run".
 *
 * For regular files both are trivial — one file, one path, same string.
 * The problem appears with virtual content:
 *
 *   // JsonArrayExpander needs to return something per element.
 *   // A plain string cannot serve two incompatible roles at once:
 *   //   1. id for display:  "data.json[3]"         ← not a real path
 *   //   2. path for lint:   "/repo/data.json"       ← real file on disk
 *
 * Without Entry you would need magic strings ("path::subkey"), parallel
 * arrays, or ad-hoc parsing scattered across the codebase.
 *
 * Entry separates these concerns cleanly:
 *
 *   entry.id         → "data.json[3]"    shown to the user in output/reports
 *   entry.path       → "/repo/data.json" passed to check.lint() / check.fix()
 *   entry.sourceFile → "/repo/data.json" added to git staging after a fix
 *   entry.metadata   → { index: 3 }      extra context for entry-aware checks
 *
 * For a plain FileEntry all four collapse to the same absolute path, so
 * existing checks that do fs.readFile(file) require zero changes.
 *
 * --- SUMMARY ---
 *
 *   Expander  — factory:  file path  →  Entry[]
 *   Entry     — value:    carries id, path, sourceFile and metadata together
 */
export class BaseEntry {
  /**
   * Unique identifier for this entry, used in output and reports.
   * For file entries this is the absolute path; for sub-entries it may
   * include a suffix (e.g. "/repo/data.json[3]").
   * @returns {string}
   */
  get id() {
    throw new Error("Not implemented: id");
  }

  /**
   * Absolute path that is passed to check.lint() / check.fix().
   * Returns null for purely virtual entries that have no direct FS path.
   * @returns {string | null}
   */
  get path() {
    return null;
  }

  /**
   * Absolute path of the real file on disk.
   * Used by the runner when adding files to git staging after a fix.
   * Defaults to path.
   * @returns {string | null}
   */
  get sourceFile() {
    return this.path;
  }

  /**
   * Arbitrary metadata — index, offset, key, etc.
   * Subclasses can populate this for checks that are entry-aware.
   * @returns {object}
   */
  get metadata() {
    return {};
  }
}
