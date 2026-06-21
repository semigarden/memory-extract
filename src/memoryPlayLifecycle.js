export const MEMORY_PLAY_PING_PATH = "/__memory_play_ping__";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const isMemoryPlayPingPath = (urlPath) =>
    urlPath === MEMORY_PLAY_PING_PATH;

export const buildMemoryPlayLifecycleScript = () => {
    const pingPath = `.${MEMORY_PLAY_PING_PATH}`;

    return `<script>(function () {
  var pingPath = ${JSON.stringify(pingPath)};
  function ping() {
    try {
      fetch(pingPath, { method: "POST", keepalive: true, cache: "no-store" });
    } catch (error) {}
  }
  ping();
  setInterval(ping, 15000);
})();</script>`;
};

export const injectMemoryPlayLifecycle = (html) => {
    const script = buildMemoryPlayLifecycleScript();

    if (html.includes("</head>")) {
        return html.replace("</head>", `${script}</head>`);
    }

    if (html.includes("<body")) {
        return html.replace(/<body([^>]*)>/i, `<body$1>${script}`);
    }

    return `${script}${html}`;
};

export const maybeInjectMemoryPlayLifecycle = (body, mimeType, injectLifecycle) => {
    if (!injectLifecycle || !mimeType.includes("text/html")) {
        return body;
    }

    const html = body instanceof Uint8Array ? textDecoder.decode(body) : String(body);
    return textEncoder.encode(injectMemoryPlayLifecycle(html));
};

export const createMemoryPlayIdleWatcher = ({
    idleMs = 45_000,
    pollMs = 5_000,
    onIdle,
}) => {
    let lastPing = Date.now();
    let stopped = false;

    const interval = setInterval(() => {
        if (stopped) {
            return;
        }

        if (Date.now() - lastPing >= idleMs) {
            stopped = true;
            clearInterval(interval);
            onIdle?.();
        }
    }, pollMs);

    return {
        touch: () => {
            lastPing = Date.now();
        },
        stop: () => {
            stopped = true;
            clearInterval(interval);
        },
    };
};
