export type CanvasAspectRatio =
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "1:1(2k)"
  | "16:9(2k)"
  | "9:16(2k)"
  | "16:9(4k)"
  | "9:16(4k)"
  | "auto";
export const IMAGE_SIZE_BY_ASPECT_RATIO: Record<CanvasAspectRatio, string> = {
  auto: "auto",
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "4:3": "1360x1024",
  "3:4": "1024x1360",
  "16:9": "1824x1024",
  "9:16": "1024x1824",
  "1:1(2k)": "2048x2048",
  "16:9(2k)": "2048x1152",
  "9:16(2k)": "1152x2048",
  "16:9(4k)": "3840x2160",
  "9:16(4k)": "2160x3840",
};

export interface CanvasNode {
  id: string;
  type: "image" | "generator" | "editor" | "text";
  x: number; // canvas x-coordinate
  y: number; // canvas y-coordinate
  width: number;
  height: number;
  imageUrl?: string; // URL or base64 of the final generated image
  assetId?: string; // Persistent image Blob stored in IndexedDB
  assetIds?: string[]; // Persistent asset IDs for multiple generated images
  maskAssetId?: string; // Persistent edit mask Blob stored in IndexedDB
  imageUrls?: string[]; // Multiple generated image URLs (when quantity > 1)
  originalImageUrl?: string; // Cache the original image for comparison
  isStandaloneImage?: boolean; // Independent image assets can be linked to downstream nodes
  prompt: string;
  text?: string; // Content of text nodes
  status: "idle" | "loading" | "error";
  error?: string;
  aspectRatio: CanvasAspectRatio;
  model: string;
  endpointId?: string;
  quality?: "standard" | "hd" | "auto" | "medium" | "high" | "low";
  quantity?: number; // Number of images to generate (1-4)
  createdAt: number;
}

export interface CanvasConnection {
  id: string;
  fromId: string;
  toId: string;
}

export type CanvasTool = "select" | "pan" | "generator" | "text" | "brush" | "eraser";

export interface AppConfig {
  endpoints: ApiEndpoint[];
  defaultEndpointId: string;
}

export interface ApiEndpoint {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

export interface CanvasUsage {
  inputTextTokens: number;
  inputImageTokens: number;
  outputImageTokens: number;
  estimatedCostUsd: number;
}

export interface CanvasProject {
  id: string;
  name: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  panX: number;
  panY: number;
  zoom: number;
  usage?: CanvasUsage;
  updatedAt: number;
}
