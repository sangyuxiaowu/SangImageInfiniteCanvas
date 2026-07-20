export function getImageRequestSource(sourceUrl: string) {
  return sourceUrl.startsWith("blob:") || sourceUrl.startsWith("data:")
    ? sourceUrl
    : `/api/proxy-image?url=${encodeURIComponent(sourceUrl)}`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

export function loadCanvasImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image for download."));
    image.src = getImageRequestSource(sourceUrl);
  });
}

export async function getCleanImageBase64(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Unable to create offscreen canvas context."));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Failed to load original image via proxy."));
    image.src = getImageRequestSource(imageUrl);
  });
}

export async function createCompositedEditBlob(
  originalSource: string,
  editedSource: string,
  maskSource: string,
): Promise<Blob> {
  const [originalImage, editedImage, maskImage] = await Promise.all([
    loadCanvasImage(originalSource),
    loadCanvasImage(editedSource),
    loadCanvasImage(maskSource),
  ]);
  const width = originalImage.naturalWidth || originalImage.width;
  const height = originalImage.naturalHeight || originalImage.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create image composition canvas.");

  context.drawImage(originalImage, 0, 0, width, height);
  const editedCanvas = document.createElement("canvas");
  editedCanvas.width = width;
  editedCanvas.height = height;
  const editedContext = editedCanvas.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext("2d");
  if (!editedContext || !maskContext) throw new Error("Unable to create edit composition canvas.");

  editedContext.drawImage(editedImage, 0, 0, width, height);
  maskContext.drawImage(maskImage, 0, 0, width, height);
  const editedPixels = editedContext.getImageData(0, 0, width, height);
  const maskPixels = maskContext.getImageData(0, 0, width, height);
  const pixelCount = width * height;
  const boundaryBlackPixels = new Uint8Array(pixelCount);
  const queue: number[] = [];
  const isMaskPixel = (index: number) => maskPixels.data[index * 4 + 3] > 8;
  const isNearBlackPixel = (index: number) => {
    const offset = index * 4;
    const luminance = 0.2126 * editedPixels.data[offset]
      + 0.7152 * editedPixels.data[offset + 1]
      + 0.0722 * editedPixels.data[offset + 2];
    return luminance < 24;
  };

  for (let index = 0; index < pixelCount; index += 1) {
    if (!isMaskPixel(index) || !isNearBlackPixel(index)) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const touchesMaskBoundary = x === 0 || y === 0 || x === width - 1 || y === height - 1
      || !isMaskPixel(index - 1)
      || !isMaskPixel(index + 1)
      || !isMaskPixel(index - width)
      || !isMaskPixel(index + width);
    if (touchesMaskBoundary) {
      boundaryBlackPixels[index] = 1;
      queue.push(index);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];
    neighbors.forEach((neighbor) => {
      if (neighbor < 0 || boundaryBlackPixels[neighbor] || !isMaskPixel(neighbor) || !isNearBlackPixel(neighbor)) return;
      boundaryBlackPixels[neighbor] = 1;
      queue.push(neighbor);
    });
  }

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const maskOpacity = Math.min(maskPixels.data[offset + 3] / 115, 1);
    editedPixels.data[offset + 3] = boundaryBlackPixels[index]
      ? 0
      : Math.round(editedPixels.data[offset + 3] * maskOpacity);
  }

  editedContext.putImageData(editedPixels, 0, 0);
  context.drawImage(editedCanvas, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to export composited image."));
    }, "image/png");
  });
}