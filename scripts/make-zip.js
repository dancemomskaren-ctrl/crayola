// Build a proper zip with directory structure preserved
import fs from "fs";
import path from "path";
import zlib from "zlib";

const root = "/home/annamaeacorrigan/crayola-audit/crayola";
const files = [
  "packages/core/src/db.ts",
  "packages/core/src/index.ts",
  "packages/core/src/templates.ts",
  "packages/api/src/index.ts",
  "packages/ai/src/index.ts",
  "packages/web/src/App.tsx",
];

const out = "/home/annamaeacorrigan/crayola-standup-v3-fix.zip";

// We need a real zip implementation. Fallback: tar.gz with directory structure.
import { createTarGz } from "./tar-helper.ts"; // we'll inline instead

// Since we don't have zip library available, just use tar.gz with dirs preserved
import tar from "tar";
const filePaths = files.map(f => path.join(root, f));
// Write the tar.gz
const output = fs.createWriteStream(out.replace(".zip", ".tar.gz"));
const archive = tar.create({
  cwd: root,
  gzip: true,
  file: out.replace(".zip", ".tar.gz")
}, files);
console.log("Created tarball with preserved paths");
