#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = path.join(packageRoot, "package.json");
const distDir = path.join(packageRoot, "dist");
const originalPackageJson = readFileSync(packageJsonPath, "utf8");
const packageJson = JSON.parse(originalPackageJson);
const target = process.env.PKG_TARGET ?? "node22-linux-x64";

const restorePackageJson = () => {
    writeFileSync(packageJsonPath, originalPackageJson);
};

process.on("exit", restorePackageJson);
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

for (const [name, entry] of Object.entries(packageJson.bin)) {
    const singlePackage = {
        ...packageJson,
        name,
        bin: { [name]: entry },
        pkg: {
            ...packageJson.pkg,
            sea: true,
            targets: [target],
        },
    };

    writeFileSync(packageJsonPath, `${JSON.stringify(singlePackage, null, 2)}\n`);

    console.log(`Building ${name} for ${target}...`);

    const result = spawnSync(
        "npx",
        ["pkg", ".", "--sea", "-t", target, "-o", path.join("dist", name)],
        {
            cwd: packageRoot,
            stdio: "inherit",
            env: {
                ...process.env,
                PKG_CACHE_PATH:
                    process.env.PKG_CACHE_PATH ??
                    path.join(packageRoot, ".pkg-cache"),
            },
        }
    );

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

restorePackageJson();
console.log(`Built binaries in ${distDir}`);
