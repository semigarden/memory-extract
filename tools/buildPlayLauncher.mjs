#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(toolsDir);
const outfile = path.join(toolsDir, "playLauncher.bundle.js");

const result = spawnSync(
    "npx",
    [
        "--yes",
        "esbuild",
        path.join(packageRoot, "src/index.js"),
        "--bundle",
        "--platform=browser",
        "--format=iife",
        "--global-name=MemoryExtract",
        "--target=chrome109,firefox115,safari16",
        `--outfile=${outfile}`,
    ],
    { cwd: packageRoot, stdio: "inherit" }
);

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

console.log("Built tools/playLauncher.bundle.js");
