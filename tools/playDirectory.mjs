import { readdir, readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { guessMimeType, resolveSafePath } from "../src/payloadFormat.js";

const INDEX_CANDIDATES = ["index.html", "index.htm"];

export const findDirectoryIndex = async (dirPath) => {
    for (const name of INDEX_CANDIDATES) {
        try {
            const entryStat = await stat(path.join(dirPath, name));
            if (entryStat.isFile()) {
                return name;
            }
        } catch {
            continue;
        }
    }

    return "";
};

const normalizeUrlPath = (pathname) => {
    const decoded = decodeURIComponent(pathname || "/");
    const trimmed = decoded.replace(/\/+$/, "");
    return trimmed || "/";
};

const urlPathToFsPath = (rootDir, urlPath) => {
    const relative = urlPath === "/"
        ? ""
        : urlPath.slice(1).split("/").join(path.sep);

    if (!relative) {
        return rootDir;
    }

    return resolveSafePath(rootDir, relative, path.sep, path.resolve);
};

const hrefForEntry = (urlPath, name, isDirectory) => {
    const base = urlPath === "/" ? "" : urlPath;
    const href = `${base}/${name}${isDirectory ? "/" : ""}`.replace(/\/+/g, "/");
    return encodeURI(href);
};

export const renderDirectoryListing = (urlPath, entries, { showParent = false, parentHref = "../" } = {}) => {
    const sorted = [...entries].sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
            return left.isDirectory() ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
    });

    const rows = sorted.map((entry) => {
        const suffix = entry.isDirectory() ? "/" : "";
        const href = hrefForEntry(urlPath, entry.name, entry.isDirectory());
        return `<li><a href="${href}">${entry.name}${suffix}</a></li>`;
    });

    if (showParent) {
        rows.unshift(`<li><a href="${parentHref}">../</a></li>`);
    }

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Index of ${urlPath}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; }
      h1 { font-size: 1.1rem; font-weight: 600; }
      ul { list-style: none; padding: 0; }
      li { margin: 0.35rem 0; }
      a { text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1>Index of ${urlPath}</h1>
    <ul>
      ${rows.join("\n      ")}
    </ul>
  </body>
</html>
`;
};

export const createDirectoryPlayServer = (rootDir) =>
    http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url ?? "/", "http://localhost");
            const urlPath = normalizeUrlPath(url.pathname);
            const fsPath = urlPathToFsPath(rootDir, urlPath);
            const entryStat = await stat(fsPath);

            if (entryStat.isFile()) {
                const body = await readFile(fsPath);
                response.writeHead(200, {
                    "Content-Type": guessMimeType(path.basename(fsPath)),
                });
                response.end(body);
                return;
            }

            const indexName = await findDirectoryIndex(fsPath);
            const wantsDirectoryListing = url.searchParams.has("dir");

            if (indexName && !wantsDirectoryListing) {
                const body = await readFile(path.join(fsPath, indexName));
                response.writeHead(200, {
                    "Content-Type": guessMimeType(indexName),
                });
                response.end(body);
                return;
            }

            const entries = await readdir(fsPath, { withFileTypes: true });
            const parentHref = urlPath === "/"
                ? null
                : encodeURI(`${path.posix.dirname(urlPath) || ""}/`.replace(/\/+/g, "/"));
            const html = renderDirectoryListing(urlPath, entries, {
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
    });

export const startDirectoryPlayServer = async (rootDir) => {
    const server = createDirectoryPlayServer(rootDir);
    const indexName = await findDirectoryIndex(rootDir);

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}/`;

    return {
        server,
        baseUrl,
        indexName,
        mode: indexName ? "run" : "browse",
    };
};
