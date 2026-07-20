import { IncomingHttpHeaders } from "node:http";

export interface ImageApiConfiguration {
  apiKey?: string;
  baseUrl: string;
}

export function getImageApiConfiguration(headers: IncomingHttpHeaders): ImageApiConfiguration {
  const customApiKey = headers["x-api-key"] as string | undefined;
  const customBaseUrl = headers["x-base-url"] as string | undefined;
  return {
    apiKey: customApiKey || process.env.GPT_IMAGE_API_KEY,
    baseUrl: (customBaseUrl || process.env.GPT_IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

export function normalizeImageCount(value: unknown) {
  const numericValue = Number.parseInt(String(value), 10);
  return Number.isFinite(numericValue) ? Math.min(Math.max(numericValue, 1), 10) : 1;
}

export function base64ToBlob(base64Value: string, defaultType = "image/png"): Blob {
  const match = base64Value.match(/^data:([^;]+);/);
  const mime = match ? match[1] : defaultType;
  const base64Data = base64Value.replace(/^data:[^;]+;base64,/, "");
  return new Blob([Buffer.from(base64Data, "base64")], { type: mime });
}

export function normalizeImageResponse(data: any) {
  if (!Array.isArray(data?.data)) return data;
  return {
    ...data,
    data: data.data.map((item: any) => {
      if (!item.b64_json || item.url) return item;
      const prefix = item.b64_json.startsWith("data:") ? "" : "data:image/png;base64,";
      return { ...item, url: `${prefix}${item.b64_json}` };
    }),
  };
}

export function sanitizeForLog(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      ["image", "mask", "b64_json", "url", "imageUrl"].includes(key) && typeof item === "string"
        ? truncateSensitiveValue(item)
        : sanitizeForLog(item),
    ]));
  }
  return typeof value === "string" && (value.startsWith("data:image/") || value.length > 100)
    ? truncateSensitiveValue(value)
    : value;
}

function truncateSensitiveValue(value: string) {
  return value.length > 20 ? `${value.slice(0, 20)}... [Omitted ${value.length - 20} characters]` : value;
}
