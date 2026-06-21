import {
    listManifestFiles,
    readMemoryFile,
    extractMemory,
} from "./memoryFormat.js";
import {
    buildInteractiveBrowseDocument,
    buildMemoryBrowseListings,
    resolveMemoryPlayMode,
} from "./memoryPlay.js";

const textDecoder = new TextDecoder();

const REWRITABLE_ATTRIBUTES = [
    ["script", "src"],
    ["link", "href"],
    ["img", "src"],
    ["source", "src"],
    ["video", "src"],
    ["audio", "src"],
    ["image", "href"],
];

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

const readInput = async (input) => {
    if (input instanceof Uint8Array) {
        return input;
    }

    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }

    if (input instanceof Blob) {
        return new Uint8Array(await input.arrayBuffer());
    }

    throw new Error("Expected a PNG memory image.");
};

const normalizeAssetPath = (value) => value.replace(/^\.\//, "");

const stripLeadingSlash = (value) =>
    value.startsWith("/") ? value.slice(1) : value;

const guessMimeType = (filePath, record) => {
    if (record?.mime) return record.mime;
    if (filePath.endsWith(".html")) return "text/html";
    if (filePath.endsWith(".css")) return "text/css";
    if (filePath.endsWith(".js")) return "text/javascript";
    if (filePath.endsWith(".svg")) return "image/svg+xml";
    if (filePath.endsWith(".png")) return "image/png";
    if (filePath.endsWith(".json")) return "application/json";
    if (filePath.endsWith(".woff2")) return "font/woff2";
    if (filePath.endsWith(".woff")) return "font/woff";
    return "application/octet-stream";
};

const resolveAssetUrl = (rawPath, urlByPath) => {
    if (!rawPath) return null;
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(rawPath)) return null;

    const normalized = normalizeAssetPath(rawPath);
    return urlByPath.get(normalized) ?? urlByPath.get(rawPath) ?? null;
};

const resolveManifestPath = (basePath, rawPath, manifestPaths) => {
    const manifestSet = new Set(manifestPaths);
    const normalized = stripLeadingSlash(normalizeAssetPath(rawPath));

    if (manifestSet.has(normalized)) {
        return normalized;
    }

    if (manifestSet.has(rawPath)) {
        return rawPath;
    }

    if (!basePath.includes("/")) {
        return manifestSet.has(normalized) ? normalized : null;
    }

    const baseDir = basePath.slice(0, basePath.lastIndexOf("/"));
    const joined = normalizeAssetPath(`${baseDir}/${normalized}`);

    return manifestSet.has(joined) ? joined : null;
};

const extractCssAssetPaths = (cssText) => {
    const paths = [];
    for (const match of cssText.matchAll(CSS_URL_PATTERN)) {
        paths.push(match[2]);
    }
    return paths;
};

const collectRequiredFiles = (manifest, fileBytes, entryPath) => {
    const manifestPaths = listManifestFiles(manifest);
    const required = new Set([entryPath]);

    for (const filePath of manifestPaths) {
        if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
            required.add(filePath);
        }
    }

    let previousSize = 0;
    while (required.size !== previousSize) {
        previousSize = required.size;

        for (const filePath of [...required]) {
            const bytes = readMemoryFile(manifest, filePath, fileBytes);
            const text = textDecoder.decode(bytes);
            const refs = [];

            if (filePath.endsWith(".html")) {
                const doc = new DOMParser().parseFromString(text, "text/html");
                REWRITABLE_ATTRIBUTES.forEach(([tag, attribute]) => {
                    doc.querySelectorAll(`${tag}[${attribute}]`).forEach((element) => {
                        refs.push(element.getAttribute(attribute));
                    });
                });
            }

            if (filePath.endsWith(".css")) {
                refs.push(...extractCssAssetPaths(text));
            }

            refs.forEach((ref) => {
                const resolved = resolveManifestPath(filePath, ref, manifestPaths);
                if (resolved) {
                    required.add(resolved);
                }
            });
        }
    }

    return required;
};

const BLOB_LAUNCH_BASE = "http://localhost/";

const injectBlobLaunchShim = (doc) => {
    const base = doc.createElement("base");
    base.setAttribute("href", BLOB_LAUNCH_BASE);
    doc.head.prepend(base);

    const shim = doc.createElement("script");
    shim.textContent = `(function () {
  var base = ${JSON.stringify(BLOB_LAUNCH_BASE)};
  var NativeURL = URL;
  var invalidBase = function (value) {
    if (!value) return true;
    var text = String(value);
    return text === "null" || text.indexOf("blob:") === 0;
  };
  URL = function (url, baseUrl) {
    if (typeof url === "string" && url.charAt(0) === "/" && invalidBase(baseUrl)) {
      return new NativeURL(url, base);
    }
    return new NativeURL(url, baseUrl);
  };
  URL.prototype = NativeURL.prototype;
  URL.createObjectURL = NativeURL.createObjectURL.bind(NativeURL);
  URL.revokeObjectURL = NativeURL.revokeObjectURL.bind(NativeURL);
})();`;
    doc.head.prepend(shim);
};

export const resolveLaunchAssetUrl = (rawPath, urlByPath, entryPath, manifestPaths) => {
    const direct = resolveAssetUrl(rawPath, urlByPath);
    if (direct) {
        return direct;
    }

    if (!rawPath || !entryPath || !manifestPaths) {
        return null;
    }

    const resolved = resolveManifestPath(entryPath, rawPath, manifestPaths);
    return resolved ? urlByPath.get(resolved) ?? null : null;
};

const buildLaunchDocument = (html, urlByPath, entryPath, manifestPaths) => {
    const doc = new DOMParser().parseFromString(html, "text/html");

    REWRITABLE_ATTRIBUTES.forEach(([tag, attribute]) => {
        doc.querySelectorAll(`${tag}[${attribute}]`).forEach((element) => {
            const rawPath = element.getAttribute(attribute);
            const assetUrl = resolveLaunchAssetUrl(
                rawPath,
                urlByPath,
                entryPath,
                manifestPaths
            );

            if (assetUrl) {
                element.setAttribute(attribute, assetUrl);
            }

            element.removeAttribute("crossorigin");
        });
    });

    doc.documentElement.querySelectorAll("[crossorigin]").forEach((element) => {
        element.removeAttribute("crossorigin");
    });

    injectBlobLaunchShim(doc);

    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
};

const getManifestFileMeta = (manifest, filePath) => {
    if (Array.isArray(manifest.files)) {
        return manifest.files.find((file) => file.path === filePath) ?? null;
    }

    return manifest.files?.[filePath] ?? null;
};

const attachBlobDispose = (blob, blobUrls) => {
    blob.dispose = () => {
        blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };

    return blob;
};

const createFileLaunchBlob = (manifest, fileBytes, filePath, blobUrls) => {
    const fileMeta = getManifestFileMeta(manifest, filePath);
    const fileContent = readMemoryFile(manifest, filePath, fileBytes);
    const mime = guessMimeType(filePath, fileMeta);
    const launchBlob = new Blob([fileContent], { type: mime });

    return attachBlobDispose(launchBlob, blobUrls);
};

const createBrowseLaunchBlob = (manifest, fileBytes, filePaths, blobUrls) => {
    const fileUrlByPath = new Map();

    for (const filePath of filePaths) {
        const fileMeta = getManifestFileMeta(manifest, filePath);
        const fileContent = readMemoryFile(manifest, filePath, fileBytes);
        const mime = guessMimeType(filePath, fileMeta);
        const assetUrl = URL.createObjectURL(new Blob([fileContent], { type: mime }));
        blobUrls.push(assetUrl);
        fileUrlByPath.set(filePath, assetUrl);
    }

    const listings = buildMemoryBrowseListings(filePaths, fileUrlByPath);
    const launchDocument = buildInteractiveBrowseDocument(listings);
    const launchBlob = new Blob([launchDocument], { type: "text/html" });

    return attachBlobDispose(launchBlob, blobUrls);
};

const createPlayLaunchBlob = (manifest, fileBytes, entryPath, blobUrls) => {
    const urlByPath = new Map();
    const requiredFiles = collectRequiredFiles(manifest, fileBytes, entryPath);

    for (const filePath of requiredFiles) {
        const fileMeta = getManifestFileMeta(manifest, filePath);
        const fileContent = readMemoryFile(manifest, filePath, fileBytes);
        const mime = guessMimeType(filePath, fileMeta);
        const assetUrl = URL.createObjectURL(new Blob([fileContent], { type: mime }));
        blobUrls.push(assetUrl);
        urlByPath.set(filePath, assetUrl);
        urlByPath.set(normalizeAssetPath(filePath), assetUrl);
    }

    if (!requiredFiles.has(entryPath)) {
        throw new Error(`Manifest entry not found: ${entryPath}`);
    }

    const htmlBytes = readMemoryFile(manifest, entryPath, fileBytes);
    const html = textDecoder.decode(htmlBytes);
    const manifestPaths = listManifestFiles(manifest);
    const launchDocument = buildLaunchDocument(
        html,
        urlByPath,
        entryPath,
        manifestPaths
    );
    const launchBlob = new Blob([launchDocument], { type: "text/html" });

    return attachBlobDispose(launchBlob, blobUrls);
};

export const createMemoryBlob = async (input) => {
    const bytes = await readInput(input);
    const { manifest, fileBytes } = await extractMemory(bytes);
    const filePaths = listManifestFiles(manifest);
    const playMode = resolveMemoryPlayMode(manifest, filePaths);
    const blobUrls = [];

    try {
        if (playMode.mode === "file") {
            return createFileLaunchBlob(manifest, fileBytes, playMode.path, blobUrls);
        }

        if (playMode.mode === "browse") {
            return createBrowseLaunchBlob(manifest, fileBytes, filePaths, blobUrls);
        }

        return createPlayLaunchBlob(
            manifest,
            fileBytes,
            playMode.entry ?? manifest.entry,
            blobUrls
        );
    } catch (error) {
        blobUrls.forEach((url) => URL.revokeObjectURL(url));
        throw error;
    }
};
