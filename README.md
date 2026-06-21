# Memory Extract

Embed files into a PNG image and open them back from the PNG alone

## Install

```bash
npm install memory-extract
```

## CLI

### `memory-pack [path] [filename]`

Pack a file or directory into a memory PNG

```bash
memory-pack               # pack current directory → ./<folder-name>.png
memory-pack dist          # pack ./dist → ./dist.png
memory-pack dist App      # pack ./dist → ./App.png
```


| Argument   | Default            | Description                               |
| ---------- | ------------------ | ----------------------------------------- |
| `path`     | `.`                | File or directory to pack                 |
| `filename` | basename of `path` | Output PNG name (`.png` added if missing) |



| Flag             | Description                                  |
| ---------------- | -------------------------------------------- |
| `--cover <path>` | Cover image instead of the default blank PNG |
| `--out <path>`   | Output PNG path                              |


### `memory-unpack <png> [out-dir]`

Extract the packed files from a memory PNG

```bash
memory-unpack dist.png
memory-unpack dist.png ./restored
```

### `memory-play <png>`

Open a memory PNG in the browser

```bash
memory-play App.png
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