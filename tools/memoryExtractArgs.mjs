import { realpathSync } from "node:fs";
import path from "node:path";

const MEMORY_EXTRACT_BIN = "me";

export const isPackagedMemoryExtract = (argv = process.argv) =>
    path.basename(argv[0] ?? "") === MEMORY_EXTRACT_BIN;

const isPkgSnapshotEntry = (value) =>
    typeof value === "string" &&
    (value.includes("memoryExtract.mjs") || value.startsWith("/snapshot/"));

const isSeaExecutableArgvLayout = (argv) => {
    if (!argv[1]) {
        return false;
    }

    if (argv[1] === argv[0]) {
        return true;
    }

    try {
        return realpathSync(argv[0]) === realpathSync(argv[1]);
    } catch {
        return path.basename(argv[1]) === MEMORY_EXTRACT_BIN;
    }
};

const packagedArgvStart = (argv) => {
    if (isPkgSnapshotEntry(argv[1])) {
        return 2;
    }

    return isSeaExecutableArgvLayout(argv) ? 2 : 1;
};

export const parseMemoryExtractArgv = (argv = process.argv) => {
    if (isPackagedMemoryExtract(argv)) {
        const start = packagedArgvStart(argv);
        return { subcommand: argv[start], args: argv.slice(start + 1) };
    }

    const entryBase = path.basename(argv[1] ?? "");
    if (entryBase === "memoryExtract.mjs" || entryBase === MEMORY_EXTRACT_BIN) {
        return { subcommand: argv[2], args: argv.slice(3) };
    }

    return { subcommand: null, args: [] };
};
