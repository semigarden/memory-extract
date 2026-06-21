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

const MEMORY_PLAY_URL_PREFIX = "MEMORY_PLAY_URL=";
const INTERNAL_ENV = "MEMORY_PLAY_INTERNAL";
const PLAY_SCRIPT = fileURLToPath(import.meta.url);

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

export const parsePlayArgv = (argv) => {
    const foreground = argv.includes("--foreground") || argv.includes("-f");
    const filtered = argv.filter(
        (arg) => arg !== "--foreground" && arg !== "-f"
    );

    return { foreground, argv: filtered };
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

const readPlayUrlFromChild = (child) =>
    new Promise((resolve, reject) => {
        let buffer = "";
        let settled = false;

        const finish = (error, value) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            child.stdout?.off("data", onData);
            child.stderr?.off("data", onStderr);
            child.off("error", onError);
            child.off("exit", onExit);

            if (error) {
                reject(error);
                return;
            }

            resolve(value);
        };

        const onData = (chunk) => {
            buffer += chunk.toString();

            for (const line of buffer.split("\n")) {
                if (!line.startsWith(MEMORY_PLAY_URL_PREFIX)) {
                    continue;
                }

                finish(null, line.slice(MEMORY_PLAY_URL_PREFIX.length).trim());
                return;
            }
        };

        const onStderr = (chunk) => {
            process.stderr.write(chunk);
        };

        const onError = (error) => {
            finish(error);
        };

        const onExit = (code) => {
            if (code !== 0) {
                finish(new Error("memory-play server exited before it was ready."));
            }
        };

        const timeout = setTimeout(() => {
            finish(new Error("Timed out waiting for memory-play server."));
        }, 10_000);

        child.stdout.on("data", onData);
        child.stderr.on("data", onStderr);
        child.once("error", onError);
        child.once("exit", onExit);
    });

const launchDetachedPlay = async (argv, projectPath) => {
    const child = spawn(process.execPath, [PLAY_SCRIPT, ...argv], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, [INTERNAL_ENV]: "1" },
        cwd: projectPath,
    });

    const openUrl = await readPlayUrlFromChild(child);
    const label = argv.find((arg) => !arg.startsWith("-")) ?? "memory";

    console.log(`Playing memory from ${label}`);
    console.log(`Local server: ${openUrl}`);

    try {
        await openBrowser(openUrl);
    } catch (error) {
        console.warn(`Could not open browser: ${error.message ?? error}`);
        console.warn(`Open this URL manually: ${openUrl}`);
    }

    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
};

const waitForShutdown = (server, idlePromise) =>
    new Promise((resolve) => {
        const shutdown = () => {
            process.removeListener("SIGINT", shutdown);
            process.removeListener("SIGTERM", shutdown);
            server.close(() => resolve());
        };

        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
        idlePromise?.then(() => {
            if (process.env[INTERNAL_ENV] !== "1") {
                console.log("Browser session ended.");
            }
            shutdown();
        });
    });

const runServerSession = async ({
    input,
    openUrl,
    server,
    idlePromise,
    internal = false,
}) => {
    if (internal) {
        process.stdout.write(`${MEMORY_PLAY_URL_PREFIX}${openUrl}\n`);
    } else {
        console.log(`Playing memory from ${input}`);
        console.log(`Local server: ${openUrl}`);

        try {
            await openBrowser(openUrl);
        } catch (error) {
            console.warn(`Could not open browser: ${error.message ?? error}`);
            console.warn(`Open this URL manually: ${openUrl}`);
        }

        if (idlePromise) {
            console.log("Close the browser tab or press Ctrl+C to stop.");
        } else {
            console.log("Press Ctrl+C to stop.");
        }
    }

    await waitForShutdown(server, idlePromise);
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

const playMemoryPng = async (input, label = input, options = {}) => {
    const { internal = false } = options;
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
        const { server, baseUrl, idlePromise } = await startMemoryPlayServer(
            manifest,
            fileBytes,
            filePaths,
            playMode.entry,
            { autoExit: true }
        );

        await runServerSession({
            input,
            openUrl: baseUrl,
            server,
            idlePromise,
            internal,
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
        openUrl: baseUrl,
        server,
        internal,
    });
};

const shouldDetachPlay = async (argv, projectPath) => {
    const label = argv.find((arg) => !arg.startsWith("-")) ?? "";
    const input = resolvePlayInput(argv, projectPath);
    const pngBuffer = await readFile(input);
    ensureMemoryPng(pngBuffer, label);
    const { manifest, fileBytes } = extractMemory(pngBuffer);
    const filePaths = listManifestFiles(manifest);
    const playMode = resolveMemoryPlayMode(manifest, filePaths);

    return playMode.mode === "play";
};

const main = async () => {
    const projectPath = process.cwd();
    const rawArgv = process.argv.slice(2);
    const internal = process.env[INTERNAL_ENV] === "1";
    const { foreground, argv } = parsePlayArgv(rawArgv);

    if (!internal && !foreground && (await shouldDetachPlay(argv, projectPath))) {
        await launchDetachedPlay(argv, projectPath);
        return;
    }

    const label = argv.find((arg) => !arg.startsWith("-")) ?? "";
    const input = resolvePlayInput(argv, projectPath);
    await playMemoryPng(input, label, { internal });
};

const isMain = isCliEntry();

if (isMain) {
    main().catch((error) => {
        console.error(error.message ?? error);
        process.exit(1);
    });
}
