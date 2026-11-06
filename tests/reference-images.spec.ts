import { expect, test, Page, Route } from "@playwright/test";

type Reference = { id: string; color?: string; url?: string; assetId?: string; selectedColors?: string[]; selectedIndex?: number };

async function openCanvas(page: Page, references: Reference[], connected = true, withEditor = false) {
  await page.addInitScript(({ references, connected, withEditor }) => {
    if (localStorage.getItem("reference-test-seeded")) return;
    const makeImage = (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 3;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, 3, 3);
      return canvas.toDataURL("image/png");
    };
    const defaults = { prompt: "", status: "idle", aspectRatio: "1:1", model: "test-model", createdAt: 1 };
    const nodes = [
      { ...defaults, id: "generator", type: "generator", x: 650, y: 80, width: 450, height: 480, prompt: "combine references", endpointId: "test" },
      ...references.map((reference, index) => {
        const images = reference.selectedColors?.map(makeImage);
        return {
          ...defaults, id: reference.id, type: "image", x: 50 + index * 190, y: 100 + index * 275,
          width: 170, height: 220, isStandaloneImage: true,
          imageUrl: images?.[reference.selectedIndex || 0] || reference.url || (reference.color && makeImage(reference.color)),
          imageUrls: images,
          assetId: reference.assetId,
        };
      }),
      ...(withEditor ? [{
        ...defaults, id: "editor", type: "editor", x: 900, y: 550, width: 400, height: 480,
      }] : []),
    ];
    const connections = connected ? references.map((reference, index) => ({
      id: `connection-${index}`, fromId: reference.id, toId: "generator",
    })) : [];
    localStorage.setItem("gpt_image_projects", JSON.stringify([{
      id: "reference-project", name: "Reference test", nodes, connections, panX: 0, panY: 0, zoom: 1, updatedAt: 1,
    }]));
    localStorage.setItem("gpt_image_current_project_id", "reference-project");
    localStorage.setItem("gpt_image_config", JSON.stringify({
      endpoints: [{ id: "test", name: "Test", apiKey: "test-key", baseUrl: "https://example.test/v1", models: ["test-model"] }],
      defaultEndpointId: "test",
    }));
    localStorage.setItem("reference-test-seeded", "true");
  }, { references, connected, withEditor });
  await page.goto("/");
  await expect(page.locator("#canvas-node-generator")).toBeVisible();
}

async function connect(page: Page, id: string, targetTitle = "连接到生图节点") {
  const source = page.locator(`#canvas-node-${id} button[title^='拉出连线']`);
  const start = await source.boundingBox();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  const target = page.getByTitle(targetTitle);
  await expect(target).toBeVisible();
  const end = await target.boundingBox();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 4 });
  await page.mouse.up();
}

function multipartParts(route: Route) {
  const contentType = route.request().headers()["content-type"];
  const boundary = contentType.match(/boundary=(.+)$/)![1];
  const body = route.request().postDataBuffer()!.toString("latin1");
  return body.split(`--${boundary}`).slice(1, -1).map((part) => {
    const [headers, ...content] = part.slice(2, -2).split("\r\n\r\n");
    return {
      name: headers.match(/name="([^"]+)"/)![1],
      filename: headers.match(/filename="([^"]+)"/)?.[1],
      content: Buffer.from(content.join("\r\n\r\n"), "latin1"),
    };
  });
}

const responseImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aN8AAAAASUVORK5CYII=";

test("multiple real connections send every selected reference in connection order", async ({ page }) => {
  await openCanvas(page, [
    { id: "red", color: "red" },
    { id: "blue", selectedColors: ["green", "blue"], selectedIndex: 1 },
  ], false);
  await connect(page, "blue");
  await connect(page, "red");
  const generator = page.locator("#canvas-node-generator");
  await expect(generator.getByText("连线参考图 (2 张)")).toBeVisible();
  await expect(generator.locator("img[alt^='参考图']")).toHaveCount(2);
  const expected = await page.evaluate(() => ["blue", "red"].map((id) => {
    const img = document.querySelector<HTMLImageElement>(`#canvas-node-${id} img[alt='Result Image']`)!;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  let parts: ReturnType<typeof multipartParts> = [];
  await page.route("https://example.test/v1/images/edits", async (route) => {
    parts = multipartParts(route);
    await route.fulfill({ json: { data: [{ b64_json: responseImage }] } });
  });
  await generator.getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await expect(page.locator("[id^='canvas-node-node-output-']")).toHaveCount(1);
  const images = parts.filter((part) => part.filename);
  expect(images.map(({ name, filename }) => [name, filename])).toEqual([
    ["image[]", "reference-1.png"], ["image[]", "reference-2.png"],
  ]);
  expect(images.map((part) => part.content.toString("base64"))).toEqual(expected);
  expect(Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.content.toString()])))
    .toMatchObject({ prompt: "combine references", model: "test-model", size: "1024x1024", n: "1", output_format: "png" });
});

test("one reference keeps the existing image field and no reference uses JSON generations", async ({ page }) => {
  await openCanvas(page, [{ id: "red", color: "red" }]);
  const generator = page.locator("#canvas-node-generator");
  let imageFields: string[] = [];
  await page.route("https://example.test/v1/images/edits", async (route) => {
    imageFields = multipartParts(route).filter((part) => part.filename).map((part) => part.name);
    await route.fulfill({ json: { data: [{ b64_json: responseImage }] } });
  });
  await generator.getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await expect(page.locator("[id^='canvas-node-node-output-']")).toHaveCount(1);
  expect(imageFields).toEqual(["image"]);
  await page.locator("#canvas-node-red button[title='删除图片']").click();
  await expect(generator.getByText("连线参考图 (0 张)")).toBeVisible();
  let json: { prompt: string } | undefined;
  await page.route("https://example.test/v1/images/generations", async (route) => {
    json = route.request().postDataJSON();
    await route.fulfill({ json: { data: [{ b64_json: responseImage }] } });
  });
  await generator.getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await expect(page.locator("[id^='canvas-node-node-output-']")).toHaveCount(2);
  expect(json?.prompt).toBe("combine references");
});

test("missing references fail visibly without sending a partial request and can be retried", async ({ page }) => {
  await openCanvas(page, [{ id: "red", color: "red" }, { id: "missing", assetId: "missing-asset" }]);
  let requests = 0;
  await page.route("https://example.test/v1/images/**", async (route) => {
    requests++;
    await route.fulfill({ json: { data: [{ b64_json: responseImage }] } });
  });
  const generator = page.locator("#canvas-node-generator");
  await generator.getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await expect(generator.getByText("参考图 2 准备失败", { exact: false })).toBeVisible();
  expect(requests).toBe(0);
  await generator.getByRole("button", { name: "重新尝试" }).click();
  await expect(generator.getByText("参考图 2 准备失败", { exact: false })).toBeVisible();
  expect(requests).toBe(0);
  await page.locator("#canvas-node-missing button[title='删除图片']").click();
  await generator.getByRole("button", { name: "重新尝试" }).click();
  await expect(page.locator("[id^='canvas-node-node-output-']")).toHaveCount(1);
  expect(requests).toBe(1);
});

test("selected image in a multi-image asset remains the reference after reload", async ({ page }) => {
  await openCanvas(page, []);
  await page.evaluate(async () => {
    const makeBlob = async (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 3;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, 3, 3);
      return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    };
    const assets = await Promise.all(["green", "blue"].map(makeBlob));
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gpt-image-canvas", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("assets", { keyPath: "id" });
        request.result.createObjectStore("masks", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("assets", "readwrite");
      assets.forEach((blob, index) => transaction.objectStore("assets").put({ id: `stored-${index}`, blob, createdAt: 1 }));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    const projects = JSON.parse(localStorage.getItem("gpt_image_projects")!);
    projects[0].nodes.push({
      id: "stored", type: "image", x: 50, y: 80, width: 250, height: 300, prompt: "", status: "idle",
      aspectRatio: "1:1", model: "none", createdAt: 1, assetId: "stored-0", assetIds: ["stored-0", "stored-1"],
    });
    projects[0].connections.push({ id: "stored-connection", fromId: "stored", toId: "generator" });
    localStorage.setItem("gpt_image_projects", JSON.stringify(projects));
  });
  await page.reload();
  const image = page.locator("#canvas-node-stored");
  await expect(image.getByAltText("Edited result 2")).toBeVisible();
  await image.getByAltText("Edited result 2").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gpt_image_projects")!)[0]
    .nodes.find((node: { id: string }) => node.id === "stored").assetId)).toBe("stored-1");
  await page.reload();
  await expect(page.locator("#canvas-node-stored img[alt='Result Image']")).toBeVisible();
  const selectedPixel = await page.locator("#canvas-node-stored img[alt='Result Image']").evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 3;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
  expect(selectedPixel).toEqual([0, 0, 255, 255]);
  await page.route("https://example.test/v1/images/edits", async (route) => {
    const images = multipartParts(route).filter((part) => part.filename);
    expect(images).toHaveLength(1);
    await route.fulfill({ json: { data: [{ b64_json: responseImage }] } });
  });
  await page.locator("#canvas-node-generator").getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await expect(page.locator("[id^='canvas-node-node-output-']")).toHaveCount(1);
});

test("canvas conversion errors surface rather than leaving generation pending", async ({ page }) => {
  await openCanvas(page, [{ id: "red", color: "red" }]);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException("Canvas is tainted", "SecurityError"); };
  });
  let requests = 0;
  await page.route("https://example.test/v1/images/**", async (route) => { requests++; await route.abort(); });
  const generator = page.locator("#canvas-node-generator");
  await generator.getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await expect(generator.getByText("参考图 1 准备失败：Canvas is tainted", { exact: false })).toBeVisible();
  expect(requests).toBe(0);
});

test("cancel during reference preparation never sends a request or reports a late failure", async ({ page }) => {
  let release: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("https://example.test/slow.png", async (route) => {
    await hold;
    await route.fulfill({ status: 404 });
  });
  await openCanvas(page, [{ id: "slow", url: "https://example.test/slow.png" }]);
  let requests = 0;
  await page.route("https://example.test/v1/images/**", async (route) => { requests++; await route.abort(); });
  const generator = page.locator("#canvas-node-generator");
  await generator.getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await generator.getByRole("button", { name: "取消生成" }).click();
  release!();
  await expect(generator.getByText("连线参考图 (1 张)")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(generator.getByText("生成失败")).toHaveCount(0);
  expect(requests).toBe(0);
});

test("upstream multi-image rejection is shown without silently retrying with fewer inputs", async ({ page }) => {
  await openCanvas(page, [{ id: "red", color: "red" }, { id: "blue", color: "blue" }]);
  let requests = 0;
  await page.route("https://example.test/v1/images/edits", async (route) => {
    requests++;
    expect(multipartParts(route).filter((part) => part.name === "image[]")).toHaveLength(2);
    await route.fulfill({ status: 400, json: { error: { message: "This endpoint does not support multiple references" } } });
  });
  const generator = page.locator("#canvas-node-generator");
  await generator.getByRole("button", { name: "生成绘制 (Generate)" }).click();
  await expect(generator.getByText("This endpoint does not support multiple references")).toBeVisible();
  expect(requests).toBe(1);
});

test("editor retains its one-image input limit", async ({ page }) => {
  await openCanvas(page, [{ id: "red", color: "red" }, { id: "blue", color: "blue" }], false, true);
  await connect(page, "red", "连接到修改节点");
  await connect(page, "blue", "连接到修改节点");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gpt_image_projects")!)[0]
    .connections.filter((connection: { toId: string }) => connection.toId === "editor").map((connection: { fromId: string }) => connection.fromId)))
    .toEqual(["red"]);
});

test("toolbar accepts multiple image files and persists each as an independent asset", async ({ page }) => {
  await openCanvas(page, []);
  const image = Buffer.from(responseImage, "base64");
  await page.locator("#toolbar-container input[type='file']").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: image },
    { name: "two.png", mimeType: "image/png", buffer: image },
  ]);
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gpt_image_projects")!)[0]
    .nodes.filter((node: { type: string }) => node.type === "image").length)).toBe(2);
  await page.reload();
  await expect(page.locator("[id^='canvas-node-node-img-'] img[alt='Result Image']")).toHaveCount(2);
  await expect.poll(() => page.locator("[id^='canvas-node-node-img-'] img[alt='Result Image']")
    .evaluateAll((images) => images.every((item) => (item as HTMLImageElement).naturalWidth > 0))).toBe(true);
});

test("switching away during multi-file upload stops the remaining files", async ({ page }) => {
  await openCanvas(page, []);
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
  const image = Buffer.from(responseImage, "base64");
  await page.locator("#toolbar-container input[type='file']").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: image },
    { name: "two.png", mimeType: "image/png", buffer: image },
  ]);
  await page.locator("[title='点击 打开/关闭画布列表']").click();
  await page.getByRole("button", { name: "主页", exact: true }).click();
  const dialog = await page.waitForEvent("dialog");
  expect(dialog.message()).toContain("其余图片未上传");
  await dialog.accept();
  await page.getByText("Reference test", { exact: true }).click();
  await expect(page.locator("[id^='canvas-node-node-img-']")).toHaveCount(0);
});
