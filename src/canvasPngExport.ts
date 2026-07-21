import { CanvasConnection, CanvasNode } from "./types";
import { getMaskAssetUrl } from "./assets";
import { createCompositedEditBlob, downloadBlob, getImageRequestSource } from "./imageUtils";

interface CanvasPngExportOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  fileName: string;
}

interface LoadedImage {
  image: ImageBitmap;
  width: number;
  height: number;
}

const EXPORT_PADDING = 96;
const MAX_EXPORT_DIMENSION = 4096;

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  context.fill();
  context.stroke();
}

async function loadSafeImage(source: string | Blob) {
  if (source instanceof Blob) {
    const image = await createImageBitmap(source);
    return { image, width: image.width, height: image.height };
  }
  const response = await fetch(getImageRequestSource(source));
  if (!response.ok) throw new Error("无法读取画布中的图片资源。");
  const image = await createImageBitmap(await response.blob());
  return { image, width: image.width, height: image.height };
}

function drawCoverImage(context: CanvasRenderingContext2D, loadedImage: LoadedImage, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / loadedImage.width, height / loadedImage.height);
  const imageWidth = loadedImage.width * scale;
  const imageHeight = loadedImage.height * scale;
  context.drawImage(loadedImage.image, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight);
}

function drawContainImage(context: CanvasRenderingContext2D, loadedImage: LoadedImage, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / loadedImage.width, height / loadedImage.height);
  const imageWidth = loadedImage.width * scale;
  const imageHeight = loadedImage.height * scale;
  context.drawImage(loadedImage.image, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight);
}

function drawConnection(context: CanvasRenderingContext2D, from: CanvasNode, to: CanvasNode, panX: number, panY: number, zoom: number) {
  const startX = panX + (from.x + from.width) * zoom;
  const startY = panY + (from.y + from.height / 2) * zoom;
  const endX = panX + to.x * zoom;
  const endY = panY + (to.y + to.height / 2) * zoom;
  const controlOffset = Math.max(40, Math.abs(endX - startX) * 0.4);
  context.beginPath();
  context.moveTo(startX, startY);
  context.bezierCurveTo(startX + controlOffset, startY, endX - controlOffset, endY, endX, endY);
  context.strokeStyle = "#818cf8";
  context.lineWidth = 2;
  context.stroke();
}

function findInputImage(nodeId: string, nodesById: Map<string, CanvasNode>, connections: CanvasConnection[]) {
  return connections
    .filter((connection) => connection.toId === nodeId)
    .map((connection) => nodesById.get(connection.fromId))
    .find((node) => node?.type === "image" && node.imageUrl)?.imageUrl;
}

function isEditOutputNode(node: CanvasNode, nodesById: Map<string, CanvasNode>, connections: CanvasConnection[]) {
  return connections
    .filter((connection) => connection.toId === node.id)
    .map((connection) => nodesById.get(connection.fromId))
    .some((candidate) => candidate?.type === "editor");
}

async function resolveNodeImage(
  node: CanvasNode,
  nodesById: Map<string, CanvasNode>,
  connections: CanvasConnection[],
): Promise<string | Blob | undefined> {
  const parentEditor = connections
    .filter((connection) => connection.toId === node.id)
    .map((connection) => nodesById.get(connection.fromId))
    .find((candidate) => candidate?.type === "editor");

  if (parentEditor && node.imageUrl && node.maskAssetId) {
    const originalSource = findInputImage(parentEditor.id, nodesById, connections) || node.originalImageUrl;
    const maskSource = await getMaskAssetUrl(node.maskAssetId);
    if (originalSource && maskSource) {
      try {
        return await createCompositedEditBlob(originalSource, node.imageUrl, maskSource);
      } finally {
        URL.revokeObjectURL(maskSource);
      }
    }
  }

  if (node.type === "editor") return node.imageUrl || findInputImage(node.id, nodesById, connections);
  return node.imageUrl;
}

async function drawNode(
  context: CanvasRenderingContext2D,
  node: CanvasNode,
  nodesById: Map<string, CanvasNode>,
  connections: CanvasConnection[],
  panX: number,
  panY: number,
  zoom: number,
) {
  const x = panX + node.x * zoom;
  const y = panY + node.y * zoom;
  const width = node.width * zoom;
  const height = node.height * zoom;
  if (x > context.canvas.width || y > context.canvas.height || x + width < 0 || y + height < 0) return;

  context.fillStyle = node.type === "text" ? "#172554" : "#0f172a";
  context.strokeStyle = node.type === "image" ? "#10b981" : "rgba(148, 163, 184, 0.45)";
  context.lineWidth = 1;
  roundedRect(context, x, y, width, height, Math.max(8, 16 * zoom));

  const title = node.type === "text" ? "文本便签" : node.type === "image" ? "生成结果" : node.type === "editor" ? "局部修改" : "文本生图";
  context.fillStyle = "#e2e8f0";
  context.font = `${Math.max(11, 13 * zoom)}px sans-serif`;
  context.fillText(title, x + 16 * zoom, y + 28 * zoom);

  const imageSource = await resolveNodeImage(node, nodesById, connections);
  if (imageSource) {
    const imageTop = y + 42 * zoom;
    const imageLeft = x + 10 * zoom;
    const imageWidth = width - 20 * zoom;
    const showResultChoices = isEditOutputNode(node, nodesById, connections) && (node.imageUrls?.length || 0) > 1;
    const choicesHeight = showResultChoices ? Math.min(82 * zoom, height * 0.28) : 0;
    const imageHeight = Math.max(0, height - 58 * zoom - choicesHeight);
    context.save();
    context.beginPath();
    context.roundRect(imageLeft, imageTop, imageWidth, imageHeight, Math.max(6, 10 * zoom));
    context.clip();
    try {
      const loadedImage = await loadSafeImage(imageSource);
      drawContainImage(context, loadedImage, imageLeft, imageTop, imageWidth, imageHeight);
      loadedImage.image.close();
    } catch (error) {
      console.warn("Skipping an unreadable image while exporting the canvas.", error);
      context.fillStyle = "#334155";
      context.fillRect(imageLeft, imageTop, imageWidth, imageHeight);
    }

    if (node.type === "editor" && node.maskAssetId) {
      const maskSource = await getMaskAssetUrl(node.maskAssetId);
      if (maskSource) {
        try {
          const loadedMask = await loadSafeImage(maskSource);
          context.save();
          context.globalAlpha = 0.5;
          drawContainImage(context, loadedMask, imageLeft, imageTop, imageWidth, imageHeight);
          context.restore();
          loadedMask.image.close();
        } catch (error) {
          console.warn("Skipping an unreadable edit mask while exporting the canvas.", error);
        } finally {
          URL.revokeObjectURL(maskSource);
        }
      }
    }
    context.restore();

    if (showResultChoices && node.imageUrls) {
      const choicesTop = imageTop + imageHeight + 8 * zoom;
      const gap = 6 * zoom;
      const thumbnailSize = Math.min(
        Math.max(24 * zoom, choicesHeight - 16 * zoom),
        (imageWidth - gap * (node.imageUrls.length - 1)) / node.imageUrls.length,
      );
      const totalWidth = thumbnailSize * node.imageUrls.length + gap * (node.imageUrls.length - 1);
      let thumbnailX = imageLeft + (imageWidth - totalWidth) / 2;

      for (const resultUrl of node.imageUrls) {
        context.save();
        context.beginPath();
        context.roundRect(thumbnailX, choicesTop, thumbnailSize, thumbnailSize, Math.max(4, 6 * zoom));
        context.clip();
        try {
          const thumbnail = await loadSafeImage(resultUrl);
          drawCoverImage(context, thumbnail, thumbnailX, choicesTop, thumbnailSize, thumbnailSize);
          thumbnail.image.close();
        } catch (error) {
          console.warn("Skipping an unreadable edit result while exporting the canvas.", error);
          context.fillStyle = "#334155";
          context.fillRect(thumbnailX, choicesTop, thumbnailSize, thumbnailSize);
        }
        context.restore();
        context.strokeStyle = resultUrl === node.imageUrl ? "#34d399" : "rgba(148, 163, 184, 0.35)";
        context.lineWidth = resultUrl === node.imageUrl ? 2 : 1;
        context.beginPath();
        context.roundRect(thumbnailX, choicesTop, thumbnailSize, thumbnailSize, Math.max(4, 6 * zoom));
        context.stroke();
        thumbnailX += thumbnailSize + gap;
      }
    }
    return;
  }

  const content = node.type === "text" ? node.text || "" : node.prompt || "等待输入提示词";
  context.fillStyle = "#94a3b8";
  context.font = `${Math.max(10, 12 * zoom)}px sans-serif`;
  context.fillText(content.slice(0, 80), x + 16 * zoom, y + 56 * zoom, Math.max(1, width - 32 * zoom));
}

export async function exportCanvasViewportPng({ nodes, connections, fileName }: CanvasPngExportOptions) {
  if (!nodes.length) throw new Error("画布没有可导出的内容。");

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const contentWidth = maxX - minX + EXPORT_PADDING * 2;
  const contentHeight = maxY - minY + EXPORT_PADDING * 2;
  const zoom = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(contentWidth, contentHeight));
  const width = Math.ceil(contentWidth * zoom);
  const height = Math.ceil(contentHeight * zoom);
  const panX = (EXPORT_PADDING - minX) * zoom;
  const panY = (EXPORT_PADDING - minY) * zoom;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, MAX_EXPORT_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建图片导出画布。");
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = "#020617";
  context.fillRect(0, 0, width, height);

  const gridSize = 32 * zoom;
  context.fillStyle = "rgba(148, 163, 184, 0.35)";
  for (let x = panX % gridSize; x < width; x += gridSize) {
    for (let y = panY % gridSize; y < height; y += gridSize) {
      context.beginPath();
      context.arc(x, y, 1, 0, Math.PI * 2);
      context.fill();
    }
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  connections.forEach((connection) => {
    const from = nodesById.get(connection.fromId);
    const to = nodesById.get(connection.toId);
    if (from && to) drawConnection(context, from, to, panX, panY, zoom);
  });
  for (const node of nodes) {
    await drawNode(context, node, nodesById, connections, panX, panY, zoom);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("无法创建 PNG 图片。");
  downloadBlob(blob, fileName);
}
