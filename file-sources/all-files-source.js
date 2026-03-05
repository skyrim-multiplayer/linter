import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { BaseFileSource } from "./base-file-source.js";

/**
 * Returns all tracked files in the repo.
 * Typical use: manual full-repo check.
 */
export class AllFilesSource extends BaseFileSource {
  get name() {
    return "All tracked files";
  }

  async resolve() {
    const git = simpleGit(this.repoRoot);
    const output = await git.raw(["ls-files"]);
    const files = output
      .split("\n")
      .filter((f) => f.trim() !== "")
      .map((f) => path.resolve(this.repoRoot, f));

    const existing = await Promise.all(
      files.map(async (filePath) => {
        try {
          await fs.promises.access(filePath, fs.constants.F_OK);
          return filePath;
        } catch {
          return null;
        }
      }),
    );

    return existing.filter((filePath) => filePath !== null);
  }
}
