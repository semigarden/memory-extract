#!/usr/bin/env node
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBlankCover } from "./blankCover.mjs";
import { matchesAnyGlob } from "./glob.mjs";
import {
    loadHostProject,
    parsePackArgv,
    prefixFilePaths,
    resolveInputIdentity,
    resolveProjectPath,
} from "./hostProject.mjs";
import {
    embedMemory,
    encodeMemoryPayload,
} from "./memoryFormat.mjs";

const shouldSkipPath = (absolutePath, skipPaths) => {
    const resolved = path.resolve(absolutePath);

    return skipPaths.some((skipPath) => {
        const resolvedSkip = path.resolve(skipPath);
        return (
            resolved === resolvedSkip ||
            resolved.startsWith(`${resolvedSkip}${path.sep}`)
        );
    });
};

const shouldExcludePath = (relativePath, excludePatterns) => {
    if (matchesAnyGlob(relativePath, excludePatterns)) {
        return true;
    }

    return excludePatterns.some((pattern) => {
        if (!pattern.endsWith("/**")) {
            return false;
        }

        const root = pattern.slice(0, -3);
        return relativePath === root || relativePath.startsWith(`${root}/`);
    });
};

const collectFiles = async (dir, baseDir, skipPaths, excludePatterns) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = {};
    const fileReads = [];
    const subdirs = [];

    for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);

        if (shouldSkipPath(absolutePath, skipPaths)) {
            continue;
        }

        const relativePath = path.relative(baseDir, absolutePath)
            .split(path.sep)
            .join("/");

        if (entry.isDirectory()) {
            if (shouldExcludePath(relativePath, excludePatterns)) {
                continue;
            }

            subdirs.push(absolutePath);
            continue;
        }

        if (entry.isSymbolicLink()) {
            const linkStat = await stat(absolutePath);

            if (linkStat.isDirectory()) {
                if (shouldExcludePath(relativePath, excludePatterns)) {
                    continue;
                }

                subdirs.push(absolutePath);
                continue;
            }
        }

        if (shouldExcludePath(relativePath, excludePatterns)) {
            continue;
        }

        fileReads.push(
            readFile(absolutePath).then((buffer) => {
                files[relativePath] = buffer;
            })
        );
    }

    await Promise.all([
        ...fileReads,
        ...subdirs.map((subdir) =>
            collectFiles(subdir, baseDir, skipPaths, excludePatterns).then(
                (nested) => {
                    Object.assign(files, nested);
                }
            )
        ),
    ]);

    return files;
};

const buildSkipPaths = (options) =>
    [options.out, `${options.out}.tmp`].map((entry) => path.resolve(entry));

const resolveEntry = (files, preferredEntry) => {
    const filePaths = Object.keys(files).sort();

    if (filePaths.length === 0) {
        throw new Error("No files to pack.");
    }

    if (files[preferredEntry]) {
        return preferredEntry;
    }

    const htmlEntry = filePaths.find((filePath) => filePath.endsWith(".html"));
    if (htmlEntry) {
        return htmlEntry;
    }

    return filePaths[0];
};

const collectInput = async (inputPath, skipPaths, excludePatterns) => {
    let inputStat;

    try {
        inputStat = await stat(inputPath);
    } catch {
        throw new Error(`Input not found at ${inputPath}.`);
    }

    if (inputStat.isFile()) {
        const relativePath = path.basename(inputPath);
        return {
            files: {
                [relativePath]: await readFile(inputPath),
            },
            entry: relativePath,
            source: "",
        };
    }

    if (inputStat.isDirectory()) {
        return {
            files: await collectFiles(inputPath, inputPath, skipPaths, excludePatterns),
            entry: "",
            source: "",
        };
    }

    throw new Error(`Input is not a file or directory: ${inputPath}`);
};

const ensurePngExtension = (fileName) =>
    fileName.toLowerCase().endsWith(".png") ? fileName : `${fileName}.png`;

const parseArgs = async (argv) => {
    const projectPath = process.cwd();
    const host = await loadHostProject(projectPath);
    const { input: defaultInput, outName, argv: packArgv } = parsePackArgv(argv);
    const options = {
        root: projectPath,
        input: defaultInput,
        outName,
        cover: host.cover,
        out: host.out,
        name: host.name,
        entry: host.entry,
        exclude: [...host.exclude],
        entryExplicit: false,
        nameExplicit: false,
        outExplicit: Boolean(host.out),
    };

    for (let index = 0; index < packArgv.length; index += 1) {
        const arg = packArgv[index];
        if (arg === "--input" || arg === "--dist") {
            options.input = resolveProjectPath(projectPath, packArgv[index + 1] ?? "");
            index += 1;
        } else if (arg === "--cover") {
            options.cover = resolveProjectPath(projectPath, packArgv[index + 1] ?? "");
            index += 1;
        } else if (arg === "--out") {
            options.out = resolveProjectPath(projectPath, packArgv[index + 1] ?? "");
            options.outExplicit = true;
            index += 1;
        } else if (arg === "--name") {
            options.name = packArgv[index + 1] ?? options.name;
            options.nameExplicit = true;
            index += 1;
        } else if (arg === "--entry") {
            options.entry = packArgv[index + 1] ?? options.entry;
            options.entryExplicit = true;
            index += 1;
        } else if (arg === "--exclude") {
            options.exclude.push(packArgv[index + 1] ?? "");
            index += 1;
        }
    }

    options.exclude = [...new Set(options.exclude.filter(Boolean))];

    if (options.outName && !options.outExplicit) {
        options.out = resolveProjectPath(
            projectPath,
            ensurePngExtension(options.outName)
        );
        options.outExplicit = true;
    }

    if (options.outName && !options.nameExplicit) {
        options.name = options.outName;
        options.nameExplicit = true;
    }

    return options;
};

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

export const runPack = async (argv) => {
    const options = await parseArgs(argv);
    const inputStat = await stat(options.input);
    const inputIsFile = inputStat.isFile();
    const identity = resolveInputIdentity(options.input, { isFile: inputIsFile });

    if (!options.nameExplicit) {
        options.name = identity;
    }

    if (!options.outExplicit) {
        options.out = path.join(options.root, `${identity}.png`);
    }

    let cover;
    if (options.cover) {
        cover = await readFile(options.cover);
        // console.log(`Using cover image ${options.cover}`);
    } else {
        cover = createBlankCover();
        // console.log("Using blank cover image");
    }

    const skipPaths = buildSkipPaths(options);
    const collected = await collectInput(
        options.input,
        skipPaths,
        options.exclude
    );
    let { files, entry: fileEntry } = collected;
    const preferredEntry = inputIsFile
        ? options.entry
        : path.posix.join(identity, options.entry);

    if (!inputIsFile) {
        files = prefixFilePaths(files, identity);
    }

    const entry = fileEntry || resolveEntry(files, preferredEntry);

    if (options.entryExplicit && !files[options.entry]) {
        throw new Error(
            `Entry not found: ${options.entry}. Checked ${Object.keys(files).length} files.`
        );
    }

    const { payload, version } = encodeMemoryPayload({
        name: options.name,
        entry,
        files,
    });
    const memory = embedMemory(cover, payload, version);

    const tempPath = `${options.out}.tmp`;
    await writeFile(tempPath, memory);
    await rename(tempPath, options.out);

    // console.log(
    //     `Packed ${Object.keys(files).length} files from ${options.input} into ${options.out} (${formatKb(memory.length)})`
    // );
    // console.log(`  cover: ${formatKb(cover.length)}, payload: ${formatKb(payload.length)}, format: v${version}`);
};
