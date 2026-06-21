export const INDEX_NAMES = ["index.html", "index.htm"];

export const isHtmlEntry = (filePath) =>
    filePath.endsWith(".html") || filePath.endsWith(".htm");

export const resolveMemoryPlayMode = (
    manifest,
    filePaths
) => {
    if (filePaths.length === 1) {
        return { mode: "file", path: filePaths[0] };
    }

    const indexEntry = filePaths.find(
        (filePath) =>
            filePath === "index.html" ||
            filePath.endsWith("/index.html") ||
            filePath === "index.htm" ||
            filePath.endsWith("/index.htm")
    );

    if (indexEntry) {
        return { mode: "play", entry: indexEntry };
    }

    if (filePaths.includes(manifest.entry) && isHtmlEntry(manifest.entry)) {
        return { mode: "play", entry: manifest.entry };
    }

    return { mode: "browse" };
};

const urlPathToPrefix = (urlPath) =>
    urlPath === "/" ? "" : urlPath.slice(1);

export const listVirtualEntries = (filePaths, urlPath = "/") => {
    const prefix = urlPathToPrefix(urlPath);
    const entries = new Map();

    for (const filePath of filePaths) {
        if (prefix && !filePath.startsWith(`${prefix}/`)) {
            continue;
        }

        const rest = prefix ? filePath.slice(prefix.length + 1) : filePath;
        if (!rest) {
            continue;
        }

        const slash = rest.indexOf("/");

        if (slash === -1) {
            entries.set(rest, { name: rest, isDirectory: false });
            continue;
        }

        entries.set(rest.slice(0, slash), {
            name: rest.slice(0, slash),
            isDirectory: true,
        });
    }

    return [...entries.values()];
};

export const collectVirtualDirectoryPaths = (filePaths) => {
    const dirs = new Set(["/"]);

    for (const filePath of filePaths) {
        const parts = filePath.split("/");

        for (let index = 1; index < parts.length; index += 1) {
            dirs.add(`/${parts.slice(0, index).join("/")}`);
        }
    }

    return [...dirs].sort(
        (left, right) => right.split("/").length - left.split("/").length
    );
};

export const parentVirtualPath = (urlPath) => {
    if (urlPath === "/") {
        return null;
    }

    const trimmed = urlPath.replace(/\/+$/, "");
    const slash = trimmed.lastIndexOf("/");
    return slash <= 0 ? "/" : trimmed.slice(0, slash);
};

export const buildBrowseListingDocument = (
    urlPath,
    entries,
    { showParent = false, parentHref = "../" } = {}
) => {
    const sorted = [...entries].sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
            return left.isDirectory ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
    });

    const rows = sorted.map((entry) => {
        const suffix = entry.isDirectory ? "/" : "";
        return `<li><a href="${entry.href}">${entry.name}${suffix}</a></li>`;
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

export const buildMemoryBrowseListings = (filePaths, fileUrlByPath) => {
    const listings = {};

    for (const urlPath of collectVirtualDirectoryPaths(filePaths)) {
        const prefix = urlPath === "/" ? "" : urlPath.slice(1);

        listings[urlPath] = listVirtualEntries(filePaths, urlPath).map((entry) => {
            const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isDirectory) {
                return {
                    name: entry.name,
                    isDirectory: true,
                    path: `/${fullPath}`.replace(/\/+/g, "/"),
                };
            }

            return {
                name: entry.name,
                isDirectory: false,
                href: fileUrlByPath.get(fullPath) ?? "#",
            };
        });
    }

    return listings;
};

export const buildInteractiveBrowseDocument = (listings, rootPath = "/") => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Index of ${rootPath}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; }
      h1 { font-size: 1.1rem; font-weight: 600; }
      ul { list-style: none; padding: 0; }
      li { margin: 0.35rem 0; }
      a { text-decoration: none; color: inherit; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1 id="title">Index of ${rootPath}</h1>
    <ul id="list"></ul>
    <script>
      const listings = ${JSON.stringify(listings)};
      const title = document.getElementById("title");
      const list = document.getElementById("list");

      const parentPath = (path) => {
        if (path === "/") return "/";
        const trimmed = path.replace(/\\/+$/, "");
        const slash = trimmed.lastIndexOf("/");
        return slash <= 0 ? "/" : trimmed.slice(0, slash);
      };

      const render = (path) => {
        const entries = listings[path] || [];
        title.textContent = "Index of " + path;
        list.replaceChildren();

        if (path !== "/") {
          const parentItem = document.createElement("li");
          const parentLink = document.createElement("a");
          parentLink.href = "#";
          parentLink.textContent = "../";
          parentLink.addEventListener("click", (event) => {
            event.preventDefault();
            render(parentPath(path));
          });
          parentItem.appendChild(parentLink);
          list.appendChild(parentItem);
        }

        entries
          .slice()
          .sort((left, right) => {
            if (left.isDirectory !== right.isDirectory) {
              return left.isDirectory ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
          })
          .forEach((entry) => {
            const item = document.createElement("li");
            const link = document.createElement("a");

            if (entry.isDirectory) {
              link.href = "#";
              link.textContent = entry.name + "/";
              link.addEventListener("click", (event) => {
                event.preventDefault();
                render(entry.path);
              });
            } else {
              link.href = entry.href;
              link.textContent = entry.name;
            }

            item.appendChild(link);
            list.appendChild(item);
          });
      };

      render(${JSON.stringify(rootPath)});
    </script>
  </body>
</html>
`;
