import {
    assertSupportedVersion,
    decodeV2Archive,
    listManifestFiles,
    MAX_PAYLOAD_SIZE,
    MEMORY_VERSION,
    readManifestFile,
    SUPPORTED_VERSIONS,
} from "./payloadFormat.js";

export {
    assertSupportedVersion,
    listManifestFiles,
    MAX_PAYLOAD_SIZE,
    MEMORY_VERSION,
    readManifestFile,
    SUPPORTED_VERSIONS,
} from "./payloadFormat.js";

export const MEMORY_MAGIC = new Uint8Array([0x57, 0x4c, 0x46, 0x43]); // WLFC
export const MEMORY_CHUNK_TYPE = new Uint8Array([0x77, 0x4c, 0x46, 0x43]); // wLFC

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const textDecoder = new TextDecoder();

const bytesMatch = (view, offset, magic) => {
    if (offset < 0 || offset + magic.length > view.length) return false;
    for (let index = 0; index < magic.length; index += 1) {
        if (view[offset + index] !== magic[index]) return false;
    }
    return true;
};

const readUint32BE = (view, offset) =>
    (view[offset] << 24) |
    (view[offset + 1] << 16) |
    (view[offset + 2] << 8) |
    view[offset + 3];

const parsePngChunks = (view) => {
    if (view.length < 8 || !bytesMatch(view, 0, PNG_SIGNATURE)) {
        throw new Error("Invalid PNG signature.");
    }

    const chunks = [];
    let offset = 8;

    while (offset + 12 <= view.length) {
        const length = readUint32BE(view, offset);
        const type = view.slice(offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;

        if (dataEnd + 4 > view.length) {
            throw new Error("PNG chunk exceeds file size.");
        }

        chunks.push({
            type: String.fromCharCode(...type),
            data: view.slice(dataStart, dataEnd),
            start: offset,
            end: dataEnd + 4,
        });

        offset = dataEnd + 4;

        if (chunks[chunks.length - 1].type === "IEND") {
            break;
        }
    }

    return { view, chunks, trailing: view.slice(offset) };
};

const readMemoryPayload = (chunkData) => {
    if (chunkData.length < 8 || !bytesMatch(chunkData, 0, MEMORY_MAGIC)) {
        throw new Error("Memory chunk magic mismatch.");
    }

    const version = readUint32BE(chunkData, 4);
    assertSupportedVersion(version);

    const payload = chunkData.slice(8);
    if (payload.length > MAX_PAYLOAD_SIZE) {
        throw new Error(`Memory payload exceeds ${MAX_PAYLOAD_SIZE} bytes.`);
    }

    return { version, payload };
};

const gunzip = async (payload) => {
    const stream = new Blob([payload])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
};

export const decodeManifest = async (payload) => {
    const decompressed = await gunzip(payload);
    return JSON.parse(textDecoder.decode(decompressed));
};

export const decodeMemoryPayload = async (payload, version) => {
    assertSupportedVersion(version);

    if (version === 1) {
        return {
            manifest: await decodeManifest(payload),
            fileBytes: null,
        };
    }

    return decodeV2Archive(await gunzip(payload));
};

const extractLegacyFooter = async (view) => {
    let magicIndex = -1;
    for (let index = view.length - MEMORY_MAGIC.length; index >= 0; index -= 1) {
        if (bytesMatch(view, index, MEMORY_MAGIC)) {
            magicIndex = index;
            break;
        }
    }

    if (magicIndex < 0) {
        throw new Error("Memory footer not found.");
    }

    const version = readUint32BE(view, magicIndex + 4);
    const payloadLength = readUint32BE(view, magicIndex + 8);
    const payloadStart = magicIndex + 12;
    const payloadEnd = payloadStart + payloadLength;

    if (version !== 1) {
        throw new Error(`Unsupported legacy memory version: ${version}`);
    }

    if (payloadEnd > view.length) {
        throw new Error("Memory payload length exceeds file size.");
    }

    const payload = view.slice(payloadStart, payloadEnd);
    const decoded = await decodeMemoryPayload(payload, version);

    return {
        png: view.slice(0, magicIndex),
        payload,
        ...decoded,
        version,
    };
};

const decodeExtractedMemory = async (png, payload, version) => {
    const decoded = await decodeMemoryPayload(payload, version);

    return {
        png,
        payload,
        ...decoded,
        version,
    };
};

export const extractMemory = async (input) => {
    const view = input instanceof Uint8Array ? input : new Uint8Array(input);

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
            return extractLegacyFooter(view);
        }
    } catch (error) {
        if (error.message?.includes("Memory footer not found")) {
            throw error;
        }

        return extractLegacyFooter(view);
    }

    throw new Error("Memory chunk not found.");
};

export const decodeManifestFile = (fileRecord) => {
    if (!fileRecord?.data) {
        throw new Error("Invalid manifest file record.");
    }

    if (typeof Uint8Array.fromBase64 === "function") {
        return Uint8Array.fromBase64(fileRecord.data, { alphabet: "base64" });
    }

    const binary = atob(fileRecord.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

export const readMemoryFile = (manifest, filePath, fileBytes = null) =>
    readManifestFile(manifest, filePath, fileBytes, decodeManifestFile);
