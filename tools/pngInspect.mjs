const PNG_SIGNATURE = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const inspectPng = (buffer) => {
    const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    if (view.length < 24 || !view.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return null;
    }

    const chunkType = view.subarray(12, 16).toString("ascii");
    if (chunkType !== "IHDR") {
        return null;
    }

    return {
        width: view.readUInt32BE(16),
        height: view.readUInt32BE(20),
        bytes: view.length,
    };
};
