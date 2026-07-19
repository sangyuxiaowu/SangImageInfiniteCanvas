const DATABASE_NAME = "gpt-image-canvas";
const ASSET_STORE_NAME = "assets";
const MASK_STORE_NAME = "masks";
const DATABASE_VERSION = 2;

interface StoredAsset {
  id: string;
  blob: Blob;
  createdAt: number;
}

export interface ImageAssetSummary {
  id: string;
  createdAt: number;
  size: number;
  type: string;
}

function openAssetDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSET_STORE_NAME)) {
        request.result.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(MASK_STORE_NAME)) {
        request.result.createObjectStore(MASK_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openAssetDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  }));
}

export async function saveImageAsset(source: string | Blob): Promise<string> {
  const blob = source instanceof Blob
    ? source
    : await fetch(source).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to read image data for local storage.");
      }
      return response.blob();
    });

  const asset: StoredAsset = {
    id: `asset-${crypto.randomUUID()}`,
    blob,
    createdAt: Date.now(),
  };
  await runTransaction(ASSET_STORE_NAME, "readwrite", (store) => store.put(asset));
  return asset.id;
}

export async function getImageAssetUrl(assetId: string): Promise<string | undefined> {
  const asset = await runTransaction<StoredAsset | undefined>(ASSET_STORE_NAME, "readonly", (store) => store.get(assetId));
  return asset ? URL.createObjectURL(asset.blob) : undefined;
}

export async function listImageAssets(): Promise<ImageAssetSummary[]> {
  const assets = await runTransaction<StoredAsset[]>(ASSET_STORE_NAME, "readonly", (store) => store.getAll());
  return assets
    .map((asset) => ({ id: asset.id, createdAt: asset.createdAt, size: asset.blob.size, type: asset.blob.type }))
    .sort((first, second) => second.createdAt - first.createdAt);
}

export async function deleteImageAsset(assetId: string): Promise<void> {
  await runTransaction<IDBValidKey>(ASSET_STORE_NAME, "readwrite", (store) => store.delete(assetId));
}

export async function saveMaskAsset(sourceUrl: string): Promise<string> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("Unable to read mask data for local storage.");
  }

  const mask: StoredAsset = {
    id: `mask-${crypto.randomUUID()}`,
    blob: await response.blob(),
    createdAt: Date.now(),
  };
  await runTransaction(MASK_STORE_NAME, "readwrite", (store) => store.put(mask));
  return mask.id;
}

export async function getMaskAssetUrl(maskAssetId: string): Promise<string | undefined> {
  const mask = await runTransaction<StoredAsset | undefined>(MASK_STORE_NAME, "readonly", (store) => store.get(maskAssetId));
  if (mask) return URL.createObjectURL(mask.blob);

  // Compatibility with masks saved before the dedicated masks store was introduced.
  const legacyMask = await runTransaction<StoredAsset | undefined>(ASSET_STORE_NAME, "readonly", (store) => store.get(maskAssetId));
  return legacyMask ? URL.createObjectURL(legacyMask.blob) : undefined;
}