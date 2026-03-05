import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec, spawnSync } from "child_process";
import os from "os";

/**
 * Compute cache/extracted paths from a configurable tools directory.
 * @param {string} toolsDir  Absolute path to the tools directory.
 * @returns {{ cachePath: string, extractedPath: string }}
 */
export function getToolPaths(toolsDir) {
  return {
    cachePath: path.join(toolsDir, "cache"),
    extractedPath: path.join(toolsDir, "extracted"),
  };
}

export function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function checkInPath(exeName) {
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

/**
 * Compute SHA256 of a file and compare to expected hash.
 * @returns {Promise<void>} Resolves on match, rejects on mismatch.
 */
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

/**
 * Download a file using curl (handles redirects, large files reliably).
 * Validates SHA256 after download. Deletes corrupted cached files automatically.
 */
export async function downloadFile(url, destPath, expectedSha256) {
  if (fs.existsSync(destPath)) {
    console.log(`Validating cached ${path.basename(destPath)}...`);
    try {
      await verifySha256(destPath, expectedSha256);
      return; // cache valid
    } catch (err) {
      console.warn(`Cached file is corrupted: ${err.message}`);
      console.warn(`Deleting and re-downloading...`);
      fs.unlinkSync(destPath);
    }
  }

  console.log(`Downloading ${path.basename(destPath)} from ${url}...`);

  await new Promise((resolve, reject) => {
    exec(
      `curl -fSL --retry 3 --retry-delay 5 -o "${destPath}" "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          // Clean up partial download
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error(`Download failed: ${error.message}\n${stderr}`));
          return;
        }
        resolve();
      }
    );
  });

  // Verify the downloaded file
  try {
    await verifySha256(destPath, expectedSha256);
  } catch (err) {
    try { fs.unlinkSync(destPath); } catch {}
    throw err;
  }
}

/**
 * Extract an archive (tar.xz, zip) to a destination directory.
 * @param {string} archivePath - Path to the archive file.
 * @param {string} destDir - Directory to extract into.
 * @param {string[]} [members] - Optional specific members to extract (tar only).
 */
export function extractArchive(archivePath, destDir, members = []) {
  return new Promise((resolve, reject) => {
    const platform = os.platform();
    let command;

    if (platform === "win32") {
      command = `powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`;
    } else {
      ensureDirExists(destDir);
      const memberArgs = members.map((m) => `"${m}"`).join(" ");
      command = `tar -xf "${archivePath}" -C "${destDir}" ${memberArgs}`;
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
