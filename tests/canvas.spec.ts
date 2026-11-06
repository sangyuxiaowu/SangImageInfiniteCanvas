import { expect, test, Page } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-seeded")) return;
    const defaults = {
      prompt: "", status: "idle", aspectRatio: "1:1", model: "none", createdAt: 1,
    };
    const project = {
      id: "test-project", name: "Interaction test", panX: 50, panY: 50, zoom: 1, updatedAt: 1,
      nodes: [
        { ...defaults, id: "text", type: "text", x: 20, y: 80, width: 300, height: 240, text: "Reference prompt" },
        { ...defaults, id: "generator", type: "generator", x: 700, y: 80, width: 450, height: 480 },
        ...Array.from({ length: 60 }, (_, index) => ({
          ...defaults, id: `extra-${index}`, type: "text", x: 2000 + index * 350, y: 100,
          width: 300, height: 240, text: `Offscreen ${index}`,
        })),
      ],
      connections: [{ id: "wire", fromId: "text", toId: "generator" }],
    };
    localStorage.setItem("gpt_image_projects", JSON.stringify([project]));
    localStorage.setItem("gpt_image_current_project_id", project.id);
    localStorage.setItem("test-seeded", "true");
  });
  await page.goto("/");
  await expect(page.locator("#canvas-node-text")).toBeVisible();
}

async function paste(page: Page, target: string, text: string, imageCount = 0, itemsOnly = false) {
  return page.evaluate(async ({ target, text, imageCount, itemsOnly }) => {
    const data = new DataTransfer();
    if (text) data.setData("text/plain", text);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    for (let index = 0; index < imageCount; index++) {
      data.items.add(new File([blob], `clipboard-${index}.png`, { type: "image/png" }));
    }
    if (itemsOnly) Object.defineProperty(data, "files", { value: [] });
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector(target)!.dispatchEvent(event);
    return event.defaultPrevented;
  }, { target, text, imageCount, itemsOnly });
}

test("connected ports stay aligned on every drag frame, pan, zoom and resize", async ({ page }) => {
  await openCanvas(page);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.evaluate(() => {
    const samples: number[] = [];
    Object.assign(window, { alignmentSamples: samples, sampleAlignment: true });
    const sample = () => {
      const state = window as unknown as { sampleAlignment: boolean };
      if (!state.sampleAlignment) return;
      const source = document.getElementById("canvas-node-text")!.getBoundingClientRect();
      const target = document.getElementById("canvas-node-generator")!.getBoundingClientRect();
      const path = document.querySelector<SVGPathElement>("svg path[stroke='url(#wireGradient)']")!;
      const matrix = path.getScreenCTM()!;
      const start = path.getPointAtLength(0).matrixTransform(matrix);
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      samples.push(Math.max(
        Math.abs(start.x - source.right), Math.abs(start.y - (source.top + source.height / 2)),
        Math.abs(end.x - target.left), Math.abs(end.y - (target.top + target.height / 2)),
      ));
      requestAnimationFrame(() => setTimeout(sample, 0));
    };
    requestAnimationFrame(() => setTimeout(sample, 0));
  });
  for (const id of ["text", "generator"]) {
    const box = await page.locator(`#canvas-node-${id} > div`).first().boundingBox();
    await page.mouse.move(box!.x + 80, box!.y + 15);
    await page.mouse.down();
    await page.mouse.move(box!.x + 180, box!.y + 90, { steps: 12 });
    await page.mouse.up();
  }
  await page.mouse.move(600, 800);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(650, 830, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  await page.locator("#canvas-node-generator").evaluate((element) => { element.style.minHeight = "750px"; });
  await page.waitForTimeout(100);
  const samples = await page.evaluate(() => {
    const state = window as unknown as { alignmentSamples: number[]; sampleAlignment: boolean };
    state.sampleAlignment = false;
    return state.alignmentSamples;
  });
  expect(samples.length).toBeGreaterThan(10);
  expect(Math.max(...samples)).toBeLessThan(1.1);
  expect(errors).toEqual([]);
});

test("bursty movement is coalesced, final mouseup is saved and pagehide flushes", async ({ page }) => {
  await openCanvas(page);
  await page.waitForTimeout(350);
  const result = await page.evaluate(async () => {
    const node = document.getElementById("canvas-node-text")!;
    const header = node.firstElementChild!;
    const box = header.getBoundingClientRect();
    let writes = 0;
    let positionChanges = 0;
    let layoutReads = 0;
    const setItem = Storage.prototype.setItem;
    const getRect = Element.prototype.getBoundingClientRect;
    Storage.prototype.setItem = function (key, value) {
      if (key === "gpt_image_projects") writes++;
      return setItem.call(this, key, value);
    };
    Element.prototype.getBoundingClientRect = function () {
      if (this.id.startsWith("canvas-node-")) layoutReads++;
      return getRect.call(this);
    };
    const observer = new MutationObserver((records) => { positionChanges += records.length; });
    observer.observe(node, { attributes: true, attributeFilter: ["style"] });
    header.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: box.x + 80, clientY: box.y + 15 }));
    for (let i = 1; i <= 100; i++) {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: box.x + 80 + i, clientY: box.y + 15 + i }));
    }
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const writesDuringDrag = writes;
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: box.x + 200, clientY: box.y + 145 }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    const saved = JSON.parse(localStorage.getItem("gpt_image_projects")!)[0].nodes[0];
    observer.disconnect();
    Storage.prototype.setItem = setItem;
    Element.prototype.getBoundingClientRect = getRect;
    return { positionChanges, writesDuringDrag, writes, layoutReads, x: saved.x, y: saved.y };
  });
  expect(result).toEqual({
    positionChanges: 2, writesDuringDrag: 0, writes: 1, layoutReads: 0, x: 140, y: 210,
  });
  await page.reload();
  await expect(page.locator("#canvas-node-text")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 140, 210)");
});

test("paste works after toolbar focus and preserves text formatting", async ({ page }) => {
  await openCanvas(page);
  await page.locator("#btn-tool-select").focus();
  expect(await paste(page, "#btn-tool-select", "  indented\nsecond line\n")).toBe(true);
  await expect(page.locator("[id^='canvas-node-'] textarea").filter({ hasText: "indented" })).toHaveValue("  indented\nsecond line\n");
  await page.locator("#canvas-node-text textarea").focus();
  expect(await paste(page, "#canvas-node-text textarea", "native input")).toBe(false);
  await expect(page.locator("[id^='canvas-node-']")).toHaveCount(63);
});

test("image paste supports multiple files, items fallback and durable asset restoration", async ({ page }) => {
  await openCanvas(page);
  expect(await paste(page, "body", "image caption", 2)).toBe(true);
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(2);
  expect(await paste(page, "body", "", 1, true)).toBe(true);
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(3);
  await expect(page.locator("[id^='canvas-node-']")).toHaveCount(65);
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.locator("[id^='canvas-node-node-img-'] img")).toHaveCount(3);
  await expect.poll(() => page.locator("[id^='canvas-node-node-img-'] img").evaluateAll(
    (images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
  )).toBe(true);
});

test("image storage failure is reported rather than silently dropping the paste", async ({ page }) => {
  await openCanvas(page);
  await page.evaluate(() => {
    indexedDB.open = () => { throw new Error("Storage unavailable"); };
  });
  const dialog = page.waitForEvent("dialog");
  const pasting = paste(page, "body", "", 1);
  const alert = await dialog;
  expect(alert.message()).toContain("Storage unavailable");
  await alert.accept();
  await pasting;
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(0);
  const logs = await page.evaluate(() => localStorage.getItem("gpt_image_operation_logs"));
  expect(logs).toContain("粘贴图片失败");
});

test("native clipboard text and image paste work while toolbar has focus", async ({ page, context }) => {
  await openCanvas(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("Native clipboard text"));
  await page.locator("#btn-tool-pan").click();
  await page.keyboard.press("Control+v");
  await expect(page.locator("textarea").filter({ hasText: "Native clipboard text" })).toHaveCount(1);
  await expect(page.locator("#btn-tool-pan")).toHaveClass(/bg-indigo-600/);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await page.keyboard.press("Control+v");
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(1);
});

test("aborted asset transactions do not create broken image nodes", async ({ page }) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
  });
  const dialog = page.waitForEvent("dialog");
  const pasting = paste(page, "body", "", 1);
  const alert = await dialog;
  expect(alert.message()).toContain("粘贴图片失败");
  await alert.accept();
  await pasting;
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(0);
});

test("rapid project navigation keeps edits without waiting for the storage debounce", async ({ page }) => {
  await openCanvas(page);
  await page.locator("#canvas-node-text textarea").fill("Unsaved navigation edit");
  await page.locator("[title='点击 打开/关闭画布列表']").click();
  await page.getByRole("button", { name: "主页", exact: true }).click();
  await page.getByText("Interaction test", { exact: true }).click();
  await expect(page.locator("#canvas-node-text textarea")).toHaveValue("Unsaved navigation edit");
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.locator("#canvas-node-text textarea")).toHaveValue("Unsaved navigation edit");
});

test("canvas paste ignores editable descendants and non-canvas pages", async ({ page }) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const editable = document.createElement("div");
    editable.contentEditable = "plaintext-only";
    editable.innerHTML = "<span id='editable-child'>Editor</span>";
    document.body.append(editable);
  });
  expect(await paste(page, "#editable-child", "keep native editing")).toBe(false);
  await page.locator("[title='点击 打开/关闭画布列表']").click();
  await page.getByRole("button", { name: "主页", exact: true }).click();
  expect(await paste(page, "body", "not a canvas node")).toBe(false);
});

test("paste finishing after a project switch does not insert into another canvas", async ({ page }) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      request.addEventListener("success", () => {
        const success = request.onsuccess;
        request.onsuccess = null;
        setTimeout(() => success?.call(request, new Event("success")), 500);
      });
      return request;
    };
  });
  await paste(page, "body", "", 1);
  await page.locator("[title='点击 打开/关闭画布列表']").click();
  await page.getByRole("button", { name: "主页", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByText("Interaction test", { exact: true }).click();
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(0);
});
