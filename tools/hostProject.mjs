import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_EXCLUDE = [
    "**/*.map",
    "node_modules",
    "node_modules/**",
    ".git",
    ".git/**",
];
const DEFAULT_PATH = ".";

const isFlag = (arg) => arg.startsWith("-");

export const parsePackArgv = (argv, defaultInput = DEFAULT_PATH) => {
    let inputPath = defaultInput;
    let outName = "";
    let index = 0;

    const first = argv[index];
    if (first && !isFlag(first)) {
        inputPath = first;
        index += 1;

        const second = argv[index];
        if (second && !isFlag(second)) {
            outName = second;
            index += 1;
        }
    }

    return {
        input: path.resolve(inputPath),
        outName,
        argv: argv.slice(index),
    };
};

export const parseUnpackArgv = (argv) => {
    const positional = [];
    const remaining = [];

    for (const arg of argv) {
        if (isFlag(arg)) {
            remaining.push(arg);
            continue;
        }

        if (positional.length < 2) {
            positional.push(arg);
            continue;
        }

        remaining.push(arg);
    }

    return {
        input: positional[0] ? path.resolve(positional[0]) : "",
        out: positional[1] ? path.resolve(positional[1]) : "",
        argv: remaining,
    };
};

export const resolveProjectPath = (rootDir, targetPath = "") =>
    path.resolve(rootDir, targetPath);

export const loadHostProject = async (rootDir = process.cwd()) => {
    try {
        const packagePath = path.join(rootDir, "package.json");
        const pkg = JSON.parse(await readFile(packagePath, "utf8"));
        const memory = pkg.memory ?? {};
        const name = memory.name ?? pkg.name ?? "memory";
        const dist = path.resolve(rootDir, memory.dist ?? "dist");
        const out = memory.out
            ? path.resolve(rootDir, memory.out)
            : "";

        return {
            root: rootDir,
            name,
            dist,
            out,
            cover: memory.cover ? path.resolve(rootDir, memory.cover) : "",
            entry: memory.entry ?? "index.html",
            exclude: [...new Set([...DEFAULT_EXCLUDE, ...(memory.exclude ?? [])])],
            unpackDir: memory.unpackDir
                ? path.resolve(rootDir, memory.unpackDir)
                : "",
        };
    } catch {
        return {
            root: rootDir,
            name: "memory",
            dist: path.resolve(rootDir, "dist"),
            out: "",
            cover: "",
            entry: "index.html",
            exclude: [...DEFAULT_EXCLUDE],
            unpackDir: "",
        };
    }
};

export const resolveInputIdentity = (inputPath, { isFile = false } = {}) => {
    const resolved = path.resolve(inputPath);
    const baseName = path.basename(resolved);

    if (isFile) {
        const extension = path.extname(baseName);
        return extension ? baseName.slice(0, -extension.length) : baseName;
    }

    return baseName;
};

export const prefixFilePaths = (files, prefix) => {
    if (!prefix) {
        return files;
    }

    const normalized = prefix.replace(/\\/g, "/");

    return Object.fromEntries(
        Object.entries(files).map(([filePath, buffer]) => [
            filePath ? `${normalized}/${filePath}` : normalized,
            buffer,
        ])
    );
};

export const resolvePackSource = (projectPath, inputPath, { isFile = false } = {}) => {
    if (isFile) {
        return "";
    }

    const relative = path.relative(projectPath, path.resolve(inputPath));

    if (!relative || relative === ".") {
        return "";
    }

    return relative.split(path.sep).join("/");
};

export const resolveUnpackDir = ({
    manifestSource,
    explicitOut,
    host,
}) => {
    if (explicitOut) {
        return path.resolve(explicitOut);
    }

    if (host.unpackDir) {
        return host.unpackDir;
    }

    if (manifestSource) {
        return path.join(host.root ?? process.cwd(), manifestSource);
    }

    return host.root ?? process.cwd();
};
