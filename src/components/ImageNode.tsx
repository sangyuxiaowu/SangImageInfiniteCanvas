import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Trash2,
  Download,
  Image as ImageIcon,
  AlertCircle,
  Clock,
  Brush,
  Eraser,
  RefreshCw,
  X,
  Expand,
  HelpCircle,
  Upload,
  Palette,
  FileText,
  Sliders,
  Cpu,
  ArrowLeft,
  Copy,
} from "lucide-react";
import { ApiEndpoint, CanvasAspectRatio, CanvasNode, IMAGE_SIZE_BY_ASPECT_RATIO } from "../types";
import { getImageAssetUrl, getMaskAssetUrl, saveMaskAsset } from "../assets";
import { createCompositedEditBlob, downloadBlob, getCleanImageBase64, getImageRequestSource } from "../imageUtils";
import TextNode from "./TextNode";

interface ImageNodeProps {
  node: CanvasNode;
  activeTool: string;
  zoom: number;
  onGenerate: (nodeId: string, prompt: string, options: any) => void;
  onGenerateEdit: (
    nodeId: string,
    originalImageBase64: string,
    maskBase64: string,
    prompt: string,
    options: any
  ) => void;
  onCancelGeneration: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onCreateStandaloneImage: (nodeId: string, imageBlob: Blob) => Promise<void>;
  onUpdatePosition: (nodeId: string, updates: Partial<CanvasNode>) => void;
  parentInputImageUrl?: string;
  
  // Connection and Reference System Props
  connectingFromId: string | null;
  onStartConnecting: (nodeId: string, clientX?: number, clientY?: number) => void;
  onCompleteConnecting: (nodeId: string) => void;
  connectedToNodes: CanvasNode[];
  incomingNodes: CanvasNode[];
  onUploadReferenceImage?: (nodeId: string, base64Url: string) => void;
  endpoints: ApiEndpoint[];
}

export default function ImageNode({
  node,
  activeTool,
  zoom,
  onGenerate,
  onGenerateEdit,
  onCancelGeneration,
  onDelete,
  onDuplicate,
  onCreateStandaloneImage,
  onUpdatePosition,
  parentInputImageUrl,
  connectingFromId,
  onStartConnecting,
  onCompleteConnecting,
  connectedToNodes,
  incomingNodes,
  onUploadReferenceImage,
  endpoints,
}: ImageNodeProps) {
  const [prompt, setPrompt] = useState(node.prompt);
  const [aspectRatio, setAspectRatio] = useState<CanvasAspectRatio>(node.aspectRatio);
  const [quality, setQuality] = useState<any>(node.quality || "auto");
  const [quantity, setQuantity] = useState<number>(node.quantity || 1);
  const [model, setModel] = useState<string>(node.model || "gpt-image-2");
  const [showConfig, setShowConfig] = useState(!node.imageUrl);
  const selectedEndpointId = node.endpointId || endpoints[0]?.id || "";
  const hasSelectedModel = endpoints.some((endpoint) => endpoint.id === selectedEndpointId && endpoint.models.includes(model));

  const handleModelSelection = (value: string) => {
    const [endpointId, selectedModel] = value.split("::");
    setModel(selectedModel);
    onUpdatePosition(node.id, { endpointId, model: selectedModel });
  };

  const renderModelOptions = () => <>
    {!hasSelectedModel && <option value={`${selectedEndpointId}::${model}`}>{model}（当前配置）</option>}
    {endpoints.map((endpoint) => (
      <optgroup key={endpoint.id} label={endpoint.name}>
        {endpoint.models.map((endpointModel) => (
          <option key={`${endpoint.id}-${endpointModel}`} value={`${endpoint.id}::${endpointModel}`}>
            {endpointModel}
          </option>
        ))}
      </optgroup>
    ))}
  </>;

  useEffect(() => {
    if (node.model) {
      setModel(node.model);
    }
  }, [node.model]);

  useEffect(() => {
    if (!node.imageUrl) {
      setShowConfig(true);
    }
  }, [node.imageUrl]);

  // Inpainting Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(25);
  const [editTool, setEditTool] = useState<"brush" | "eraser">("brush");
  const [isPreparingEdit, setIsPreparingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [savedMaskBase64, setSavedMaskBase64] = useState("");
  const [compositedPreviewUrl, setCompositedPreviewUrl] = useState("");

  // Canvas drawing refs
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Derived input image for editor nodes
  const connectedImages = incomingNodes.filter((n) => n.type === "image" && (n.imageUrl || n.assetId));
  const inputImage = connectedImages[0];
  const targetImageUrl = node.imageUrl || inputImage?.imageUrl;
  const editResultBaseImageUrl = parentInputImageUrl || node.originalImageUrl;

  // Timer state for loading node
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!node.maskAssetId) {
      setSavedMaskBase64("");
      return;
    }

    let cancelled = false;
    let maskUrl: string | undefined;
    getMaskAssetUrl(node.maskAssetId)
      .then((url) => {
        if (cancelled || !url) return;
        maskUrl = url;
        setSavedMaskBase64(url);
      })
      .catch((error) => console.warn("Unable to restore the saved edit mask.", error));

    return () => {
      cancelled = true;
      if (maskUrl) URL.revokeObjectURL(maskUrl);
    };
  }, [node.maskAssetId]);

  useEffect(() => {
    let interval: any;
    if (node.status === "loading") {
      setElapsed(0);
      interval = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsed(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [node.status]);

  // Handle Drag / Move of node
  const dragStartRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with select tool and from header/background, not from buttons/inputs
    if (activeTool !== "select") return;
    if (isEditing) return; // Disable dragging when painting mask

    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "BUTTON" ||
      target.tagName === "SELECT" ||
      target.closest(".no-drag")
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragStartRef.current) return;
    const dx = (e.clientX - dragStartRef.current.startX) / zoom;
    const dy = (e.clientY - dragStartRef.current.startY) / zoom;
    
    // Smooth moving based on grid or directly
    onUpdatePosition(node.id, {
      x: Math.round(dragStartRef.current.nodeX + dx),
      y: Math.round(dragStartRef.current.nodeY + dy),
    });
  };

  const handleMouseUp = () => {
    dragStartRef.current = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  // Drawing on the Mask Canvas
  const initMaskCanvas = () => {
    const canvas = maskCanvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    // Set canvas dimensions equal to the displayed image dimensions
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (savedMaskBase64) {
        const savedMask = new Image();
        savedMask.onload = () => ctx.drawImage(savedMask, 0, 0, canvas.width, canvas.height);
        savedMask.src = savedMaskBase64;
      }
    }
  };

  useEffect(() => {
    if (isEditing && targetImageUrl) {
      // Small timeout to ensure image is fully rendered and clientWidth/Height are correct
      const timer = setTimeout(() => {
        initMaskCanvas();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isEditing, targetImageUrl]);

  const handleDrawStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;

    e.preventDefault();
    e.stopPropagation();

    setIsDrawing(true);
    draw(e);
  };

  const handleDrawMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    draw(e);
  };

  const handleDrawEnd = () => {
    setIsDrawing(false);
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.beginPath(); // Reset drawing path
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    // Translate mouse coordinates to local canvas coordinates
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (editTool === "brush") {
      ctx.strokeStyle = "rgba(239, 68, 68, 0.45)";
      ctx.globalCompositeOperation = "source-over";
    } else {
      // Clear pixels on the mask (eraser)
      ctx.globalCompositeOperation = "destination-out";
    }

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleClearMask = () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setSavedMaskBase64("");
    onUpdatePosition(node.id, { maskAssetId: undefined });
  };

  const generateWithReferenceImage = async (prompt: string) => {
    let referenceImageUrl = inputImage?.imageUrl;
    if (!referenceImageUrl && inputImage?.assetId) {
      referenceImageUrl = await getImageAssetUrl(inputImage.assetId);
    }
    const image = referenceImageUrl ? await getCleanImageBase64(referenceImageUrl) : undefined;
    onGenerate(node.id, prompt, {
      size: IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio],
      model: node.model,
      quality,
      n: quantity,
      image,
    });
  };

  // Export the display-scale mask at the source image's native dimensions.
  const getMaskBase64 = (): string => {
    const canvas = maskCanvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return savedMaskBase64;

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return "";

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return "";

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);
    return exportCanvas.toDataURL("image/png");
  };

  const handleSaveMask = async () => {
    const mask = getMaskBase64();
    if (!mask) {
      setEditError("未能保存涂抹蒙版，请重新进入涂抹模式后再试。");
      return;
    }
    try {
      const maskAssetId = await saveMaskAsset(mask);
      setSavedMaskBase64(mask);
      onUpdatePosition(node.id, { maskAssetId });
      setEditError("");
      setIsEditing(false);
    } catch (error) {
      console.error("Unable to save the edit mask.", error);
      setEditError("保存涂抹蒙版失败，请重试。");
    }
  };

  const handleApplyEdit = async () => {
    const connectedTexts = incomingNodes.filter((n) => n.type === "text" && n.text?.trim());
    const combinedPrompt = connectedTexts.map((n) => n.text!.trim()).join("\n");

    if (!combinedPrompt) {
      setEditError("请连线一个文本便签节点以提供修改指令 (Link a text node to provide instructions).");
      return;
    }

    setEditError("");
    setIsPreparingEdit(true);

    try {
      if (!inputImage || !inputImage.imageUrl) {
        throw new Error("输入图片缺失，请关联一个输入图片节点至此。");
      }

      // 1. Get original image as clean base64 (CORS safe)
      const originalBase64 = await getCleanImageBase64(inputImage.imageUrl);

      // 2. Get mask as clean base64
      const maskBase64 = savedMaskBase64
        ? await getCleanImageBase64(savedMaskBase64)
        : getMaskBase64();
      if (!maskBase64) {
        throw new Error("请先进入涂抹模式并保存涂抹蒙版。");
      }

      // 3. Trigger parent edit generator
      onGenerateEdit(node.id, originalBase64, maskBase64, combinedPrompt, {
        model: node.model,
        quality,
        n: quantity,
      });

      // Exit edit mode on success
      setIsEditing(false);
    } catch (err: any) {
      console.error(err);
      setEditError(`准备编辑失败: ${err.message || err}`);
    } finally {
      setIsPreparingEdit(false);
    }
  };

  useEffect(() => {
    if (!editResultBaseImageUrl || !node.imageUrl || !savedMaskBase64) {
      setCompositedPreviewUrl("");
      return;
    }

    let cancelled = false;
    let previewUrl: string | undefined;
    void createCompositedEditBlob(editResultBaseImageUrl, node.imageUrl, savedMaskBase64)
      .then((blob) => {
        previewUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(previewUrl);
          return;
        }
        setCompositedPreviewUrl(previewUrl);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Unable to compose the edited image preview.", error);
          setCompositedPreviewUrl("");
        }
      });

    return () => {
      cancelled = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [node.imageUrl, editResultBaseImageUrl, savedMaskBase64]);

  const handleDownloadMaskResult = async (sourceUrl: string, index: number) => {
    try {
      const response = await fetch(getImageRequestSource(sourceUrl));
      downloadBlob(await response.blob(), `gpt-image-mask-result-${node.id}-${index + 1}.png`);
    } catch (err) {
      alert("下载失败，请重试！");
    }
  };

  const handleCreateStandaloneImage = async () => {
    if (!node.imageUrl) return;
    try {
      const imageBlob = editResultBaseImageUrl && savedMaskBase64
        ? await createCompositedEditBlob(editResultBaseImageUrl, node.imageUrl, savedMaskBase64)
        : await fetch(getImageRequestSource(node.imageUrl)).then(async (response) => {
          if (!response.ok) throw new Error("Unable to copy image asset.");
          return response.blob();
        });
      await onCreateStandaloneImage(node.id, imageBlob);
    } catch (error) {
      console.error("Unable to create standalone image node.", error);
      alert("创建独立图片节点失败，请重试！");
    }
  };

  const handleDownload = async () => {
    if (!node.imageUrl) return;
    try {
      if (editResultBaseImageUrl && savedMaskBase64) {
        const compositeBlob = await createCompositedEditBlob(editResultBaseImageUrl, node.imageUrl, savedMaskBase64);
        downloadBlob(compositeBlob, `gpt-image-${node.id}.png`);
        return;
      }

      const response = await fetch(getImageRequestSource(node.imageUrl));
      downloadBlob(await response.blob(), `gpt-image-${node.id}.png`);
    } catch (err) {
      alert("下载失败，请重试！");
    }
  };

  // Presets for inspiration
  const promptPresets = [
    "Cyberpunk city street, neon glowing signs, dark atmosphere, photorealistic",
    "A cute fluffy white kitten with giant golden eyes, Pixar style 3D",
    "Serene Japanese Zen garden at sunrise, pink cherry blossoms, high detail",
    "Vibrant abstract oil painting, heavy brush strokes, modern art style",
  ];

  // ==================== BRANCH 1: TEXT STICKY NOTE NODE ====================
  if (node.type === "text") {
    return (
      <TextNode
        node={node}
        activeTool={activeTool}
        isConnecting={connectingFromId === node.id}
        onMouseDown={handleMouseDown}
        onUpdate={(updates) => onUpdatePosition(node.id, updates)}
        onDuplicate={() => onDuplicate(node.id)}
        onDelete={() => onDelete(node.id)}
        onStartConnecting={(clientX, clientY) => onStartConnecting(node.id, clientX, clientY)}
      />
    );
  }

  // ==================== BRANCH 2: IMAGE (UPLOADED REFERENCE / SEPARATED) NODE ====================
  if (node.type === "image") {
    const isConnectingToThis = connectingFromId === node.id;
    return (
      <div
        id={`canvas-node-${node.id}`}
        className={`absolute glass-panel-heavy rounded-2xl border transition-all select-none flex flex-col overflow-visible shadow-2xl ${
          node.status === "loading"
            ? "border-emerald-500/50 shadow-emerald-500/10 shadow-lg ring-2 ring-emerald-500/20"
            : "border-white/10"
        }`}
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
          minHeight: node.height,
          height: node.status === "loading" ? node.height : undefined,
          zIndex: 10,
        }}
      >
        {/* Header - Drag Handle */}
        <div 
          onMouseDown={handleMouseDown}
          className={`bg-slate-900/60 border-b border-white/10 px-3 py-2 flex items-center justify-between select-none shrink-0 ${
            activeTool === "select" ? "cursor-grab active:cursor-grabbing hover:bg-slate-900/80" : "cursor-default"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-bold text-slate-100">
              {node.status === "loading" ? "修改生成中" : "图片资源"}
            </span>
          </div>

          <div className="flex items-center gap-1 no-drag">
            <button
              onClick={() => void handleCreateStandaloneImage()}
              className="text-slate-400 hover:text-indigo-300 hover:bg-white/10 p-1 rounded-md transition-all cursor-pointer"
              title="复制为独立图片节点"
            >
              <Copy className="w-3 h-3" />
            </button>

            {/* Trash */}
            <button
              onClick={() => onDelete(node.id)}
              className="text-slate-400 hover:text-rose-400 hover:bg-white/10 p-1 rounded-md transition-all cursor-pointer"
              title="删除图片"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Body (displays the image) */}
        <div className="flex-1 overflow-hidden p-3 flex flex-col bg-slate-950/25 select-none">
          {node.status === "loading" ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
              <div className="w-14 h-14 rounded-full border-4 border-white/5 border-t-emerald-500 animate-spin mb-4" />
              <p className="text-sm font-semibold text-slate-100 mb-1">正在生成修改结果</p>
              <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed mb-4">
                模型正在根据涂抹遮罩及指令进行局部编辑，请耐心等待。
              </p>
              <div className="text-[11px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>已耗时 {elapsed} 秒 / 最长10分钟</span>
              </div>
              <button
                type="button"
                onClick={() => onCancelGeneration(node.id)}
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 cursor-pointer no-drag"
              >
                <X className="w-3.5 h-3.5" />
                <span>取消生成</span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 bg-slate-950/45 rounded-xl relative overflow-hidden flex items-center justify-center border border-white/5 no-drag">
                {node.imageUrl ? (
                  editResultBaseImageUrl && savedMaskBase64 ? (
                    compositedPreviewUrl ? (
                      <img
                        src={compositedPreviewUrl}
                        alt="Composited edited result"
                        referrerPolicy="no-referrer"
                        className="max-w-full max-h-full object-contain pointer-events-none select-none"
                      />
                    ) : (
                      <img
                        src={editResultBaseImageUrl}
                        alt="Original image"
                        className="max-w-full max-h-full object-contain pointer-events-none select-none"
                      />
                    )
                  ) : (
                    <img
                      ref={imageRef}
                      src={node.imageUrl}
                      alt="Result Image"
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                      className="max-w-full max-h-full object-contain pointer-events-none select-none"
                    />
                  )
                ) : (
                  <ImageIcon className="w-8 h-8 text-slate-600" />
                )}
              </div>

              {node.imageUrls && node.imageUrls.length > 1 && (
                <div className="mt-2.5 grid grid-cols-4 gap-1.5 no-drag">
                  {node.imageUrls.map((url, index) => (
                    <div
                      key={url}
                      onClick={() => onUpdatePosition(node.id, { imageUrl: url })}
                      className={`group relative aspect-square overflow-hidden rounded-lg border transition-all cursor-pointer ${
                        node.imageUrl === url ? "border-emerald-400 ring-1 ring-emerald-400/30" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <img src={url} alt={`Edited result ${index + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDownloadMaskResult(url, index);
                        }}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-slate-950/80 text-slate-100 hover:bg-emerald-600 cursor-pointer"
                        title={`下载重绘区域 ${index + 1}`}
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2.5 no-drag select-none shrink-0 flex gap-1.5">
                <button
                  onClick={handleDownload}
                  disabled={!node.imageUrl}
                  className="w-full py-2 rounded-xl border border-white/10 text-slate-200 hover:bg-white/10 disabled:text-slate-600 disabled:hover:bg-transparent font-bold text-xs transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-400" />
                  <span>保存到本地 (Download)</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Only independent image assets may be connected to downstream nodes. */}
        {node.isStandaloneImage !== false && (
          <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 z-50 no-drag">
          <button
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onStartConnecting(node.id, event.clientX, event.clientY);
            }}
            className={`w-3 h-3 rounded-full border-2 transition-all hover:scale-150 cursor-pointer ${
              isConnectingToThis
                ? "border-indigo-300 animate-pulse shadow-[0_0_0_3px_rgba(99,102,241,0.35)]"
                : "bg-transparent border-slate-300 hover:border-indigo-400"
            }`}
            title="拉出连线关联到修改或生图节点 (Drag/Click to connect)"
          />
          </div>
        )}
      </div>
    );
  }

  // ==================== BRANCH 3: GENERATOR (TEXT TO IMAGE) NODE ====================
  if (node.type === "generator") {
    const connectedTexts = incomingNodes.filter((n) => n.type === "text" && n.text?.trim());
    const combinedPrompt = connectedTexts.map((n) => n.text!.trim()).join("\n") || node.prompt || "";

    return (
      <div
        id={`canvas-node-${node.id}`}
        className={`absolute glass-panel-heavy rounded-2xl border transition-all select-none flex flex-col overflow-visible ${
          node.status === "loading"
            ? "border-indigo-500/50 shadow-indigo-500/10 shadow-lg ring-2 ring-indigo-500/20"
            : node.status === "error"
            ? "border-rose-500/50 shadow-rose-950/30 shadow-xl"
            : "border-white/10 shadow-2xl"
        }`}
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
          minHeight: node.height,
          zIndex: 10,
        }}
      >
        {/* Node Header - Drag handle */}
        <div 
          onMouseDown={handleMouseDown}
          className={`bg-slate-900/60 border-b border-white/10 px-3.5 py-2.5 flex items-center justify-between select-none shrink-0 ${
            activeTool === "select" ? "cursor-grab active:cursor-grabbing hover:bg-slate-900/80" : "cursor-default"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-100">生图节点 (Text-to-Image)</span>
            {node.status === "loading" && (
              <span className="text-[10px] bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                <span>生成中... ({elapsed}s)</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 no-drag">
            <button
              onClick={() => onDuplicate(node.id)}
              className="text-slate-400 hover:text-indigo-300 hover:bg-white/5 p-1 rounded-lg transition-all cursor-pointer"
              title="复制节点"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(node.id)}
              className="text-slate-400 hover:text-rose-400 hover:bg-white/5 p-1 rounded-lg transition-all cursor-pointer"
              title="删除生图节点"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Node Body Content */}
        <div className="p-4 flex flex-1 flex-col bg-slate-950/25 select-none">
          {/* Loading View */}
          {node.status === "loading" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
              <div className="w-14 h-14 rounded-full border-4 border-white/5 border-t-indigo-500 animate-spin mb-4" />
              <p className="text-sm font-semibold text-slate-100 mb-1">正在调用 gpt-image-2</p>
              <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed mb-4">
                后端接口正在执行渲染。此模型通常生成较慢，请耐心等待。
              </p>
              <div className="text-[11px] font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>已耗时 {elapsed} 秒 / 最长10分钟</span>
              </div>
              <button
                type="button"
                onClick={() => onCancelGeneration(node.id)}
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 cursor-pointer no-drag"
              >
                <X className="w-3.5 h-3.5" />
                <span>取消生成</span>
              </button>
            </div>
          )}

          {/* Error View */}
          {node.status === "error" && (
            <div className="flex-1 flex flex-col items-center justify-center p-5 text-center select-none">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mb-3 border border-rose-500/20">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-rose-400 mb-1">生成失败</p>
              <p className="text-xs text-slate-300 mb-4 max-w-xs leading-relaxed max-h-24 overflow-y-auto border border-white/5 p-2 rounded bg-white/5 font-mono text-left">
                {node.error || "发生了未知错误，请检查网络和 API 配置。"}
              </p>
              <div className="flex gap-2 w-full max-w-[220px]">
                <button
                  onClick={() => {
                    setShowConfig(true);
                    onUpdatePosition(node.id, { status: "idle" });
                  }}
                  className="flex-1 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 text-xs font-semibold transition-all cursor-pointer no-drag flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                  <span>返回修改</span>
                </button>
                <button
                  onClick={() => void generateWithReferenceImage(combinedPrompt)}
                  className="flex-1 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-all cursor-pointer shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5 no-drag"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>重新尝试</span>
                </button>
              </div>
            </div>
          )}

          {/* Empty / Initial Prompt Form Generator */}
          {node.status === "idle" && (
            <div className="flex-1 flex flex-col gap-4 select-none no-drag">
              {/* Display Result Image if generated and we aren't showing config */}
              {node.imageUrl && !showConfig && node.type !== "generator" ? (
                <div className="flex-1 flex flex-col justify-between">
                  {/* Active Image Previewer */}
                  <div className="flex-1 bg-slate-950/45 rounded-xl relative overflow-hidden flex items-center justify-center min-h-[180px] border border-white/5 p-2">
                    <img
                      ref={imageRef}
                      src={node.imageUrl}
                      alt={combinedPrompt || "Generated Image"}
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                      className="max-w-full max-h-full object-contain pointer-events-none select-none rounded-lg"
                    />
                  </div>

                  {/* Multi-Image Thumbnails Grid (if quantity > 1) */}
                  {node.imageUrls && node.imageUrls.length > 1 && (
                    <div className="mt-3 bg-white/5 p-2 rounded-xl border border-white/5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                        画作组 (共 {node.imageUrls.length} 张，点击主图切换)
                      </span>
                      <div className="grid grid-cols-4 gap-1.5">
                        {node.imageUrls.map((url, idx) => {
                          const isActive = node.imageUrl === url;
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                onUpdatePosition(node.id, { imageUrl: url });
                              }}
                              className={`relative aspect-square rounded-lg overflow-hidden border cursor-pointer hover:scale-105 transition-all group ${
                                isActive ? "border-indigo-500 ring-1 ring-indigo-500/30" : "border-white/10"
                              }`}
                            >
                              <img src={url} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                              {onUploadReferenceImage && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUploadReferenceImage(node.id, url);
                                  }}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-[9px] text-white font-bold cursor-pointer"
                                  title="提取为独立图片节点"
                                >
                                  提取
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions for current image */}
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button
                        onClick={handleDownload}
                        className="flex-1 py-2 rounded-xl border border-white/10 text-slate-200 hover:bg-white/10 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5 text-indigo-400" />
                        <span>下载原图</span>
                      </button>
                      
                      {onUploadReferenceImage && (
                        <button
                          onClick={() => onUploadReferenceImage(node.id, node.imageUrl!)}
                          className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/5 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Expand className="w-3.5 h-3.5 text-indigo-400" />
                          <span>提取至画布</span>
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => setShowConfig(true)}
                      className="w-full py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-bold text-xs border border-indigo-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>参数配置 / 再次生成</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Config Form */
                <div className="flex flex-col gap-4">
                  {/* Derived Prompts Container */}
                  <div className="flex flex-col gap-1.5 bg-slate-900/60 border border-white/5 p-3 rounded-xl">
                    <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      <span>连线文本提示词 ({connectedTexts.length} 个)</span>
                    </div>
                    {combinedPrompt ? (
                      <div className="text-xs text-slate-200 bg-black/25 border border-white/5 p-2 rounded-lg max-h-24 overflow-y-auto font-medium leading-relaxed font-mono">
                        {combinedPrompt}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic p-2 border border-dashed border-white/10 rounded-lg bg-black/10">
                        提示：无连线的提示词。请点击底部“便签”添加文本，并从其右上角连线至此节点。
                      </div>
                    )}
                  </div>

                  {/* Model input field */}
                  <div className="flex flex-col gap-1.5 bg-slate-900/40 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                      <span>生图模型 (Model)</span>
                    </span>
                    <select
                      value={`${selectedEndpointId}::${model}`}
                      onChange={(event) => handleModelSelection(event.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors font-mono font-medium no-drag"
                    >
                      {renderModelOptions()}
                    </select>
                  </div>

                  {/* Config Selectors */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">分辨率/画幅 (Size)</span>
                      <select
                        value={aspectRatio}
                        onChange={(e: any) => {
                          const ratio = e.target.value as CanvasAspectRatio;
                          setAspectRatio(ratio);
                          // Suggest node dimensions
                          let width = 450;
                          let height = 450;
                          if (ratio === "16:9" || ratio === "16:9(2k)" || ratio === "16:9(4k)") { width = 560; height = 315; }
                          else if (ratio === "9:16" || ratio === "9:16(2k)" || ratio === "9:16(4k)") { width = 315; height = 560; }
                          else if (ratio === "3:2") { width = 540; height = 360; }
                          else if (ratio === "2:3") { width = 360; height = 540; }
                          else if (ratio === "4:3") { width = 520; height = 390; }
                          else if (ratio === "3:4") { width = 390; height = 520; }
                          onUpdatePosition(node.id, { width, height, aspectRatio: ratio });
                        }}
                        className="w-full p-2 rounded-xl bg-slate-900 border border-white/10 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 cursor-pointer font-semibold"
                      >
                        <option value="auto">Auto (自动)</option>
                        <option value="1:1">1:1 ({IMAGE_SIZE_BY_ASPECT_RATIO["1:1"]})</option>
                        <option value="16:9">16:9 ({IMAGE_SIZE_BY_ASPECT_RATIO["16:9"]})</option>
                        <option value="9:16">9:16 ({IMAGE_SIZE_BY_ASPECT_RATIO["9:16"]})</option>
                        <option value="3:2">3:2 ({IMAGE_SIZE_BY_ASPECT_RATIO["3:2"]})</option>
                        <option value="2:3">2:3 ({IMAGE_SIZE_BY_ASPECT_RATIO["2:3"]})</option>
                        <option value="4:3">4:3 ({IMAGE_SIZE_BY_ASPECT_RATIO["4:3"]})</option>
                        <option value="3:4">3:4 ({IMAGE_SIZE_BY_ASPECT_RATIO["3:4"]})</option>
                        <option value="1:1(2k)">1:1 (2K) ({IMAGE_SIZE_BY_ASPECT_RATIO["1:1(2k)"]})</option>
                        <option value="16:9(2k)">16:9 (2K) ({IMAGE_SIZE_BY_ASPECT_RATIO["16:9(2k)"]})</option>
                        <option value="9:16(2k)">9:16 (2K) ({IMAGE_SIZE_BY_ASPECT_RATIO["9:16(2k)"]})</option>
                        <option value="16:9(4k)">16:9 (4K) ({IMAGE_SIZE_BY_ASPECT_RATIO["16:9(4k)"]})</option>
                        <option value="9:16(4k)">9:16 (4K) ({IMAGE_SIZE_BY_ASPECT_RATIO["9:16(4k)"]})</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">模型质量 (Quality)</span>
                      <select
                        value={quality}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          const nextQuality = e.target.value as NonNullable<CanvasNode["quality"]>;
                          setQuality(nextQuality);
                          onUpdatePosition(node.id, { quality: nextQuality });
                        }}
                        className="w-full p-2 rounded-xl bg-slate-900 border border-white/10 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 cursor-pointer font-semibold"
                      >
                        <option value="auto">Auto (自动)</option>
                        <option value="medium">Medium (中等)</option>
                        <option value="high">High (高质量)</option>
                        <option value="low">Low (低质量)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">生成数量 (Count)</span>
                    <select
                      value={quantity}
                      onChange={(e: any) => {
                        const val = parseInt(e.target.value);
                        setQuantity(val);
                        onUpdatePosition(node.id, { quantity: val });
                      }}
                      className="w-full p-2 rounded-xl bg-slate-900 border border-white/10 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 cursor-pointer font-semibold"
                    >
                      <option value={1}>1 张</option>
                      <option value={2}>2 张</option>
                      <option value={3}>3 张</option>
                      <option value={4}>4 张</option>
                      <option value={5}>5 张</option>
                      <option value={6}>6 张</option>
                      <option value={7}>7 张</option>
                      <option value={8}>8 张</option>
                      <option value={9}>9 张</option>
                      <option value={10}>10 张</option>
                    </select>
                  </div>

                  {/* Buttons group */}
                  <div className="flex flex-col gap-2">
                    {/* Generate Action Button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (!combinedPrompt) return;
                        void generateWithReferenceImage(combinedPrompt);
                      }}
                      disabled={!combinedPrompt}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-white/5 disabled:to-white/5 disabled:text-white/20 text-white font-bold text-xs transition-all shadow-md shadow-indigo-600/20 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>生成绘制 (Generate)</span>
                    </button>

                    {node.imageUrl && node.type !== "generator" && (
                      <button
                        type="button"
                        onClick={() => setShowConfig(false)}
                        className="w-full py-1.5 rounded-lg text-slate-400 hover:text-white text-xs font-semibold cursor-pointer text-center"
                      >
                        返回图片预览
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {connectingFromId && connectingFromId !== node.id && (
          <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 z-50 no-drag">
            <button
              onPointerUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCompleteConnecting(node.id);
              }}
              className="w-3 h-3 rounded-full border-2 border-indigo-300 bg-slate-950 shadow-[0_0_0_3px_rgba(99,102,241,0.3)] cursor-crosshair"
              title="连接到生图节点"
            />
          </div>
        )}
      </div>
    );
  }

  // ==================== BRANCH 4: EDITOR (IMAGE INPAINTING / EDIT) NODE ====================
  if (node.type === "editor") {
    const connectedTexts = incomingNodes.filter((n) => n.type === "text" && n.text?.trim());
    const combinedPrompt = connectedTexts.map((n) => n.text!.trim()).join("\n");

    return (
      <div
        id={`canvas-node-${node.id}`}
        className={`absolute glass-panel-heavy rounded-2xl border transition-all select-none flex flex-col overflow-visible ${
          isEditing ? "ring-2 ring-indigo-500/40 border-indigo-500/50" : ""
        } ${
          node.status === "loading"
            ? "border-emerald-500/50 shadow-emerald-500/10 shadow-lg ring-2 ring-emerald-500/20"
            : node.status === "error"
            ? "border-rose-500/50 shadow-rose-950/30 shadow-xl"
            : "border-white/10 shadow-2xl"
        }`}
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
          minHeight: node.height,
          height: node.status === "loading" ? node.height : undefined,
          zIndex: isEditing ? 30 : 10,
        }}
      >
        {connectingFromId && connectingFromId !== node.id && (
          <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 z-50 no-drag">
            <button
              onPointerUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCompleteConnecting(node.id);
              }}
              className="w-3 h-3 rounded-full border-2 border-emerald-300 bg-slate-950 shadow-[0_0_0_3px_rgba(16,185,129,0.3)] cursor-crosshair"
              title="连接到修改节点"
            />
          </div>
        )}

        {/* Node Header - Drag handle */}
        <div 
          onMouseDown={handleMouseDown}
          className={`bg-slate-900/60 border-b border-white/10 px-3.5 py-2.5 flex items-center justify-between select-none shrink-0 ${
            activeTool === "select" && !isEditing ? "cursor-grab active:cursor-grabbing hover:bg-slate-900/80" : "cursor-default"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-100">修改节点 (Image-to-Image)</span>
            {node.status === "loading" && (
              <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                <span>修图中... ({elapsed}s)</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 no-drag">
            <button
              onClick={() => onDuplicate(node.id)}
              className="text-slate-400 hover:text-indigo-300 hover:bg-white/5 p-1 rounded-lg transition-all cursor-pointer"
              title="复制节点"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(node.id)}
              className="text-slate-400 hover:text-rose-400 hover:bg-white/5 p-1 rounded-lg transition-all cursor-pointer"
              title="删除修改节点"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Node Body Content */}
        <div className="p-4 flex flex-1 flex-col bg-slate-950/25 select-none">
          {/* Loading View */}
          {node.status === "loading" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
              <div className="w-14 h-14 rounded-full border-4 border-white/5 border-t-emerald-500 animate-spin mb-4" />
              <p className="text-sm font-semibold text-slate-100 mb-1">正在调用 gpt-image-2</p>
              <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed mb-4">
                后端修改接口耗时较长，模型正在根据涂抹遮罩及指令进行局部编辑，请耐心等待。
              </p>
              <div className="text-[11px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>已耗时 {elapsed} 秒 / 最长10分钟</span>
              </div>
              <button
                type="button"
                onClick={() => onCancelGeneration(node.id)}
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 cursor-pointer no-drag"
              >
                <X className="w-3.5 h-3.5" />
                <span>取消生成</span>
              </button>
            </div>
          )}

          {/* Error View */}
          {node.status === "error" && (
            <div className="flex-1 flex flex-col items-center justify-center p-5 text-center select-none">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mb-3 border border-rose-500/20">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-rose-400 mb-1">修改失败</p>
              <p className="text-xs text-slate-300 mb-4 max-w-xs leading-relaxed max-h-24 overflow-y-auto border border-white/5 p-2 rounded bg-white/5 font-mono text-left">
                {node.error || "发生了未知错误，请检查网络 and API 配置。"}
              </p>
              <div className="flex gap-2 w-full max-w-[220px]">
                <button
                  onClick={() => {
                    setShowConfig(true);
                    onUpdatePosition(node.id, { status: "idle" });
                  }}
                  className="flex-1 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 text-xs font-semibold transition-all cursor-pointer no-drag flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                  <span>返回修改</span>
                </button>
                <button
                  onClick={handleApplyEdit}
                  className="flex-1 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-all cursor-pointer shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 no-drag"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>重新尝试</span>
                </button>
              </div>
            </div>
          )}

          {/* Core Edit Workspace */}
          {node.status === "idle" && (
            <div className="flex-1 flex flex-col gap-3.5 select-none no-drag text-slate-100">
              {/* If we have a generated result image and aren't showing mask/config editor */}
              {node.imageUrl && !showConfig ? (
                <div className="flex-1 flex flex-col justify-between">
                  {/* Active Edited Image Previewer */}
                  <div className="flex-1 bg-slate-950/45 rounded-xl relative overflow-hidden flex items-center justify-center min-h-[180px] border border-white/5 p-2">
                    <img
                      ref={imageRef}
                      src={node.imageUrl}
                      alt={combinedPrompt || "Edited Image"}
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                      className="max-w-full max-h-full object-contain pointer-events-none select-none rounded-lg"
                    />
                  </div>

                  {/* Multi-Image Thumbnails Grid (if quantity > 1) */}
                  {node.imageUrls && node.imageUrls.length > 1 && (
                    <div className="mt-3 bg-white/5 p-2 rounded-xl border border-white/5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                        修改画作组 (共 {node.imageUrls.length} 张，点击主图切换)
                      </span>
                      <div className="grid grid-cols-4 gap-1.5">
                        {node.imageUrls.map((url, idx) => {
                          const isActive = node.imageUrl === url;
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                onUpdatePosition(node.id, { imageUrl: url });
                              }}
                              className={`relative aspect-square rounded-lg overflow-hidden border cursor-pointer hover:scale-105 transition-all group ${
                                isActive ? "border-emerald-500 ring-1 ring-emerald-500/30" : "border-white/10"
                              }`}
                            >
                              <img src={url} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                              {onUploadReferenceImage && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUploadReferenceImage(node.id, url);
                                  }}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-[9px] text-white font-bold cursor-pointer"
                                  title="提取为独立图片节点"
                                >
                                  提取
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions for current edited image */}
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button
                        onClick={handleDownload}
                        className="flex-1 py-2 rounded-xl border border-white/10 text-slate-200 hover:bg-white/10 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>下载修改图</span>
                      </button>
                      
                      {onUploadReferenceImage && (
                        <button
                          onClick={() => onUploadReferenceImage(node.id, node.imageUrl!)}
                          className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/5 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Expand className="w-3.5 h-3.5 text-emerald-400" />
                          <span>提取至画布</span>
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => setShowConfig(true)}
                      className="w-full py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-bold text-xs border border-emerald-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>参数 / 继续涂抹修改</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Otherwise, show mask painter and config selectors */
                <div className="flex-1 flex flex-col gap-3.5">
                  {/* If no image connected */}
                  {!inputImage ? (
                    <div className="flex-1 min-h-[160px] border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center p-5 text-center bg-slate-900/20">
                      <ImageIcon className="w-8 h-8 text-slate-500 mb-2.5 animate-pulse" />
                      <p className="text-xs font-semibold text-slate-300 mb-1">未关联输入图片</p>
                      <p className="text-[10.5px] text-slate-500 max-w-[220px] leading-relaxed mb-4">
                        修改节点仅允许输入<b>一张</b>图片。请从其他图片节点的右上角“连线”到此。
                      </p>
                      <button
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/*";
                          input.onchange = (e: any) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const result = event.target?.result as string;
                              if (result && onUploadReferenceImage) {
                                onUploadReferenceImage(node.id, result);
                              }
                            };
                            reader.readAsDataURL(file);
                          };
                          input.click();
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold text-[10.5px] border border-white/5 hover:border-emerald-500/20 transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>上传图片作为输入</span>
                      </button>
                    </div>
                  ) : (
                    // If input image exists, display image with drawing canvas overlay option
                    <div className="flex-1 flex flex-col">
                      {/* Image and brush overlay area */}
                      <div className="flex-1 bg-slate-950/40 rounded-xl relative overflow-hidden flex items-center justify-center min-h-[140px] border border-white/5">
                        <img
                          ref={imageRef}
                          src={inputImage.imageUrl}
                          alt="Source Input for Edit"
                          referrerPolicy="no-referrer"
                          crossOrigin="anonymous"
                          className="max-w-full max-h-full object-contain pointer-events-none select-none"
                        />

                        {!isEditing && savedMaskBase64 && (
                          <img
                            src={savedMaskBase64}
                            alt="已保存的涂抹蒙版预览"
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none opacity-50"
                          />
                        )}

                        {!isEditing && savedMaskBase64 && (
                          <span className="absolute top-2 left-2 rounded-md bg-emerald-500/85 px-2 py-1 text-[10px] font-semibold text-white pointer-events-none">
                            已保存涂抹
                          </span>
                        )}

                        {/* Canvas Mask Draw overlay */}
                        {isEditing && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center select-none no-drag">
                            <canvas
                              ref={maskCanvasRef}
                              onMouseDown={handleDrawStart}
                              onMouseMove={handleDrawMove}
                              onMouseUp={handleDrawEnd}
                              onMouseLeave={handleDrawEnd}
                              className="absolute cursor-crosshair max-w-full max-h-full object-contain"
                              style={{
                                width: imageRef.current?.clientWidth,
                                height: imageRef.current?.clientHeight,
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveMask()}
                              className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 transition-colors cursor-pointer"
                            >
                              保存涂抹
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Editing Tool Controls toggle */}
                      {!isEditing ? (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="mt-3 py-2 w-full rounded-xl border border-white/10 text-slate-200 hover:bg-white/10 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Brush className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                          <span>进入局部涂抹模式 (Start Painting Mask)</span>
                        </button>
                      ) : (
                        <div className="mt-3 flex flex-col gap-2.5 bg-white/5 p-2.5 rounded-xl border border-white/5">
                          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
                            <span className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-400">画笔工具:</span>
                              <button
                                onClick={() => setEditTool("brush")}
                                className={`px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-all ${
                                  editTool === "brush" ? "bg-emerald-600 text-white" : "hover:bg-white/10 text-slate-300"
                                }`}
                              >
                                画笔
                              </button>
                              <button
                                onClick={() => setEditTool("eraser")}
                                className={`px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-all ${
                                  editTool === "eraser" ? "bg-emerald-600 text-white" : "hover:bg-white/10 text-slate-300"
                                }`}
                              >
                                橡皮擦
                              </button>
                            </span>
                            <button
                              onClick={handleClearMask}
                              className="text-slate-400 hover:text-rose-400 transition-colors cursor-pointer text-[10px]"
                            >
                              重置涂抹
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 shrink-0">画笔粗细: {brushSize}px</span>
                            <input
                              type="range"
                              min="5"
                              max="80"
                              value={brushSize}
                              onChange={(e) => setBrushSize(Number(e.target.value))}
                              className="flex-1 accent-emerald-500 h-1 rounded-lg cursor-pointer bg-white/10"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Derived Prompts Container for Instructions */}
                  <div className="flex flex-col gap-1.5 bg-slate-900/60 border border-white/5 p-3 rounded-xl">
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                      <FileText className="w-3.5 h-3.5 text-emerald-400" />
                      <span>连线文本修改指令 ({connectedTexts.length} 个)</span>
                    </div>
                    {combinedPrompt ? (
                      <div className="text-xs text-slate-200 bg-black/25 border border-white/5 p-2 rounded-lg max-h-20 overflow-y-auto font-medium leading-relaxed font-mono">
                        {combinedPrompt}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic p-2 border border-dashed border-white/10 rounded-lg bg-black/10">
                        提示：无连线的指令便签。请点击底部“便签”添加文本，并从其右上角连线至此。
                      </div>
                    )}
                    {editError && <p className="text-[10px] text-rose-400 font-medium">{editError}</p>}
                  </div>

                  {/* Model input field */}
                  <div className="flex flex-col gap-1.5 bg-slate-900/40 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      <span>修改模型 (Model)</span>
                    </span>
                    <select
                      value={`${selectedEndpointId}::${model}`}
                      onChange={(event) => handleModelSelection(event.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono font-medium no-drag"
                    >
                      {renderModelOptions()}
                    </select>
                  </div>

                  {/* Config Selectors - Quality, Quantity */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">质量 (Quality)</span>
                      <select
                        value={quality}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          const nextQuality = e.target.value as NonNullable<CanvasNode["quality"]>;
                          setQuality(nextQuality);
                          onUpdatePosition(node.id, { quality: nextQuality });
                        }}
                        className="w-full p-1.5 rounded-xl bg-slate-900 border border-white/10 text-[11px] text-slate-200 focus:outline-none cursor-pointer font-semibold"
                      >
                        <option value="auto">Auto (自动)</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="low">Low</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">数量 (Count)</span>
                      <select
                        value={quantity}
                        onChange={(e: any) => {
                          const val = parseInt(e.target.value);
                          setQuantity(val);
                          onUpdatePosition(node.id, { quantity: val });
                        }}
                        className="w-full p-1.5 rounded-xl bg-slate-900 border border-white/10 text-[11px] text-slate-200 focus:outline-none cursor-pointer font-semibold"
                      >
                        <option value={1}>1 张</option>
                        <option value={2}>2 张</option>
                        <option value={3}>3 张</option>
                        <option value={4}>4 张</option>
                        <option value={5}>5 张</option>
                        <option value={6}>6 张</option>
                        <option value={7}>7 张</option>
                        <option value={8}>8 张</option>
                        <option value={9}>9 张</option>
                        <option value={10}>10 张</option>
                      </select>
                    </div>
                  </div>

                  {/* Submit / Trigger Edit */}
                  {inputImage && (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <button
                          onClick={handleApplyEdit}
                          disabled={isPreparingEdit || !combinedPrompt}
                          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-white/5 disabled:to-white/5 disabled:text-white/20 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1"
                        >
                          {isPreparingEdit ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>正在处理图片...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>生成修改 (Modify)</span>
                            </>
                          )}
                        </button>
                      </div>

                      {node.imageUrl && (
                        <button
                          type="button"
                          onClick={() => setShowConfig(false)}
                          className="w-full py-1 rounded-lg text-slate-400 hover:text-white text-xs font-semibold cursor-pointer text-center"
                        >
                          返回修改图预览
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Fallback rendering
  return null;
}
