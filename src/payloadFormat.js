export const MEMORY_VERSION = 2;
export const SUPPORTED_VERSIONS = [1, 2];
export const MAX_PAYLOAD_SIZE = 64 * 1024 * 1024;

export const readUint32BE = (view, offset) =>
    (view[offset] << 24) |
    (view[offset + 1] << 16) |
    (view[offset + 2] << 8) |
    view[offset + 3];

export const writeUint32BE = (view, offset, value) => {
    view[offset] = (value >>> 24) & 0xff;
    view[offset + 1] = (value >>> 16) & 0xff;
    view[offset + 2] = (value >>> 8) & 0xff;
    view[offset + 3] = value & 0xff;
};

export const assertSupportedVersion = (version) => {
    if (!SUPPORTED_VERSIONS.includes(version)) {
        throw new Error(`Unsupported memory version: ${version}`);
    }
};

export const guessMimeType = (filePath) => {
    const lower = filePath.toLowerCase();

    if (lower.endsWith(".html")) return "text/html";
    if (lower.endsWith(".css")) return "text/css";
    if (lower.endsWith(".js")) return "text/javascript";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".woff2")) return "font/woff2";
    if (lower.endsWith(".woff")) return "font/woff";
    return "application/octet-stream";
};

export const listManifestFiles = (manifest) => {
    if (Array.isArray(manifest.files)) {
        return manifest.files.map((file) => file.path);
    }

    return Object.keys(manifest.files ?? {});
};

export const readManifestFile = (
    manifest,
    filePath,
    fileBytes = null,
    decodeV1File = null
) => {
    if (fileBytes?.[filePath]) {
        return fileBytes[filePath];
    }

    const record = manifest.files?.[filePath];
    if (record && decodeV1File) {
        return decodeV1File(record);
    }

    throw new Error(`Manifest file not found: ${filePath}`);
};

const concatBytes = (parts) => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;

    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }

    return output;
};

const toUint8Array = (value) =>
    value instanceof Uint8Array ? value : new Uint8Array(value);

export const buildV2Manifest = ({
    name,
    entry,
    files,
    kind = "web-app",
    runtime = "iframe-sandbox",
    source = "",
}) => {
    const sortedPaths = Object.keys(files).sort();

    return {
        manifest: {
            v: 2,
            kind,
            name,
            entry,
            runtime,
            ...(source ? { source } : {}),
            files: sortedPaths.map((filePath) => {
                const bytes = toUint8Array(files[filePath]);
                return {
                    path: filePath,
                    mime: guessMimeType(filePath),
                    size: bytes.length,
                };
            }),
        },
        sortedPaths,
    };
};

export const encodeV2Archive = ({ name, entry, files, kind, runtime, source }) => {
    const { manifest, sortedPaths } = buildV2Manifest({
        name,
        entry,
        files,
        kind,
        runtime,
        source,
    });
    const json = new TextEncoder().encode(JSON.stringify(manifest));
    const header = new Uint8Array(4);
    writeUint32BE(header, 0, json.length);

    return concatBytes([
        header,
        json,
        ...sortedPaths.map((filePath) => toUint8Array(files[filePath])),
    ]);
};

export const decodeV2Archive = (decompressed) => {
    const view = toUint8Array(decompressed);
    const jsonLength = readUint32BE(view, 0);
    const jsonStart = 4;
    const jsonEnd = jsonStart + jsonLength;

    if (jsonEnd > view.length) {
        throw new Error("Memory manifest length exceeds payload size.");
    }

    const manifest = JSON.parse(new TextDecoder().decode(view.slice(jsonStart, jsonEnd)));
    const fileBytes = {};
    let offset = jsonEnd;

    for (const file of manifest.files ?? []) {
        const end = offset + file.size;
        if (end > view.length) {
            throw new Error(`Memory file exceeds payload size: ${file.path}`);
        }

        fileBytes[file.path] = view.slice(offset, end);
        offset = end;
    }

    if (offset !== view.length) {
        throw new Error("Memory payload trailing bytes remain after decode.");
    }

    return { manifest, fileBytes };
};

export const resolveSafePath = (outDir, filePath, pathSep, pathResolve) => {
    const resolvedOutDir = pathResolve(outDir);
    const target = pathResolve(resolvedOutDir, filePath);
    const prefix = resolvedOutDir.endsWith(pathSep)
        ? resolvedOutDir
        : `${resolvedOutDir}${pathSep}`;

    if (target !== resolvedOutDir && !target.startsWith(prefix)) {
        throw new Error(`Unsafe path in manifest: ${filePath}`);
    }

    return target;
};
