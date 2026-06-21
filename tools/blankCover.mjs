import { gzipSync } from "node:zlib";
import { createPngChunk, PNG_SIGNATURE } from "./pngUtils.mjs";

export const createBlankCover = ({
    width = 64,
    height = 64,
    rgb = [0, 8, 2],
} = {}) => {
    const rows = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (width * 3 + 1);
        rows[rowStart] = 0;
        for (let x = 0; x < width; x += 1) {
            const pixelStart = rowStart + 1 + x * 3;
            rows[pixelStart] = rgb[0];
            rows[pixelStart + 1] = rgb[1];
            rows[pixelStart + 2] = rgb[2];
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
        PNG_SIGNATURE,
        createPngChunk("IHDR", ihdr),
        createPngChunk("IDAT", gzipSync(rows, { level: 9 })),
        createPngChunk("IEND", Buffer.alloc(0)),
    ]);
};
