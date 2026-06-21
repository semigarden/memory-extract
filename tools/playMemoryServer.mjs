import http from "node:http";
import path from "node:path";
import {
    createMemoryPlayIdleWatcher,
    isMemoryPlayPingPath,
    maybeInjectMemoryPlayLifecycle,
} from "../src/memoryPlayLifecycle.js";
import { guessMimeType } from "../src/payloadFormat.js";
import {
    buildBrowseListingDocument,
    listVirtualEntries,
} from "../src/memoryPlay.js";
import { listManifestFiles, readMemoryFile } from "./memoryFormat.mjs";

export const normalizeUrlPath = (pathname) => {
    const decoded = decodeURIComponent(pathname || "/");
    const trimmed = decoded.replace(/\/+$/, "");
    return trimmed || "/";
};

export const urlPathToManifestPath = (urlPath) =>
    urlPath === "/" ? "" : urlPath.slice(1);

export const resolveEntryMountPrefix = (entryPath) => {
    const slash = entryPath.lastIndexOf("/");
    if (slash <= 0) {
        return "";
    }

    return entryPath.slice(0, slash + 1);
};

const hrefForEntry = (urlPath, name, isDirectory) => {
    const base = urlPath === "/" ? "" : urlPath;
    const href = `${base}/${name}${isDirectory ? "/" : ""}`.replace(/\/+/g, "/");
    return encodeURI(href);
};

export const resolveManifestPathForUrl = (urlPath, manifestPaths, entryPath = "") => {
    const manifestSet = new Set(manifestPaths);
    const direct = urlPathToManifestPath(urlPath);

    if (direct && manifestSet.has(direct)) {
        return direct;
    }

    const mountPrefix = resolveEntryMountPrefix(entryPath);

    if (direct && mountPrefix) {
        const mounted = `${mountPrefix}${direct}`.replace(/\/+/g, "/");
        if (manifestSet.has(mounted)) {
            return mounted;
        }
    }

    return null;
};

const startHttpServer = async (handler) => {
    const server = http.createServer(handler);

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const { port } = server.address();

    return {
        server,
        baseUrl: `http://127.0.0.1:${port}/`,
    };
};

const serveManifestFile = (
    response,
    manifest,
    fileBytes,
    manifestPath,
    options = {}
) => {
    const mime = guessMimeType(manifestPath);
    const body = maybeInjectMemoryPlayLifecycle(
        readMemoryFile(manifest, manifestPath, fileBytes),
        mime,
        options.injectLifecycle
    );

    response.writeHead(200, {
        "Content-Type": mime,
    });
    response.end(body);
};

const isHtmlEntryPath = (entryPath) =>
    entryPath.endsWith(".html") || entryPath.endsWith(".htm");

export const createMemoryPlayHandler = (
    manifest,
    fileBytes,
    filePaths,
    entryPath,
    options = {}
) => {
    const manifestPaths = filePaths ?? listManifestFiles(manifest);
    const mountPrefix = resolveEntryMountPrefix(entryPath);
    const { idleWatcher } = options;

    return (request, response) => {
        try {
            const url = new URL(request.url ?? "/", "http://localhost");
            const urlPath = normalizeUrlPath(url.pathname);

            if (isMemoryPlayPingPath(urlPath)) {
                idleWatcher?.touch();
                response.writeHead(204);
                response.end();
                return;
            }

            if (mountPrefix) {
                const mountRoot = `/${mountPrefix.replace(/\/$/, "")}`;

                if (urlPath === mountRoot || urlPath.startsWith(`${mountRoot}/`)) {
                    const relative =
                        urlPath === mountRoot ? "/" : urlPath.slice(mountRoot.length);
                    response.writeHead(302, {
                        Location: relative.startsWith("/") ? relative : `/${relative}`,
                    });
                    response.end();
                    return;
                }
            }

            let manifestPath = null;

            if (urlPath === "/") {
                manifestPath = entryPath;
            } else {
                manifestPath = resolveManifestPathForUrl(
                    urlPath,
                    manifestPaths,
                    entryPath
                );
            }

            if (
                !manifestPath &&
                isHtmlEntryPath(entryPath) &&
                request.method === "GET"
            ) {
                manifestPath = entryPath;
            }

            if (!manifestPath) {
                response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                response.end("Not found");
                return;
            }

            serveManifestFile(response, manifest, fileBytes, manifestPath, {
                injectLifecycle: manifestPath === entryPath,
            });
        } catch (error) {
            response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            response.end(error.message ?? "Not found");
        }
    };
};

export const createMemoryBrowseHandler = (manifest, fileBytes, filePaths) => {
    const manifestPaths = filePaths ?? listManifestFiles(manifest);

    return (request, response) => {
        try {
            const url = new URL(request.url ?? "/", "http://localhost");
            const urlPath = normalizeUrlPath(url.pathname);
            const manifestPath = resolveManifestPathForUrl(urlPath, manifestPaths);

            if (manifestPath) {
                serveManifestFile(response, manifest, fileBytes, manifestPath);
                return;
            }

            const entries = listVirtualEntries(manifestPaths, urlPath);

            if (entries.length === 0) {
                response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                response.end("Not found");
                return;
            }

            const listingEntries = entries.map((entry) => ({
                name: entry.name,
                isDirectory: entry.isDirectory,
                href: hrefForEntry(urlPath, entry.name, entry.isDirectory),
            }));
            const parentHref =
                urlPath === "/"
                    ? null
                    : encodeURI(`${normalizeUrlPath(path.posix.dirname(urlPath) || "/")}/`.replace(/\/+/g, "/"));
            const html = buildBrowseListingDocument(urlPath, listingEntries, {
                showParent: urlPath !== "/",
                parentHref: parentHref ?? "../",
            });

            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
            });
            response.end(html);
        } catch (error) {
            response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            response.end(error.message ?? "Not found");
        }
    };
};

export const startMemoryPlayServer = async (
    manifest,
    fileBytes,
    filePaths,
    entryPath,
    options = {}
) => {
    const autoExit = options.autoExit ?? false;
    let idleWatcher = null;
    let resolveIdle = null;
    const idlePromise = autoExit
        ? new Promise((resolve) => {
              resolveIdle = resolve;
          })
        : null;

    if (autoExit) {
        idleWatcher = createMemoryPlayIdleWatcher({
            idleMs: options.idleMs ?? 45_000,
            onIdle: () => {
                idleWatcher?.stop();
                resolveIdle?.();
            },
        });
        idleWatcher.touch();
    }

    const handler = createMemoryPlayHandler(
        manifest,
        fileBytes,
        filePaths,
        entryPath,
        { idleWatcher }
    );
    const serverInfo = await startHttpServer(handler);

    return {
        ...serverInfo,
        idlePromise,
        idleWatcher,
    };
};

export const startMemoryBrowseServer = async (manifest, fileBytes, filePaths) => {
    const handler = createMemoryBrowseHandler(manifest, fileBytes, filePaths);
    return startHttpServer(handler);
};
