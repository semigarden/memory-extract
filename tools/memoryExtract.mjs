#!/usr/bin/env node
import { parseMemoryExtractArgv } from "./memoryExtractArgs.mjs";
import { runPack } from "./pack.mjs";
import { runPlay } from "./play.mjs";
import { runUnpack } from "./unpack.mjs";

const COMMANDS = {
    pack: runPack,
    unpack: runUnpack,
    play: runPlay,
};

const printUsage = () => {
    console.error(`Usage:
  me pack [path] [filename] [options]
  me unpack <png> [out-dir]
  me play <png> [--foreground]

Examples:
  me pack dist
  me unpack App.png
  me play App.png`);
};

const main = async () => {
    const { subcommand, args } = parseMemoryExtractArgv();

    if (!subcommand || !COMMANDS[subcommand]) {
        printUsage();
        process.exit(subcommand ? 1 : 0);
    }

    await COMMANDS[subcommand](args);
};

main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
});
