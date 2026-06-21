# Memory Extract

Embed files into a PNG image and open them back from the PNG alone

## Install

```bash
npm install -g memory-extract
```

## CLI

```bash
me pack [path] [filename] [options]
me unpack <png> [out-dir]
me play <png> [--foreground]
```

### `me pack`

Pack a file or directory into a memory PNG

```bash
me pack               # pack current directory → ./<folder-name>.png
me pack dist          # pack ./dist → ./dist.png
me pack dist App      # pack ./dist → ./App.png
```


| Argument   | Default            | Description                               |
| ---------- | ------------------ | ----------------------------------------- |
| `path`     | `.`                | File or directory to pack                 |
| `filename` | basename of `path` | Output PNG name (`.png` added if missing) |



| Flag             | Description                                  |
| ---------------- | -------------------------------------------- |
| `--cover <path>` | Cover image instead of the default blank PNG |
| `--out <path>`   | Output PNG path                              |


### `me unpack`

Extract the packed files from a memory PNG

```bash
me unpack dist.png
me unpack dist.png ./restored
```

### `me play`

Open a memory PNG in the browser

```bash
me play App.png
me play App.png --foreground
```

## Library

Browser exports

```js
import {
  extractMemory,
  listManifestFiles,
  readMemoryFile,
  createMemoryBlob,
} from "memory-extract";
```

Node helpers

```js
import { embedMemory, encodeMemoryPayload } from "memory-extract/node";
import { guessMimeType, encodeV2Archive } from "memory-extract/payload";
```

`createMemoryBlob()` is for in-browser launch via blob URLs and the CLI uses HTTP or `file://`
