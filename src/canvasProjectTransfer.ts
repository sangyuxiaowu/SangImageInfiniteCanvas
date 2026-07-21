import { getImageAsset, getMaskAsset, saveImageAsset, saveMaskBlob } from "./assets";
import { createCanvasArchive, readCanvasArchive } from "./canvasArchive";
import { CanvasNode, CanvasProject } from "./types";

function assetIdsForProject(project: CanvasProject) {
  const imageIds = new Set<string>();
  const maskIds = new Set<string>();
  project.nodes.forEach((node) => {
    if (node.assetId) imageIds.add(node.assetId);
    node.assetIds?.forEach((assetId) => imageIds.add(assetId));
    if (node.maskAssetId) maskIds.add(node.maskAssetId);
  });
  return { imageIds, maskIds };
}

export async function exportCanvasProject(project: CanvasProject) {
  const { imageIds, maskIds } = assetIdsForProject(project);
  const [images, masks] = await Promise.all([
    Promise.all([...imageIds].map(async (id) => {
      const asset = await getImageAsset(id);
      return asset ? { id, blob: asset.blob, kind: "image" as const } : undefined;
    })),
    Promise.all([...maskIds].map(async (id) => {
      const asset = await getMaskAsset(id);
      return asset ? { id, blob: asset.blob, kind: "mask" as const } : undefined;
    })),
  ]);
  return createCanvasArchive(project, [...images, ...masks].filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)));
}

function restoreNodeAssets(node: CanvasNode, assetIds: Map<string, string>) {
  const assetId = node.assetId ? assetIds.get(node.assetId) : undefined;
  const restoredAssetIds = node.assetIds?.map((id) => assetIds.get(id)).filter((id): id is string => Boolean(id));
  return {
    ...node,
    assetId,
    assetIds: restoredAssetIds?.length ? restoredAssetIds : undefined,
    maskAssetId: node.maskAssetId ? assetIds.get(node.maskAssetId) : undefined,
    imageUrl: undefined,
    imageUrls: undefined,
    originalImageUrl: node.originalImageUrl?.startsWith("blob:") || node.originalImageUrl?.startsWith("data:")
      ? undefined
      : node.originalImageUrl,
  };
}

export async function importCanvasProject(file: File): Promise<CanvasProject> {
  const { manifest, assets } = await readCanvasArchive(file);
  const restoredAssetIds = new Map<string, string>();

  for (const asset of manifest.assets) {
    const blob = assets.get(asset.id);
    if (!blob) continue;
    const savedId = asset.kind === "mask"
      ? await saveMaskBlob(blob)
      : await saveImageAsset(blob);
    restoredAssetIds.set(asset.id, savedId);
  }

  return {
    ...manifest.project,
    id: `project-${Date.now()}`,
    name: `${manifest.project.name}（导入）`,
    nodes: manifest.project.nodes.map((node) => restoreNodeAssets(node, restoredAssetIds)),
    updatedAt: Date.now(),
  };
}
