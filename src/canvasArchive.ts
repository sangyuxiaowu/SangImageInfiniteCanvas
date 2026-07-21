import { CanvasProject } from "./types";

const ARCHIVE_FILE_NAME = "canvas.json";
const ARCHIVE_FORMAT = "sangcanvas";
const ARCHIVE_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface CanvasArchiveAsset {
  id: string;
  fileName: string;
  kind: "image" | "mask";
  type: string;
}

export interface CanvasArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  exportedAt: string;
  project: CanvasProject;
  assets: CanvasArchiveAsset[];
}

export interface CanvasArchiveInputAsset {
  id: string;
  blob: Blob;
  kind: CanvasArchiveAsset["kind"];
}

export interface ReadCanvasArchiveResult {
  manifest: CanvasArchiveManifest;
  assets: Map<string, Blob>;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function crc32(data: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = checksum & 1 ? (checksum >>> 1) ^ 0xedb88320 : checksum >>> 1;
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer).setUint16(offset, value, true);
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer).setUint32(offset, value, true);
}

function readUint16(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset).getUint16(offset, true);
}

function readUint32(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset).getUint32(offset, true);
}

function joinBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

async function transformDeflate(data: Uint8Array, mode: "compress" | "decompress") {
  const stream = mode === "compress"
    ? new CompressionStream("deflate-raw")
    : new DecompressionStream("deflate-raw");
  const transformed = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(transformed).arrayBuffer());
}

async function createZip(entries: ZipEntry[]) {
  const body: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressed = await transformDeflate(entry.data, "compress");
    const checksum = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    writeUint32(header, 0, 0x04034b50);
    writeUint16(header, 4, 20);
    writeUint16(header, 8, 8);
    writeUint32(header, 14, checksum);
    writeUint32(header, 18, compressed.length);
    writeUint32(header, 22, entry.data.length);
    writeUint16(header, 26, name.length);
    header.set(name, 30);
    body.push(header, compressed);

    const centralHeader = new Uint8Array(46 + name.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 10, 8);
    writeUint32(centralHeader, 16, checksum);
    writeUint32(centralHeader, 20, compressed.length);
    writeUint32(centralHeader, 24, entry.data.length);
    writeUint16(centralHeader, 28, name.length);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(name, 46);
    directory.push(centralHeader);
    offset += header.length + compressed.length;
  }

  const directoryData = joinBytes(directory);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 8, entries.length);
  writeUint16(end, 10, entries.length);
  writeUint32(end, 12, directoryData.length);
  writeUint32(end, 16, offset);
  return new Blob([joinBytes([...body, directoryData, end])], { type: "application/zip" });
}

async function readZip(file: File): Promise<Map<string, Uint8Array>> {
  const data = new Uint8Array(await file.arrayBuffer());
  let endOffset = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset -= 1) {
    if (readUint32(data, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("未找到有效的画布归档目录。");

  const entryCount = readUint16(data, endOffset + 10);
  let offset = readUint32(data, endOffset + 16);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(data, offset) !== 0x02014b50) throw new Error("画布归档目录已损坏。");
    const method = readUint16(data, offset + 10);
    const compressedSize = readUint32(data, offset + 20);
    const nameLength = readUint16(data, offset + 28);
    const extraLength = readUint16(data, offset + 30);
    const commentLength = readUint16(data, offset + 32);
    const localOffset = readUint32(data, offset + 42);
    const name = decoder.decode(data.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = readUint16(data, localOffset + 26);
    const localExtraLength = readUint16(data, localOffset + 28);
    const compressed = data.slice(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
    entries.set(name, method === 8 ? await transformDeflate(compressed, "decompress") : compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extensionFor(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "png";
}

export async function createCanvasArchive(project: CanvasProject, assets: CanvasArchiveInputAsset[]) {
  const manifestAssets = assets.map((asset) => ({
    id: asset.id,
    fileName: `assets/${asset.kind}-${asset.id}.${extensionFor(asset.blob.type)}`,
    kind: asset.kind,
    type: asset.blob.type || "image/png",
  }));
  const manifest: CanvasArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    assets: manifestAssets,
  };
  const assetEntries = await Promise.all(assets.map(async (asset, index) => ({
    name: manifestAssets[index].fileName,
    data: new Uint8Array(await asset.blob.arrayBuffer()),
  })));
  return createZip([
    { name: ARCHIVE_FILE_NAME, data: encoder.encode(JSON.stringify(manifest)) },
    ...assetEntries,
  ]);
}

export async function readCanvasArchive(file: File): Promise<ReadCanvasArchiveResult> {
  const entries = await readZip(file);
  const manifestData = entries.get(ARCHIVE_FILE_NAME);
  if (!manifestData) throw new Error("归档中缺少画布数据。");
  const manifest = JSON.parse(decoder.decode(manifestData)) as CanvasArchiveManifest;
  if (manifest.format !== ARCHIVE_FORMAT || manifest.version !== ARCHIVE_VERSION) {
    throw new Error("不支持的画布归档格式。");
  }
  const assets = new Map<string, Blob>();
  manifest.assets.forEach((asset) => {
    const data = entries.get(asset.fileName);
    if (data) assets.set(asset.id, new Blob([data], { type: asset.type }));
  });
  return { manifest, assets };
}