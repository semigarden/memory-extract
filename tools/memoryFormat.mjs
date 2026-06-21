import { gunzipSync } from "node:zlib";
import path from "node:path";
import {
    assertSupportedVersion,
    buildV2Manifest,
    decodeV2Archive,
    encodeV2Archive,
    guessMimeType,
    listManifestFiles,
    MAX_PAYLOAD_SIZE,
    MEMORY_VERSION,
    readManifestFile,
    SUPPORTED_VERSIONS,
} from "../src/payloadFormat.js";
import { PNG_SIGNATURE, createPngChunk, gzipPayload } from "./pngUtils.mjs";

export {
    assertSupportedVersion,
    guessMimeType,
    listManifestFiles,
    MAX_PAYLOAD_SIZE,
    MEMORY_VERSION,
    SUPPORTED_VERSIONS,
} from "../src/payloadFormat.js";

export const MEMORY_MAGIC = Buffer.from("WLFC");
export const MEMORY_CHUNK_TYPE = Buffer.from("wLFC");

const parsePngChunks = (buffer) => {
    const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    if (view.length < 8 || !view.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error("Invalid PNG signature.");
    }

    const chunks = [];
    let offset = 8;

    while (offset + 12 <= view.length) {
        const length = view.readUInt32BE(offset);
        const type = view.subarray(offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;

        if (dataEnd + 4 > view.length) {
            throw new Error("PNG chunk exceeds file size.");
        }

        chunks.push({
            type: type.toString("ascii"),
            data: view.subarray(dataStart, dataEnd),
            start: offset,
            end: dataEnd + 4,
        });

        offset = dataEnd + 4;

        if (type.equals(Buffer.from("IEND"))) {
            break;
        }
    }

    return { view, chunks, trailing: view.subarray(offset) };
};

const readMemoryPayload = (chunkData) => {
    if (chunkData.length < 8) {
        throw new Error("Memory chunk is too small.");
    }

    if (!chunkData.subarray(0, 4).equals(MEMORY_MAGIC)) {
        throw new Error("Memory chunk magic mismatch.");
    }

    const version = chunkData.readUInt32BE(4);
    assertSupportedVersion(version);

    const payload = chunkData.subarray(8);
    if (payload.length > MAX_PAYLOAD_SIZE) {
        throw new Error(`Memory payload exceeds ${MAX_PAYLOAD_SIZE} bytes.`);
    }

    return { version, payload };
};

const extractLegacyFooter = (view) => {
    const magicIndex = view.lastIndexOf(MEMORY_MAGIC);
    if (magicIndex < 8) {
        throw new Error("Memory footer not found.");
    }

    const version = view.readUInt32BE(magicIndex + 4);
    const payloadLength = view.readUInt32BE(magicIndex + 8);
    const payloadStart = magicIndex + 12;
    const payloadEnd = payloadStart + payloadLength;

    if (version !== 1) {
        throw new Error(`Unsupported legacy memory version: ${version}`);
    }

    if (payloadEnd > view.length) {
        throw new Error("Memory payload length exceeds file size.");
    }

    return {
        png: view.subarray(0, magicIndex),
        payload: view.subarray(payloadStart, payloadEnd),
        version,
    };
};

export const buildManifest = ({
    name,
    entry,
    files,
    kind = "web-app",
    runtime = "iframe-sandbox",
    source = "",
}) => ({
    v: 1,
    kind,
    name,
    entry,
    runtime,
    ...(source ? { source } : {}),
    files,
});

export const encodeManifest = (manifest) =>
    gzipPayload(Buffer.from(JSON.stringify(manifest), "utf8"));

export const decodeManifest = (payload) =>
    JSON.parse(gunzipSync(payload).toString("utf8"));

export const encodeMemoryPayload = ({
    name,
    entry,
    files,
    kind = "web-app",
    runtime = "iframe-sandbox",
    source = "",
    version = MEMORY_VERSION,
}) => {
    if (version === 1) {
        const encodedFiles = {};

        for (const [filePath, buffer] of Object.entries(files)) {
            encodedFiles[filePath] = encodeManifestFile(buffer, filePath);
        }

        const manifest = buildManifest({
            name,
            entry,
            files: encodedFiles,
            kind,
            runtime,
            source,
        });

        return {
            version: 1,
            manifest,
            payload: encodeManifest(manifest),
        };
    }

    if (version !== 2) {
        throw new Error(`Unsupported memory version: ${version}`);
    }

    const archive = encodeV2Archive({ name, entry, files, kind, runtime, source });
    const { manifest } = buildV2Manifest({ name, entry, files, kind, runtime, source });

    return {
        version: 2,
        manifest,
        payload: gzipPayload(Buffer.from(archive)),
    };
};

export const decodeMemoryPayload = (payload, version) => {
    assertSupportedVersion(version);

    if (version === 1) {
        return {
            manifest: decodeManifest(payload),
            fileBytes: null,
        };
    }

    return decodeV2Archive(gunzipSync(payload));
};

export const decodeManifestFile = (fileRecord) => {
    if (!fileRecord?.data) {
        throw new Error("Invalid manifest file record.");
    }

    return Buffer.from(fileRecord.data, fileRecord.encoding ?? "base64");
};

export { readManifestFile };

export const readMemoryFile = (manifest, filePath, fileBytes = null) =>
    readManifestFile(manifest, filePath, fileBytes, decodeManifestFile);

export const encodeManifestFile = (buffer, filePath = "") => ({
    encoding: "base64",
    mime: guessMimeType(filePath),
    data: Buffer.from(buffer).toString("base64"),
});

export const embedMemory = (pngBuffer, payloadBuffer, version = MEMORY_VERSION) => {
    if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
        throw new Error("Cover PNG buffer is empty.");
    }

    if (!Buffer.isBuffer(payloadBuffer) || payloadBuffer.length === 0) {
        throw new Error("Payload buffer is empty.");
    }

    assertSupportedVersion(version);

    const { view, chunks } = parsePngChunks(pngBuffer);
    const iendChunk = chunks.find((chunk) => chunk.type === "IEND");

    if (!iendChunk) {
        throw new Error("PNG IEND chunk not found.");
    }

    const chunkData = Buffer.alloc(8 + payloadBuffer.length);
    MEMORY_MAGIC.copy(chunkData, 0);
    chunkData.writeUInt32BE(version, 4);
    payloadBuffer.copy(chunkData, 8);

    const memoryChunk = createPngChunk(MEMORY_CHUNK_TYPE, chunkData);

    return Buffer.concat([
        view.subarray(0, iendChunk.start),
        memoryChunk,
        view.subarray(iendChunk.start),
    ]);
};

const decodeExtractedMemory = (png, payload, version) => {
    const { manifest, fileBytes } = decodeMemoryPayload(payload, version);

    return {
        png,
        payload,
        manifest,
        fileBytes,
        version,
    };
};

export const extractMemory = (buffer) => {
    const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    if (view.length < 12) {
        throw new Error("File is too small to be a memory PNG.");
    }

    try {
        const { view: pngView, chunks, trailing } = parsePngChunks(view);
        const memoryChunk = chunks.find((chunk) => chunk.type === "wLFC");

        if (memoryChunk) {
            const { version, payload } = readMemoryPayload(memoryChunk.data);
            return decodeExtractedMemory(pngView, payload, version);
        }

        if (trailing.length > 0) {
            const legacy = extractLegacyFooter(view);
            return decodeExtractedMemory(legacy.png, legacy.payload, legacy.version);
        }
    } catch (error) {
        if (error.message?.includes("Memory footer not found")) {
            throw error;
        }

        const legacy = extractLegacyFooter(view);
        return decodeExtractedMemory(legacy.png, legacy.payload, legacy.version);
    }

    throw new Error("Memory chunk not found.");
};
