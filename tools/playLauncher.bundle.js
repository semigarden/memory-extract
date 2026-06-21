var MemoryExtract = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    MAX_PAYLOAD_SIZE: () => MAX_PAYLOAD_SIZE,
    MEMORY_CHUNK_TYPE: () => MEMORY_CHUNK_TYPE,
    MEMORY_MAGIC: () => MEMORY_MAGIC,
    MEMORY_VERSION: () => MEMORY_VERSION,
    SUPPORTED_VERSIONS: () => SUPPORTED_VERSIONS,
    assertSupportedVersion: () => assertSupportedVersion,
    buildV2Manifest: () => buildV2Manifest,
    createMemoryBlob: () => createMemoryBlob,
    decodeManifest: () => decodeManifest,
    decodeManifestFile: () => decodeManifestFile,
    decodeMemoryPayload: () => decodeMemoryPayload,
    decodeV2Archive: () => decodeV2Archive,
    encodeV2Archive: () => encodeV2Archive,
    extractMemory: () => extractMemory,
    guessMimeType: () => guessMimeType,
    listManifestFiles: () => listManifestFiles,
    readManifestFile: () => readManifestFile,
    readMemoryFile: () => readMemoryFile,
    resolveLaunchAssetUrl: () => resolveLaunchAssetUrl,
    resolveSafePath: () => resolveSafePath
  });

  // src/payloadFormat.js
  var MEMORY_VERSION = 2;
  var SUPPORTED_VERSIONS = [1, 2];
  var MAX_PAYLOAD_SIZE = 64 * 1024 * 1024;
  var readUint32BE = (view, offset) => view[offset] << 24 | view[offset + 1] << 16 | view[offset + 2] << 8 | view[offset + 3];
  var writeUint32BE = (view, offset, value) => {
    view[offset] = value >>> 24 & 255;
    view[offset + 1] = value >>> 16 & 255;
    view[offset + 2] = value >>> 8 & 255;
    view[offset + 3] = value & 255;
  };
  var assertSupportedVersion = (version) => {
    if (!SUPPORTED_VERSIONS.includes(version)) {
      throw new Error(`Unsupported memory version: ${version}`);
    }
  };
  var guessMimeType = (filePath) => {
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
  var listManifestFiles = (manifest) => {
    if (Array.isArray(manifest.files)) {
      return manifest.files.map((file) => file.path);
    }
    return Object.keys(manifest.files ?? {});
  };
  var readManifestFile = (manifest, filePath, fileBytes = null, decodeV1File = null) => {
    if (fileBytes?.[filePath]) {
      return fileBytes[filePath];
    }
    const record = manifest.files?.[filePath];
    if (record && decodeV1File) {
      return decodeV1File(record);
    }
    throw new Error(`Manifest file not found: ${filePath}`);
  };
  var concatBytes = (parts) => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  };
  var toUint8Array = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);
  var buildV2Manifest = ({
    name,
    entry,
    files,
    kind = "web-app",
    runtime = "iframe-sandbox",
    source = ""
  }) => {
    const sortedPaths = Object.keys(files).sort();
    return {
      manifest: {
        v: 2,
        kind,
        name,
        entry,
        runtime,
        ...source ? { source } : {},
        files: sortedPaths.map((filePath) => {
          const bytes = toUint8Array(files[filePath]);
          return {
            path: filePath,
            mime: guessMimeType(filePath),
            size: bytes.length
          };
        })
      },
      sortedPaths
    };
  };
  var encodeV2Archive = ({ name, entry, files, kind, runtime, source }) => {
    const { manifest, sortedPaths } = buildV2Manifest({
      name,
      entry,
      files,
      kind,
      runtime,
      source
    });
    const json = new TextEncoder().encode(JSON.stringify(manifest));
    const header = new Uint8Array(4);
    writeUint32BE(header, 0, json.length);
    return concatBytes([
      header,
      json,
      ...sortedPaths.map((filePath) => toUint8Array(files[filePath]))
    ]);
  };
  var decodeV2Archive = (decompressed) => {
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
  var resolveSafePath = (outDir, filePath, pathSep, pathResolve) => {
    const resolvedOutDir = pathResolve(outDir);
    const target = pathResolve(resolvedOutDir, filePath);
    const prefix = resolvedOutDir.endsWith(pathSep) ? resolvedOutDir : `${resolvedOutDir}${pathSep}`;
    if (target !== resolvedOutDir && !target.startsWith(prefix)) {
      throw new Error(`Unsafe path in manifest: ${filePath}`);
    }
    return target;
  };

  // src/memoryFormat.js
  var MEMORY_MAGIC = new Uint8Array([87, 76, 70, 67]);
  var MEMORY_CHUNK_TYPE = new Uint8Array([119, 76, 70, 67]);
  var PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  var textDecoder = new TextDecoder();
  var bytesMatch = (view, offset, magic) => {
    if (offset < 0 || offset + magic.length > view.length) return false;
    for (let index = 0; index < magic.length; index += 1) {
      if (view[offset + index] !== magic[index]) return false;
    }
    return true;
  };
  var readUint32BE2 = (view, offset) => view[offset] << 24 | view[offset + 1] << 16 | view[offset + 2] << 8 | view[offset + 3];
  var parsePngChunks = (view) => {
    if (view.length < 8 || !bytesMatch(view, 0, PNG_SIGNATURE)) {
      throw new Error("Invalid PNG signature.");
    }
    const chunks = [];
    let offset = 8;
    while (offset + 12 <= view.length) {
      const length = readUint32BE2(view, offset);
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
        end: dataEnd + 4
      });
      offset = dataEnd + 4;
      if (chunks[chunks.length - 1].type === "IEND") {
        break;
      }
    }
    return { view, chunks, trailing: view.slice(offset) };
  };
  var readMemoryPayload = (chunkData) => {
    if (chunkData.length < 8 || !bytesMatch(chunkData, 0, MEMORY_MAGIC)) {
      throw new Error("Memory chunk magic mismatch.");
    }
    const version = readUint32BE2(chunkData, 4);
    assertSupportedVersion(version);
    const payload = chunkData.slice(8);
    if (payload.length > MAX_PAYLOAD_SIZE) {
      throw new Error(`Memory payload exceeds ${MAX_PAYLOAD_SIZE} bytes.`);
    }
    return { version, payload };
  };
  var gunzip = async (payload) => {
    const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  };
  var decodeManifest = async (payload) => {
    const decompressed = await gunzip(payload);
    return JSON.parse(textDecoder.decode(decompressed));
  };
  var decodeMemoryPayload = async (payload, version) => {
    assertSupportedVersion(version);
    if (version === 1) {
      return {
        manifest: await decodeManifest(payload),
        fileBytes: null
      };
    }
    return decodeV2Archive(await gunzip(payload));
  };
  var extractLegacyFooter = async (view) => {
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
    const version = readUint32BE2(view, magicIndex + 4);
    const payloadLength = readUint32BE2(view, magicIndex + 8);
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
      version
    };
  };
  var decodeExtractedMemory = async (png, payload, version) => {
    const decoded = await decodeMemoryPayload(payload, version);
    return {
      png,
      payload,
      ...decoded,
      version
    };
  };
  var extractMemory = async (input) => {
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
  var decodeManifestFile = (fileRecord) => {
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
  var readMemoryFile = (manifest, filePath, fileBytes = null) => readManifestFile(manifest, filePath, fileBytes, decodeManifestFile);

  // src/memoryPlay.js
  var isHtmlEntry = (filePath) => filePath.endsWith(".html") || filePath.endsWith(".htm");
  var resolveMemoryPlayMode = (manifest, filePaths) => {
    if (filePaths.length === 1) {
      return { mode: "file", path: filePaths[0] };
    }
    const indexEntry = filePaths.find(
      (filePath) => filePath === "index.html" || filePath.endsWith("/index.html") || filePath === "index.htm" || filePath.endsWith("/index.htm")
    );
    if (indexEntry) {
      return { mode: "play", entry: indexEntry };
    }
    if (filePaths.includes(manifest.entry) && isHtmlEntry(manifest.entry)) {
      return { mode: "play", entry: manifest.entry };
    }
    return { mode: "browse" };
  };
  var urlPathToPrefix = (urlPath) => urlPath === "/" ? "" : urlPath.slice(1);
  var listVirtualEntries = (filePaths, urlPath = "/") => {
    const prefix = urlPathToPrefix(urlPath);
    const entries = /* @__PURE__ */ new Map();
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
        isDirectory: true
      });
    }
    return [...entries.values()];
  };
  var collectVirtualDirectoryPaths = (filePaths) => {
    const dirs = /* @__PURE__ */ new Set(["/"]);
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
  var buildMemoryBrowseListings = (filePaths, fileUrlByPath) => {
    const listings = {};
    for (const urlPath of collectVirtualDirectoryPaths(filePaths)) {
      const prefix = urlPath === "/" ? "" : urlPath.slice(1);
      listings[urlPath] = listVirtualEntries(filePaths, urlPath).map((entry) => {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          return {
            name: entry.name,
            isDirectory: true,
            path: `/${fullPath}`.replace(/\/+/g, "/")
          };
        }
        return {
          name: entry.name,
          isDirectory: false,
          href: fileUrlByPath.get(fullPath) ?? "#"
        };
      });
    }
    return listings;
  };
  var buildInteractiveBrowseDocument = (listings, rootPath = "/") => `<!DOCTYPE html>
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
    <\/script>
  </body>
</html>
`;

  // src/loadMemory.js
  var textDecoder2 = new TextDecoder();
  var REWRITABLE_ATTRIBUTES = [
    ["script", "src"],
    ["link", "href"],
    ["img", "src"],
    ["source", "src"],
    ["video", "src"],
    ["audio", "src"],
    ["image", "href"]
  ];
  var CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  var readInput = async (input) => {
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
  var normalizeAssetPath = (value) => value.replace(/^\.\//, "");
  var stripLeadingSlash = (value) => value.startsWith("/") ? value.slice(1) : value;
  var guessMimeType2 = (filePath, record) => {
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
  var resolveAssetUrl = (rawPath, urlByPath) => {
    if (!rawPath) return null;
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(rawPath)) return null;
    const normalized = normalizeAssetPath(rawPath);
    return urlByPath.get(normalized) ?? urlByPath.get(rawPath) ?? null;
  };
  var resolveManifestPath = (basePath, rawPath, manifestPaths) => {
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
  var extractCssAssetPaths = (cssText) => {
    const paths = [];
    for (const match of cssText.matchAll(CSS_URL_PATTERN)) {
      paths.push(match[2]);
    }
    return paths;
  };
  var collectRequiredFiles = (manifest, fileBytes, entryPath) => {
    const manifestPaths = listManifestFiles(manifest);
    const required = /* @__PURE__ */ new Set([entryPath]);
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
        const text = textDecoder2.decode(bytes);
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
  var BLOB_LAUNCH_BASE = "http://localhost/";
  var injectBlobLaunchShim = (doc) => {
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
  var resolveLaunchAssetUrl = (rawPath, urlByPath, entryPath, manifestPaths) => {
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
  var buildLaunchDocument = (html, urlByPath, entryPath, manifestPaths) => {
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
    return `<!DOCTYPE html>
${doc.documentElement.outerHTML}`;
  };
  var getManifestFileMeta = (manifest, filePath) => {
    if (Array.isArray(manifest.files)) {
      return manifest.files.find((file) => file.path === filePath) ?? null;
    }
    return manifest.files?.[filePath] ?? null;
  };
  var attachBlobDispose = (blob, blobUrls) => {
    blob.dispose = () => {
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    return blob;
  };
  var createFileLaunchBlob = (manifest, fileBytes, filePath, blobUrls) => {
    const fileMeta = getManifestFileMeta(manifest, filePath);
    const fileContent = readMemoryFile(manifest, filePath, fileBytes);
    const mime = guessMimeType2(filePath, fileMeta);
    const launchBlob = new Blob([fileContent], { type: mime });
    return attachBlobDispose(launchBlob, blobUrls);
  };
  var createBrowseLaunchBlob = (manifest, fileBytes, filePaths, blobUrls) => {
    const fileUrlByPath = /* @__PURE__ */ new Map();
    for (const filePath of filePaths) {
      const fileMeta = getManifestFileMeta(manifest, filePath);
      const fileContent = readMemoryFile(manifest, filePath, fileBytes);
      const mime = guessMimeType2(filePath, fileMeta);
      const assetUrl = URL.createObjectURL(new Blob([fileContent], { type: mime }));
      blobUrls.push(assetUrl);
      fileUrlByPath.set(filePath, assetUrl);
    }
    const listings = buildMemoryBrowseListings(filePaths, fileUrlByPath);
    const launchDocument = buildInteractiveBrowseDocument(listings);
    const launchBlob = new Blob([launchDocument], { type: "text/html" });
    return attachBlobDispose(launchBlob, blobUrls);
  };
  var createPlayLaunchBlob = (manifest, fileBytes, entryPath, blobUrls) => {
    const urlByPath = /* @__PURE__ */ new Map();
    const requiredFiles = collectRequiredFiles(manifest, fileBytes, entryPath);
    for (const filePath of requiredFiles) {
      const fileMeta = getManifestFileMeta(manifest, filePath);
      const fileContent = readMemoryFile(manifest, filePath, fileBytes);
      const mime = guessMimeType2(filePath, fileMeta);
      const assetUrl = URL.createObjectURL(new Blob([fileContent], { type: mime }));
      blobUrls.push(assetUrl);
      urlByPath.set(filePath, assetUrl);
      urlByPath.set(normalizeAssetPath(filePath), assetUrl);
    }
    if (!requiredFiles.has(entryPath)) {
      throw new Error(`Manifest entry not found: ${entryPath}`);
    }
    const htmlBytes = readMemoryFile(manifest, entryPath, fileBytes);
    const html = textDecoder2.decode(htmlBytes);
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
  var createMemoryBlob = async (input) => {
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
  return __toCommonJS(index_exports);
})();
