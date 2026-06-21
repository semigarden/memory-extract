#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveSafePath } from "../src/payloadFormat.js";
import {
    extractMemory,
    listManifestFiles,
    readMemoryFile,
} from "./memoryFormat.mjs";
import {
    loadHostProject,
    parseUnpackArgv,
    resolveUnpackDir,
} from "./hostProject.mjs";

const parseArgs = async (argv) => {
    const host = await loadHostProject(process.cwd());
    const { input, out: explicitOut } = parseUnpackArgv(argv);

    if (!input) {
        throw new Error("Specify a memory PNG path.");
    }

    return { input, explicitOut, host };
};

const main = async () => {
    const { input, explicitOut, host } = await parseArgs(process.argv.slice(2));
    const buffer = await readFile(input);
    const { manifest, fileBytes, version } = extractMemory(buffer);
    const outDir = resolveUnpackDir({
        manifestSource: manifest.source ?? "",
        explicitOut,
        host,
    });

    await mkdir(outDir, { recursive: true });

    for (const filePath of listManifestFiles(manifest)) {
        const target = resolveSafePath(
            outDir,
            filePath,
            path.sep,
            path.resolve.bind(path)
        );
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, readMemoryFile(manifest, filePath, fileBytes));
    }

    console.log(
        `Extracted ${listManifestFiles(manifest).length} files to ${outDir} (format v${version})`
    );
};

main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
});
