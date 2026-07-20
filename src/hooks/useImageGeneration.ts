import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef } from "react";
import { getImageAssetUrl, saveImageAsset } from "../assets";
import { recordOperationLog } from "../operationLogs";
import { ApiEndpoint, CanvasConnection, CanvasNode } from "../types";

export interface ImageGenerationOptions {
  size?: string;
  model?: string;
  quality?: CanvasNode["quality"];
  n?: number;
  image?: string;
}

interface ImageGenerationDependencies {
  nodes: CanvasNode[];
  config: { endpoints: ApiEndpoint[] };
  defaultEndpoint: ApiEndpoint;
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
  assetObjectUrlsRef: MutableRefObject<Set<string>>;
  onUsageReceived: (response: unknown) => void;
}

function getRequestHeaders(endpoint: ApiEndpoint): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.apiKey) headers["x-api-key"] = endpoint.apiKey;
  if (endpoint.baseUrl) headers["x-base-url"] = endpoint.baseUrl;
  return headers;
}

async function getResponseData(response: Response) {
  if (response.ok) return response.json();
  const errorData = await response.json();
  throw new Error(errorData.details || errorData.error || `Server error code ${response.status}`);
}

export function useImageGeneration({
  nodes,
  config,
  defaultEndpoint,
  setNodes,
  setConnections,
  assetObjectUrlsRef,
  onUsageReceived,
}: ImageGenerationDependencies) {
  const controllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => () => {
    controllersRef.current.forEach((controller) => controller.abort());
  }, []);

  const generateImage = async (nodeId: string, prompt: string, options: ImageGenerationOptions) => {
    const generatorNode = nodes.find((node) => node.id === nodeId);
    if (!generatorNode) return;
    const endpoint = config.endpoints.find((item) => item.id === generatorNode.endpointId) || defaultEndpoint;

    controllersRef.current.get(nodeId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(nodeId, controller);
    setNodes((previousNodes) => previousNodes.map((node) => (
      node.id === nodeId ? { ...node, status: "loading", prompt, error: undefined } : node
    )));
    recordOperationLog("开始生成图像", `模型：${options.model || generatorNode.model}`, "info");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: getRequestHeaders(endpoint),
        body: JSON.stringify({
          prompt,
          size: options.size,
          model: options.model || "gpt-image-2",
          quality: options.quality,
          n: options.n,
          image: options.image,
        }),
        signal: controller.signal,
      });
      const responseData = await getResponseData(response);
      const sourceUrls = responseData.data?.map((item: { url?: string }) => item.url).filter(Boolean) || [];
      if (!sourceUrls.length) throw new Error("No image URL was returned in the API response.");

      onUsageReceived(responseData);
      const generatedAt = Date.now();
      const outputNodes = await Promise.all(sourceUrls.map(async (sourceUrl: string, index: number): Promise<CanvasNode> => {
        const assetId = await saveImageAsset(sourceUrl);
        const imageUrl = await getImageAssetUrl(assetId);
        if (!imageUrl) throw new Error("Unable to load the generated image asset.");
        assetObjectUrlsRef.current.add(imageUrl);
        return {
          id: `node-output-${generatedAt}-${index}`,
          type: "image",
          x: generatorNode.x + generatorNode.width + 64,
          y: generatorNode.y + index * 444,
          width: 400,
          height: 420,
          prompt,
          imageUrl,
          assetId,
          isStandaloneImage: false,
          status: "idle",
          aspectRatio: generatorNode.aspectRatio,
          model: options.model || generatorNode.model,
          createdAt: generatedAt + index,
        };
      }));
      setNodes((previousNodes) => [
        ...previousNodes.map((node) => node.id === nodeId ? {
          ...node,
          status: "idle" as const,
          prompt,
          imageUrl: undefined,
          originalImageUrl: undefined,
          imageUrls: undefined,
        } : node),
        ...outputNodes,
      ]);
      setConnections((previousConnections) => [
        ...previousConnections,
        ...outputNodes.map((outputNode, index) => ({
          id: `conn-output-${generatedAt}-${index}`,
          fromId: nodeId,
          toId: outputNode.id,
        })),
      ]);
      recordOperationLog("生成图像完成", `已生成 ${outputNodes.length} 张图片`, "success");
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "请求失败";
      console.error(error);
      setNodes((previousNodes) => previousNodes.map((node) => (
        node.id === nodeId ? { ...node, status: "error", error: message } : node
      )));
      recordOperationLog("生成图像失败", message, "error");
    } finally {
      if (controllersRef.current.get(nodeId) === controller) controllersRef.current.delete(nodeId);
    }
  };

  const generateEdit = async (
    nodeId: string,
    originalImageBase64: string,
    maskBase64: string,
    prompt: string,
    options: ImageGenerationOptions,
  ) => {
    const parentNode = nodes.find((node) => node.id === nodeId);
    if (!parentNode) return;
    const endpoint = config.endpoints.find((item) => item.id === parentNode.endpointId) || defaultEndpoint;
    const createdAt = Date.now();
    const nextNodeId = `node-edit-${createdAt}`;
    const nextNode: CanvasNode = {
      id: nextNodeId,
      type: "image",
      x: parentNode.x + parentNode.width + 120,
      y: parentNode.y,
      width: parentNode.width,
      height: parentNode.height,
      prompt,
      status: "loading",
      isStandaloneImage: false,
      aspectRatio: parentNode.aspectRatio,
      model: options.model || parentNode.model || "gpt-image-2",
      createdAt,
    };
    setNodes((previousNodes) => [...previousNodes, nextNode]);
    setConnections((previousConnections) => [...previousConnections, {
      id: `conn-edit-${createdAt}`,
      fromId: nodeId,
      toId: nextNodeId,
    }]);

    const controller = new AbortController();
    controllersRef.current.set(nextNodeId, controller);
    recordOperationLog("开始局部编辑", `模型：${options.model || parentNode.model}`, "info");

    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: getRequestHeaders(endpoint),
        body: JSON.stringify({
          image: originalImageBase64,
          mask: maskBase64,
          prompt,
          size: options.size,
          model: options.model || "gpt-image-2",
          quality: options.quality,
          n: options.n,
        }),
        signal: controller.signal,
      });
      const responseData = await getResponseData(response);
      const sourceUrls = responseData.data?.map((item: { url?: string }) => item.url).filter(Boolean) || [];
      if (!sourceUrls.length) throw new Error("No image URL was returned in the API response.");

      onUsageReceived(responseData);
      const storedImages = await Promise.all(sourceUrls.map(async (sourceUrl: string) => {
        const assetId = await saveImageAsset(sourceUrl);
        const imageUrl = await getImageAssetUrl(assetId);
        if (!imageUrl) throw new Error("Unable to load the edited image asset.");
        assetObjectUrlsRef.current.add(imageUrl);
        return { assetId, imageUrl };
      }));
      setNodes((previousNodes) => previousNodes.map((node) => node.id === nextNodeId ? {
        ...node,
        status: "idle",
        imageUrl: storedImages[0].imageUrl,
        assetId: storedImages[0].assetId,
        assetIds: storedImages.map((image) => image.assetId),
        originalImageUrl: originalImageBase64,
        maskAssetId: parentNode.maskAssetId,
        imageUrls: storedImages.map((image) => image.imageUrl),
        prompt,
      } : node));
      recordOperationLog("局部编辑完成", `已生成 ${storedImages.length} 张图片`, "success");
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "编辑失败";
      console.error(error);
      setNodes((previousNodes) => previousNodes.map((node) => (
        node.id === nextNodeId ? { ...node, status: "error", error: message } : node
      )));
      recordOperationLog("局部编辑失败", message, "error");
    } finally {
      if (controllersRef.current.get(nextNodeId) === controller) controllersRef.current.delete(nextNodeId);
    }
  };

  const cancelGeneration = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    controllersRef.current.get(nodeId)?.abort();
    controllersRef.current.delete(nodeId);
    const isTemporaryEditOutput = node?.type === "image" && node.status === "loading";
    if (isTemporaryEditOutput) {
      setNodes((previousNodes) => previousNodes.filter((item) => item.id !== nodeId));
      setConnections((previousConnections) => previousConnections.filter((connection) => (
        connection.fromId !== nodeId && connection.toId !== nodeId
      )));
      recordOperationLog("取消图像任务", "已取消局部编辑", "info");
      return;
    }
    setNodes((previousNodes) => previousNodes.map((item) => (
      item.id === nodeId ? { ...item, status: "idle", error: undefined } : item
    )));
    recordOperationLog("取消图像任务", node?.type === "generator" ? "已取消生图任务" : "已取消图像任务", "info");
  };

  return { generateImage, generateEdit, cancelGeneration };
}