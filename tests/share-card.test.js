import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(
  new URL("../scripts/share-card.js", import.meta.url),
  "utf8",
);

function createShareRuntime({ fetchImpl, clipboardWrite } = {}) {
  const objectUrls = new Map();
  let objectUrlIndex = 0;
  class FileReader {
    constructor() {
      this.listeners = new Map();
      this.result = null;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.listeners.get("load")?.();
      });
    }
  }
  class Image {
    set src(value) {
      this.currentSrc = value;
      queueMicrotask(() => this.onload?.());
    }
  }
  class ClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }
  const canvas = {
    getContext() {
      return {
        fillStyle: "",
        fillRect() {},
        drawImage() {},
      };
    },
    toBlob(callback) {
      callback(new Blob(["png-output"], { type: "image/png" }));
    },
  };
  const navigator = {
    clipboard: {
      write: clipboardWrite ?? (async () => {}),
    },
  };
  const context = vm.createContext({
    Blob,
    ClipboardItem,
    FileReader,
    Image,
    URL: {
      createObjectURL(blob) {
        const url = `blob:test-${++objectUrlIndex}`;
        objectUrls.set(url, blob);
        return url;
      },
      revokeObjectURL(url) {
        objectUrls.delete(url);
      },
    },
    AbortController,
    clearTimeout,
    console,
    document: {
      addEventListener() {},
      body: { append() {} },
      createElement(name) {
        return name === "canvas" ? canvas : {};
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    fetch: fetchImpl ?? fetch,
    localStorage: {
      getItem() {
        return null;
      },
    },
    navigator,
    queueMicrotask,
    setTimeout,
    window: {
      addEventListener() {},
    },
  });
  vm.runInContext(source, context);
  return {
    ClipboardItem,
    api: context.window.MyAnimeLifeShare,
    objectUrls,
  };
}

test("inlines remote covers before rasterizing a share image", async () => {
  const remoteCover = "https://i0.hdslb.com/cover.png";
  const runtime = createShareRuntime({
    fetchImpl: async (url) => {
      assert.equal(url, remoteCover);
      return {
        ok: true,
        blob: async () => new Blob(["cover"], { type: "image/png" }),
      };
    },
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${remoteCover}" xlink:href="${remoteCover}" width="10" height="10" /></svg>`;

  const image = await runtime.api.createImage(svg, 10, 10);
  const exportedSvg = await image.svg.text();

  assert.equal(image.png.type, "image/png");
  assert.doesNotMatch(exportedSvg, /i0\.hdslb\.com/u);
  assert.equal(
    exportedSvg.match(/data:image\/png;base64,Y292ZXI=/gu)?.length,
    2,
  );
});

test("normalizes clipboard images to PNG before writing", async () => {
  let written = null;
  const runtime = createShareRuntime({
    clipboardWrite: async (items) => {
      written = items;
    },
  });

  await runtime.api.copyImage(
    new Blob(["image"], { type: "application/octet-stream" }),
  );

  assert.equal(written.length, 1);
  assert.ok(written[0] instanceof runtime.ClipboardItem);
  assert.equal(written[0].items["image/png"].type, "image/png");
});
