#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveProjectPath } from "./hostProject.mjs";
import { extractMemory, listManifestFiles, readMemoryFile } from "./memoryFormat.mjs";
import { resolveMemoryPlayMode } from "./playMemory.mjs";
import {
    startMemoryBrowseServer,
    startMemoryPlayServer,
} from "./playMemoryServer.mjs";

export const resolvePlayEntry = (manifest, filePaths) => {
    if (filePaths.includes(manifest.entry)) {
        return manifest.entry;
    }

    const indexEntry = filePaths.find(
        (filePath) => filePath === "index.html" || filePath.endsWith("/index.html")
    );

    return indexEntry ?? "";
};

export { resolveMemoryPlayMode } from "./playMemory.mjs";

export const isCliEntry = (entryArg = process.argv[1]) => {
    try {
        return (
            realpathSync(entryArg) ===
            realpathSync(fileURLToPath(import.meta.url))
        );
    } catch {
        return false;
    }
};

const spawnDetached = (command, args, options = {}) =>
    new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            detached: true,
            stdio: "ignore",
            ...options,
        });

        child.once("error", reject);
        child.unref();
        resolve();
    });

const openBrowser = async (url) => {
    if (process.env.BROWSER) {
        await spawnDetached(process.env.BROWSER, [url]);
        return;
    }

    const platform = process.platform;

    if (platform === "darwin") {
        await spawnDetached("open", [url]);
        return;
    }

    if (platform === "win32") {
        await spawnDetached("cmd", ["/c", "start", "", url], { shell: true });
        return;
    }

    await spawnDetached("xdg-open", [url]);
};

export const ensureMemoryPng = (buffer, filePath) => {
    try {
        extractMemory(buffer);
    } catch {
        throw new Error(`${filePath} doesn't contain memory`);
    }
};

export const resolvePlayInput = (argv, projectPath = process.cwd()) => {
    const input = argv.find((arg) => !arg.startsWith("-"));

    if (!input) {
        throw new Error("Specify a memory PNG path.");
    }

    return resolveProjectPath(projectPath, input);
};

const waitForShutdown = (server) =>
    new Promise((resolve) => {
        const shutdown = () => {
            server.close(() => resolve());
        };

        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
    });

const runServerSession = async ({ input, label, openUrl, server }) => {
    console.log(`Playing memory from ${input}`);
    console.log(`Local server: ${openUrl}`);

    try {
        await openBrowser(openUrl);
    } catch (error) {
        console.warn(`Could not open browser: ${error.message ?? error}`);
        console.warn(`Open this URL manually: ${openUrl}`);
    }

    console.log("Press Ctrl+C to stop.");
    await waitForShutdown(server);
};

const openSingleFile = async (manifest, fileBytes, filePath) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "memory-play-file-"));
    const outPath = path.join(tempDir, path.basename(filePath));
    await writeFile(outPath, readMemoryFile(manifest, filePath, fileBytes));

    const fileUrl = pathToFileURL(outPath).href;

    console.log(`Opening ${filePath} from memory`);
    console.log(`File: ${outPath}`);

    try {
        await openBrowser(fileUrl);
    } catch (error) {
        console.warn(`Could not open browser: ${error.message ?? error}`);
        console.warn(`Open this file manually: ${outPath}`);
    }
};

const playMemoryPng = async (input, label = input) => {
    const pngBuffer = await readFile(input);
    ensureMemoryPng(pngBuffer, label);

    const { manifest, fileBytes } = extractMemory(pngBuffer);
    const filePaths = listManifestFiles(manifest);
    const playMode = resolveMemoryPlayMode(manifest, filePaths);

    if (playMode.mode === "file") {
        await openSingleFile(manifest, fileBytes, playMode.path);
        return;
    }

    if (playMode.mode === "play") {
        const { server, baseUrl } = await startMemoryPlayServer(
            manifest,
            fileBytes,
            filePaths,
            playMode.entry
        );
        const openUrl = baseUrl;

        await runServerSession({
            input,
            label,
            openUrl,
            server,
        });
        return;
    }

    const { server, baseUrl } = await startMemoryBrowseServer(
        manifest,
        fileBytes,
        filePaths
    );

    await runServerSession({
        input,
        label,
        openUrl: baseUrl,
        server,
    });
};

const main = async () => {
    const projectPath = process.cwd();
    const argv = process.argv.slice(2);
    const label = argv.find((arg) => !arg.startsWith("-")) ?? "";
    const input = resolvePlayInput(argv, projectPath);

    await playMemoryPng(input, label);
};

const isMain = isCliEntry();

if (isMain) {
    main().catch((error) => {
        console.error(error.message ?? error);
        process.exit(1);
    });
}
