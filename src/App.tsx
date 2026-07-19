import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Eye,
  Plus,
  Info,
  Move,
  Layers,
  HelpCircle,
  Check,
  AlertCircle,
  FolderOpen,
  Save,
  Trash2,
  FolderPlus,
  Archive,
  ChevronLeft,
  Home,
  Settings,
  Images,
  X
} from "lucide-react";
import { CanvasNode, CanvasTool, AppConfig, ApiEndpoint, CanvasConnection, CanvasProject } from "./types";
import { getImageAssetUrl, saveImageAsset } from "./assets";
import SettingsPanel from "./components/SettingsPanel";
import AssetManager from "./components/AssetManager";
import Toolbar from "./components/Toolbar";
import ImageNode from "./components/ImageNode";
import packageMetadata from "../package.json";

const isTemporaryImageUrl = (value?: string) => value?.startsWith("data:") || value?.startsWith("blob:") || false;

const defaultEndpoint: ApiEndpoint = {
  id: "openai-default",
  name: "OpenAI",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  models: ["gpt-image-2"],
};

const defaultConfig: AppConfig = { endpoints: [defaultEndpoint], defaultEndpointId: defaultEndpoint.id };

function normalizeConfig(value: unknown): AppConfig {
  if (value && typeof value === "object" && "endpoints" in value) {
    const config = value as AppConfig;
    if (config.endpoints.length) return config;
  }
  const legacy = value as { apiKey?: string; baseUrl?: string; model?: string } | null;
  if (legacy) {
    return {
      endpoints: [{ ...defaultEndpoint, apiKey: legacy.apiKey || "", baseUrl: legacy.baseUrl || defaultEndpoint.baseUrl, models: [legacy.model || "gpt-image-2"] }],
      defaultEndpointId: defaultEndpoint.id,
    };
  }
  return defaultConfig;
}

function nodeForLocalStorage(node: CanvasNode): CanvasNode {
  const imageUrl = isTemporaryImageUrl(node.imageUrl) ? undefined : node.imageUrl;
  const originalImageUrl = isTemporaryImageUrl(node.originalImageUrl) ? undefined : node.originalImageUrl;
  const imageUrls = node.imageUrls?.filter((url) => !isTemporaryImageUrl(url));

  return {
    ...node,
    imageUrl,
    originalImageUrl,
    imageUrls: imageUrls?.length ? imageUrls : undefined,
  };
}

function saveToLocalStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Unable to save ${key} to local storage.`, error);
  }
}

export default function App() {
  // 1. App API Config State
  const [config, setConfig] = useState<AppConfig>(() => {
    const saved = localStorage.getItem("gpt_image_config");
    if (saved) {
      try {
        return normalizeConfig(JSON.parse(saved));
      } catch (e) {}
    }
    return defaultConfig;
  });

  const handleUpdateConfig = (newConfig: AppConfig) => {
    setConfig(newConfig);
    localStorage.setItem("gpt_image_config", JSON.stringify(newConfig));
  };

  const defaultEndpointConfig = config.endpoints.find((endpoint) => endpoint.id === config.defaultEndpointId) || config.endpoints[0] || defaultEndpoint;

  // 2. Infinite Canvas Viewport State (Zoom & Pan)
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Canvas container ref for viewport measurements
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // 2.1 Project Management State
  const [projects, setProjects] = useState<CanvasProject[]>(() => {
    const saved = localStorage.getItem("gpt_image_projects");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [];
  });

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => {
    return localStorage.getItem("gpt_image_current_project_id");
  });

  const currentProject = projects.find((project) => project.id === currentProjectId);
  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [showBanner, setShowBanner] = useState(true);
  const [homeView, setHomeView] = useState<"home" | "settings" | "assets">("home");
  const [returnProjectId, setReturnProjectId] = useState<string | null>(null);

  const returnToPreviousView = () => {
    if (returnProjectId) {
      setCurrentProjectId(returnProjectId);
      localStorage.setItem("gpt_image_current_project_id", returnProjectId);
      setReturnProjectId(null);
      setHomeView("home");
      return;
    }
    setHomeView("home");
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowBanner(false);
    }, 6000);
    return () => clearTimeout(timer);
  }, []);

  // Center the view or load project's camera on startup
  useEffect(() => {
    const activeProjId = localStorage.getItem("gpt_image_current_project_id");
    if (activeProjId) {
      const savedProjs = localStorage.getItem("gpt_image_projects");
      if (savedProjs) {
        try {
          const projs = JSON.parse(savedProjs) as CanvasProject[];
          const found = projs.find((p) => p.id === activeProjId);
          if (found) {
            setPanX(found.panX);
            setPanY(found.panY);
            setZoom(found.zoom);
            return;
          }
        } catch (e) {}
      }
    }

    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      // We want to center the coordinates (0, 0)
      setPanX(clientWidth / 2 - 225); // Node is 450px wide
      setPanY(clientHeight / 2 - 250); // Node is ~500px tall
    }
  }, []);

  // 3. Nodes and Connections States with durable Local Storage syncing
  const [nodes, setNodes] = useState<CanvasNode[]>(() => {
    const activeProjId = localStorage.getItem("gpt_image_current_project_id");
    if (activeProjId) {
      const savedProjs = localStorage.getItem("gpt_image_projects");
      if (savedProjs) {
        try {
          const projs = JSON.parse(savedProjs) as CanvasProject[];
          const found = projs.find((p) => p.id === activeProjId);
          if (found) return found.nodes;
        } catch (e) {}
      }
    }

    const saved = localStorage.getItem("gpt_image_nodes");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [
      {
        id: "node-init",
        type: "generator",
        x: 0,
        y: 0,
        width: 450,
        height: 480,
        prompt: "A beautiful cinematic digital painting of a fantasy crystal cave, bioluminescent lighting, mysterious atmosphere, highly detailed, 8k resolution, artstation trend",
        status: "idle",
        aspectRatio: "1:1",
        model: defaultEndpoint.models[0],
        endpointId: defaultEndpoint.id,
        createdAt: Date.now(),
      },
    ];
  });

  const assetObjectUrlsRef = useRef(new Set<string>());
  const generationControllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    let cancelled = false;
    const nodesToHydrate = nodes.filter((node) =>
      (node.assetId && !node.imageUrl) || (node.assetIds?.length && !node.imageUrls)
    );
    if (!nodesToHydrate.length) return;

    Promise.all(nodesToHydrate.map(async (node) => {
      const assetIds = node.assetIds?.length ? node.assetIds : node.assetId ? [node.assetId] : [];
      const imageUrls = (await Promise.all(assetIds.map(getImageAssetUrl))).filter((url): url is string => Boolean(url));
      return { id: node.id, imageUrls, imageUrl: imageUrls[0] };
    })).then((hydratedNodes) => {
      if (cancelled) return;
      hydratedNodes.forEach((node) => {
        if (node.imageUrl) assetObjectUrlsRef.current.add(node.imageUrl);
      });
      setNodes((previousNodes) => previousNodes.map((node) => {
        const hydratedNode = hydratedNodes.find((item) => item.id === node.id);
        if (!hydratedNode?.imageUrl) return node;
        return {
          ...node,
          imageUrl: node.imageUrl || hydratedNode.imageUrl,
          imageUrls: node.imageUrls || (node.assetIds ? hydratedNode.imageUrls : node.imageUrls),
        };
      }));
    }).catch((error) => console.warn("Unable to restore locally stored image assets.", error));

    return () => {
      cancelled = true;
    };
  }, [nodes]);

  useEffect(() => () => {
    assetObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => () => {
    generationControllersRef.current.forEach((controller) => controller.abort());
  }, []);

  const [connections, setConnections] = useState<CanvasConnection[]>(() => {
    const activeProjId = localStorage.getItem("gpt_image_current_project_id");
    if (activeProjId) {
      const savedProjs = localStorage.getItem("gpt_image_projects");
      if (savedProjs) {
        try {
          const projs = JSON.parse(savedProjs) as CanvasProject[];
          const found = projs.find((p) => p.id === activeProjId);
          if (found) return found.connections;
        } catch (e) {}
      }
    }

    const saved = localStorage.getItem("gpt_image_connections");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [];
  });

  // Saving state changes to local storage (only if NOT running in active project mode)
  useEffect(() => {
    if (!currentProjectId) {
      saveToLocalStorage("gpt_image_nodes", nodes.map(nodeForLocalStorage));
    }
  }, [nodes, currentProjectId]);

  useEffect(() => {
    if (!currentProjectId) {
      localStorage.setItem("gpt_image_connections", JSON.stringify(connections));
    }
  }, [connections, currentProjectId]);

  // Auto-save project edits
  useEffect(() => {
    if (currentProjectId && projects.length > 0) {
      const activeProj = projects.find((p) => p.id === currentProjectId);
      if (activeProj) {
        const hasNodesChanged = JSON.stringify(activeProj.nodes) !== JSON.stringify(nodes);
        const hasConnsChanged = JSON.stringify(activeProj.connections) !== JSON.stringify(connections);
        const hasPanChanged = activeProj.panX !== panX || activeProj.panY !== panY;
        const hasZoomChanged = activeProj.zoom !== zoom;

        if (hasNodesChanged || hasConnsChanged || hasPanChanged || hasZoomChanged) {
          setProjects((prev) => {
            const updated = prev.map((p) => {
              if (p.id === currentProjectId) {
                return {
                  ...p,
                  nodes,
                  connections,
                  panX,
                  panY,
                  zoom,
                  updatedAt: Date.now(),
                };
              }
              return p;
            });
            saveToLocalStorage("gpt_image_projects", updated.map((project) => ({
              ...project,
              nodes: project.nodes.map(nodeForLocalStorage),
            })));
            return updated;
          });
        }
      }
    }
  }, [nodes, connections, panX, panY, zoom, currentProjectId, projects]);

  // Project management actions
  const handleCreateNewProject = (name: string) => {
    const id = `project-${Date.now()}`;
    const newProj: CanvasProject = {
      id,
      name: name.trim() || `新画布项目 ${new Date().toLocaleDateString()}`,
      nodes: [],
      connections: [],
      panX: 100,
      panY: 100,
      zoom: 1.0,
      updatedAt: Date.now(),
    };

    setProjects((prev) => {
      const updated = [...prev, newProj];
      saveToLocalStorage("gpt_image_projects", updated.map((project) => ({
        ...project,
        nodes: project.nodes.map(nodeForLocalStorage),
      })));
      return updated;
    });

    setCurrentProjectId(id);
    localStorage.setItem("gpt_image_current_project_id", id);
    setNodes(newProj.nodes);
    setConnections(newProj.connections);
    setPanX(newProj.panX);
    setPanY(newProj.panY);
    setZoom(newProj.zoom);
  };

  const handleLoadProject = (id: string) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;

    setCurrentProjectId(proj.id);
    localStorage.setItem("gpt_image_current_project_id", proj.id);
    setNodes(proj.nodes);
    setConnections(proj.connections);
    setPanX(proj.panX);
    setPanY(proj.panY);
    setZoom(proj.zoom);
  };

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProjects((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      saveToLocalStorage("gpt_image_projects", updated.map((project) => ({
        ...project,
        nodes: project.nodes.map(nodeForLocalStorage),
      })));
      return updated;
    });

    if (currentProjectId === id) {
      setCurrentProjectId(null);
      localStorage.removeItem("gpt_image_current_project_id");
    }
  };

  const handleSaveCurrentAsNewProject = (name: string) => {
    const id = `project-${Date.now()}`;
    const newProj: CanvasProject = {
      id,
      name: name.trim() || `画布项目 ${new Date().toLocaleDateString()}`,
      nodes,
      connections,
      panX,
      panY,
      zoom,
      updatedAt: Date.now(),
    };

    setProjects((prev) => {
      const updated = [...prev, newProj];
      saveToLocalStorage("gpt_image_projects", updated.map((project) => ({
        ...project,
        nodes: project.nodes.map(nodeForLocalStorage),
      })));
      return updated;
    });

    setCurrentProjectId(id);
    localStorage.setItem("gpt_image_current_project_id", id);
  };

  // Connection Linking Modes States
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [connectionCursor, setConnectionCursor] = useState<{ x: number; y: number } | null>(null);
  const [connectionActionsFromId, setConnectionActionsFromId] = useState<string | null>(null);

  const handleStartConnecting = (fromId: string, clientX?: number, clientY?: number) => {
    const sourceNode = nodes.find((node) => node.id === fromId);
    if (sourceNode?.type === "image" && sourceNode.isStandaloneImage === false) return;

    setConnectionActionsFromId((previousId) => previousId === fromId ? null : fromId);
    setConnectingFromId(fromId);
    if (clientX !== undefined && clientY !== undefined && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setConnectionCursor({ x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom });

      const handlePointerMove = (event: PointerEvent) => {
        setConnectionCursor({ x: (event.clientX - rect.left - panX) / zoom, y: (event.clientY - rect.top - panY) / zoom });
      };
      const handlePointerUp = () => {
        setConnectingFromId(null);
        setConnectionCursor(null);
        document.removeEventListener("pointermove", handlePointerMove);
      };
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp, { once: true });
    }
  };

  const handleCompleteConnecting = (toId: string) => {
    if (!connectingFromId || connectingFromId === toId) {
      setConnectingFromId(null);
      setConnectionCursor(null);
      setConnectionActionsFromId(null);
      return;
    }

    const sourceNode = nodes.find((node) => node.id === connectingFromId);
    const targetNode = nodes.find((node) => node.id === toId);
    if (
      !sourceNode
      || !targetNode
      || !["text", "image"].includes(sourceNode.type)
      || (sourceNode.type === "image" && sourceNode.isStandaloneImage === false)
      || !["generator", "editor"].includes(targetNode.type)
    ) {
      setConnectingFromId(null);
      setConnectionCursor(null);
      setConnectionActionsFromId(null);
      return;
    }

    setConnections((prev) => {
      const exists = prev.some((c) => c.fromId === connectingFromId && c.toId === toId);
      if (exists) return prev;

      const incomingNodes = prev
        .filter((connection) => connection.toId === toId)
        .map((connection) => nodes.find((node) => node.id === connection.fromId));
      const sourceLimit = targetNode.type === "editor" || sourceNode.type === "text" ? 1 : Infinity;
      const hasReachedLimit = incomingNodes.filter((node) => node?.type === sourceNode.type).length >= sourceLimit;
      if (hasReachedLimit) return prev;

      return [...prev, { id: `conn-${Date.now()}`, fromId: connectingFromId, toId }];
    });
    setConnectingFromId(null);
    setConnectionCursor(null);
    setConnectionActionsFromId(null);
  };

  const handleRemoveConnection = (connectionId: string) => {
    setConnections((prev) => prev.filter((connection) => connection.id !== connectionId));
  };

  // 4. Hotkeys Setup (V: Select, H: Pan, Space: Temporary Pan, R: Recenter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      // Ignore shortcut hotkeys if the user is typing in an input or textarea
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.getAttribute("contenteditable") === "true")
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        setIsSpacePressed(true);
      } else if (e.key.toLowerCase() === "v") {
        setActiveTool("select");
      } else if (e.key.toLowerCase() === "h") {
        setActiveTool("pan");
      } else if (e.key.toLowerCase() === "r") {
        handleRecenter();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Recenter the canvas
  const handleRecenter = () => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      setZoom(1.0);
      setPanX(clientWidth / 2 - 225);
      setPanY(clientHeight / 2 - 250);
    }
  };

  // Clear Canvas (except resetting back to one clean template)
  const handleClearCanvas = () => {
    if (window.confirm("确定要清空画布吗？这将会删除所有生成内容。")) {
      setNodes([
        {
          id: `node-${Date.now()}`,
          type: "generator",
          x: 0,
          y: 0,
          width: 450,
          height: 480,
          prompt: "",
          status: "idle",
          aspectRatio: "1:1",
          model: "gpt-image-2",
          createdAt: Date.now(),
        },
      ]);
      setConnections([]);
      handleRecenter();
    }
  };

  // Add a new generator node manually in current screen center (Text-to-Image Controller)
  const handleAddGeneratorNode = () => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      // Find the center in Canvas coordinates
      const cx = (clientWidth / 2 - panX) / zoom;
      const cy = (clientHeight / 2 - panY) / zoom;
      const offset = (nodes.length % 8) * 30;

      const newNode: CanvasNode = {
        id: `node-gen-${Date.now()}`,
        type: "generator",
        x: Math.round(cx - 225) + offset,
        y: Math.round(cy - 240) + offset,
        width: 450,
        height: 480,
        prompt: "",
        status: "idle",
        aspectRatio: "1:1",
        model: defaultEndpointConfig.models[0] || "gpt-image-2",
        endpointId: defaultEndpointConfig.id,
        createdAt: Date.now(),
      };

      setNodes((prev) => [...prev, newNode]);
    }
  };

  // Add a new editor node manually in current screen center (Image-to-Image / Mask Edit Controller)
  const handleAddEditorNode = () => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const cx = (clientWidth / 2 - panX) / zoom;
      const cy = (clientHeight / 2 - panY) / zoom;
      const offset = (nodes.length % 8) * 30;

      const newNode: CanvasNode = {
        id: `node-editor-${Date.now()}`,
        type: "editor",
        x: Math.round(cx - 225) + offset,
        y: Math.round(cy - 260) + offset,
        width: 450,
        height: 520,
        prompt: "",
        status: "idle",
        aspectRatio: "1:1",
        model: defaultEndpointConfig.models[0] || "gpt-image-2",
        endpointId: defaultEndpointConfig.id,
        createdAt: Date.now(),
      };

      setNodes((prev) => [...prev, newNode]);
    }
  };

  // Add a new text node manually in current screen center
  const handleAddTextNode = (text = "") => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const cx = (clientWidth / 2 - panX) / zoom;
      const cy = (clientHeight / 2 - panY) / zoom;
      const offset = (nodes.length % 8) * 30;

      const newNode: CanvasNode = {
        id: `node-text-${Date.now()}`,
        type: "text",
        x: Math.round(cx - 150) + offset,
        y: Math.round(cy - 120) + offset,
        width: 300,
        height: 240,
        prompt: "slate", // Default color class identifier
        text,
        status: "idle",
        aspectRatio: "1:1",
        model: "none",
        createdAt: Date.now(),
      };

      setNodes((prev) => [...prev, newNode]);
    }
  };

  // Add a reference image node from upload
  const handleUploadImageNode = async (base64Url: string) => {
    if (containerRef.current) {
      const assetId = await saveImageAsset(base64Url);
      const imageUrl = await getImageAssetUrl(assetId);
      if (!imageUrl) throw new Error("Unable to load the uploaded image asset.");
      assetObjectUrlsRef.current.add(imageUrl);
      const { clientWidth, clientHeight } = containerRef.current;
      const cx = (clientWidth / 2 - panX) / zoom;
      const cy = (clientHeight / 2 - panY) / zoom;
      const offset = (nodes.length % 8) * 30;

      const newNode: CanvasNode = {
        id: `node-img-${Date.now()}`,
        type: "image",
        x: Math.round(cx - 200) + offset,
        y: Math.round(cy - 210) + offset,
        width: 400,
        height: 420,
        prompt: "",
        imageUrl,
        assetId,
        isStandaloneImage: true,
        status: "idle",
        aspectRatio: "1:1",
        model: "none",
        createdAt: Date.now(),
      };

      setNodes((prev) => [...prev, newNode]);
    }
  };

  const handleCanvasPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;

    const clipboardItems = Array.from(event.clipboardData.items as ArrayLike<DataTransferItem>);
    const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const imageFile = imageItem.getAsFile();
      if (!imageFile) return;

      event.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          void handleUploadImageNode(reader.result);
        }
      };
      reader.readAsDataURL(imageFile);
      return;
    }

    const text = event.clipboardData.getData("text/plain").trim();
    if (text) {
      event.preventDefault();
      handleAddTextNode(text);
    }
  };

  // Embedded file upload inside generator node: places an image node right next to it and connects
  const handleUploadReferenceImage = async (generatorId: string, base64Url: string) => {
    const generatorNode = nodes.find((n) => n.id === generatorId);
    if (!generatorNode) return;

    const assetId = await saveImageAsset(base64Url);
    const imageUrl = await getImageAssetUrl(assetId);
    if (!imageUrl) throw new Error("Unable to load the uploaded image asset.");
    assetObjectUrlsRef.current.add(imageUrl);

    const newImgId = `node-img-${Date.now()}`;
    const newImgNode: CanvasNode = {
      id: newImgId,
      type: "image",
      x: generatorNode.x - 450, // Spawn on left of generator node
      y: generatorNode.y + 30,
      width: 400,
      height: 420,
      prompt: "",
      imageUrl,
      assetId,
      isStandaloneImage: true,
      status: "idle",
      aspectRatio: "1:1",
      model: "none",
      createdAt: Date.now(),
    };

    setNodes((prev) => [...prev, newImgNode]);
    setConnections((prev) => [
      ...prev,
      { id: `conn-${Date.now()}`, fromId: newImgId, toId: generatorId },
    ]);
  };

  // Double Click empty canvas to spawn node at mouse position
  const handleDoubleClickCanvas = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Ensure we are double clicking the grid, not any nodes or panels
    if (target.id !== "infinite-grid-viewport" && target.id !== "infinite-grid-bg") return;

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Translate screen coordinates to canvas coordinates
      const cx = (mouseX - panX) / zoom;
      const cy = (mouseY - panY) / zoom;
      const offset = (nodes.length % 8) * 30;

      const newNode: CanvasNode = {
        id: `node-gen-${Date.now()}`,
        type: "generator",
        x: Math.round(cx - 225) + offset,
        y: Math.round(cy - 240) + offset,
        width: 450,
        height: 480,
        prompt: "",
        status: "idle",
        aspectRatio: "1:1",
        model: defaultEndpointConfig.models[0] || "gpt-image-2",
        endpointId: defaultEndpointConfig.id,
        createdAt: Date.now(),
      };

      setNodes((prev) => [...prev, newNode]);
    }
  };

  // 5. Zoom Handler (Centered on cursor)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Canvas coordinates under mouse before zoom
    const cx = (mouseX - panX) / zoom;
    const cy = (mouseY - panY) / zoom;

    // Zoom multiplier
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.min(Math.max(zoom * factor, 0.15), 3.0);

    // Adjust pans so same canvas location stays under mouse
    setZoom(nextZoom);
    setPanX(mouseX - cx * nextZoom);
    setPanY(mouseY - cy * nextZoom);
  };

  // 6. Pan drag handlers (Middle click or Space+click or Hand Tool)
  const handleMouseDownCanvas = (e: React.MouseEvent) => {
    const isMiddleClick = e.button === 1;
    const isHandMode = activeTool === "pan" || isSpacePressed;
    const isLeftClickOnBackground = e.button === 0 && (e.target as HTMLElement).id === "infinite-grid-viewport";

    if (isMiddleClick || isHandMode || isLeftClickOnBackground) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - panX, y: e.clientY - panY };
      document.addEventListener("mousemove", handleMouseMoveCanvas);
      document.addEventListener("mouseup", handleMouseUpCanvas);
    }
  };

  const handleMouseMoveCanvas = (e: MouseEvent) => {
    if (!isPanningRef.current) return;
    setPanX(e.clientX - panStartRef.current.x);
    setPanY(e.clientY - panStartRef.current.y);
  };

  const handleMouseUpCanvas = () => {
    isPanningRef.current = false;
    document.removeEventListener("mousemove", handleMouseMoveCanvas);
    document.removeEventListener("mouseup", handleMouseUpCanvas);
  };

  // 7. Core API Integration

  // Text-To-Image Call
  const handleGenerateImage = async (nodeId: string, prompt: string, options: any) => {
    const generatorNode = nodes.find((node) => node.id === nodeId);
    if (!generatorNode) return;
    const endpoint = config.endpoints.find((item) => item.id === generatorNode.endpointId) || defaultEndpointConfig;

    generationControllersRef.current.get(nodeId)?.abort();
    const controller = new AbortController();
    generationControllersRef.current.set(nodeId, controller);

    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, status: "loading", prompt, error: undefined } : n))
    );

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (endpoint.apiKey) {
        headers["x-api-key"] = endpoint.apiKey;
      }
      if (endpoint.baseUrl) {
        headers["x-base-url"] = endpoint.baseUrl;
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers,
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

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || errData.error || `Server error code ${response.status}`);
      }

      const resJson = await response.json();
      const imageUrls = resJson.data?.map((item: any) => item.url).filter(Boolean) || [];

      if (!imageUrls.length) {
        throw new Error("No image URL was returned in the API response.");
      }

      const generatedAt = Date.now();
      const outputNodes: CanvasNode[] = await Promise.all(imageUrls.map(async (sourceUrl: string, index: number) => {
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

      setNodes((prev) => [
        ...prev.map((node) => node.id === nodeId ? {
          ...node,
          status: "idle",
          prompt,
          imageUrl: undefined,
          originalImageUrl: undefined,
          imageUrls: undefined,
        } : node),
        ...outputNodes,
      ]);
      setConnections((prev) => [
        ...prev,
        ...outputNodes.map((outputNode, index) => ({
          id: `conn-output-${generatedAt}-${index}`,
          fromId: nodeId,
          toId: outputNode.id,
        })),
      ]);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error(err);
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, status: "error", error: err.message || "请求失败" } : n))
      );
    } finally {
      if (generationControllersRef.current.get(nodeId) === controller) {
        generationControllersRef.current.delete(nodeId);
      }
    }
  };

  // Inpainting Image-Editing Call
  const handleGenerateEdit = async (
    nodeId: string,
    originalImageBase64: string,
    maskBase64: string,
    prompt: string,
    options: any
  ) => {
    const parentNode = nodes.find((n) => n.id === nodeId);
    if (!parentNode) return;
    const endpoint = config.endpoints.find((item) => item.id === parentNode.endpointId) || defaultEndpointConfig;

    // Keep enough room for the connection and node controls between edit results.
    const nextNodeId = `node-edit-${Date.now()}`;
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
      createdAt: Date.now(),
    };

    setNodes((prev) => [...prev, nextNode]);
    setConnections((prev) => [
      ...prev,
      { id: `conn-edit-${nextNode.createdAt}`, fromId: nodeId, toId: nextNodeId },
    ]);

    const controller = new AbortController();
    generationControllersRef.current.set(nextNodeId, controller);

    try {
      const headers: Record<string, string> = {};
      if (endpoint.apiKey) {
        headers["x-api-key"] = endpoint.apiKey;
      }
      if (endpoint.baseUrl) {
        headers["x-base-url"] = endpoint.baseUrl;
      }

      const response = await fetch("/api/edit", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
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

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || errData.error || `Server error code ${response.status}`);
      }

      const resJson = await response.json();
      const sourceUrls = resJson.data?.map((item: any) => item.url).filter(Boolean) || [];

      if (!sourceUrls.length) {
        throw new Error("No image URL was returned in the API response.");
      }

      const storedImages = await Promise.all(sourceUrls.map(async (sourceUrl: string) => {
        const assetId = await saveImageAsset(sourceUrl);
        const imageUrl = await getImageAssetUrl(assetId);
        if (!imageUrl) throw new Error("Unable to load the edited image asset.");
        assetObjectUrlsRef.current.add(imageUrl);
        return { assetId, imageUrl };
      }));

      // Load edited image into the newly spawned node
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nextNodeId
            ? {
                ...n,
                status: "idle",
                imageUrl: storedImages[0].imageUrl,
                assetId: storedImages[0].assetId,
                assetIds: storedImages.map((image) => image.assetId),
                originalImageUrl: originalImageBase64,
                maskAssetId: parentNode.maskAssetId,
                imageUrls: storedImages.map((image) => image.imageUrl),
                prompt,
              }
            : n
        )
      );
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error(err);
      setNodes((prev) =>
        prev.map((n) => (n.id === nextNodeId ? { ...n, status: "error", error: err.message || "编辑失败" } : n))
      );
    } finally {
      if (generationControllersRef.current.get(nextNodeId) === controller) {
        generationControllersRef.current.delete(nextNodeId);
      }
    }
  };

  const handleCancelGeneration = (nodeId: string) => {
    generationControllersRef.current.get(nodeId)?.abort();
    generationControllersRef.current.delete(nodeId);

    const isTemporaryEditOutput = nodes.some((node) => node.id === nodeId && node.type === "image" && node.status === "loading");
    if (isTemporaryEditOutput) {
      setNodes((prev) => prev.filter((node) => node.id !== nodeId));
      setConnections((prev) => prev.filter((connection) => connection.fromId !== nodeId && connection.toId !== nodeId));
      return;
    }

    setNodes((prev) =>
      prev.map((node) => (node.id === nodeId ? { ...node, status: "idle", error: undefined } : node))
    );
  };

  const handleDeleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  };

  const handleDuplicateNode = (id: string) => {
    setNodes((prev) => {
      const node = prev.find((item) => item.id === id);
      if (!node) return prev;

      const createdAt = Date.now();
      const duplicate: CanvasNode = {
        ...node,
        id: `node-copy-${createdAt}`,
        x: node.x + 36,
        y: node.y + 36,
        status: "idle",
        error: undefined,
        createdAt,
      };
      return [...prev, duplicate];
    });
  };

  const handleCreateStandaloneImage = async (sourceNodeId: string, imageBlob: Blob) => {
    const sourceNode = nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode) return;

    const assetId = await saveImageAsset(imageBlob);
    const imageUrl = await getImageAssetUrl(assetId);
    if (!imageUrl) throw new Error("Unable to load the copied image asset.");
    assetObjectUrlsRef.current.add(imageUrl);

    const createdAt = Date.now();
    const newNode: CanvasNode = {
      id: `node-img-${createdAt}`,
      type: "image",
      x: sourceNode.x + 80,
      y: sourceNode.y + 80,
      width: sourceNode.width,
      height: sourceNode.height,
      prompt: sourceNode.prompt,
      imageUrl,
      assetId,
      isStandaloneImage: true,
      status: "idle",
      aspectRatio: sourceNode.aspectRatio,
      model: "none",
      createdAt,
    };
    setNodes((prev) => [...prev, newNode]);
  };

  const handleUpdateNodePosition = (id: string, updates: Partial<CanvasNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...updates } : n)));
  };

  if (!currentProjectId && homeView === "settings") {
    return <SettingsPanel config={config} onChangeConfig={handleUpdateConfig} onBack={returnToPreviousView} />;
  }

  if (!currentProjectId && homeView === "assets") {
    return <AssetManager onBack={returnToPreviousView} />;
  }

  if (!currentProjectId) {
    return (
      <div className="w-screen h-screen flex flex-col bg-[#020617] text-slate-200 overflow-hidden select-none font-sans relative items-center justify-center p-6">
        {/* Mesh Gradient Background Layer */}
        <div className="absolute inset-0 opacity-40 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-indigo-600 rounded-full blur-[130px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] bg-purple-700 rounded-full blur-[160px]" />
        </div>

        <div className="max-w-4xl w-full z-10 flex flex-col gap-8 animate-in fade-in zoom-in-95 duration-300">
          {/* Logo Section */}
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/40 animate-pulse">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-black text-white tracking-wider uppercase flex items-center gap-3 bg-gradient-to-r from-indigo-200 via-white to-purple-200 bg-clip-text text-transparent">
              <span>Sang Image 创意画板</span>
            </h1>
            <p className="text-sm text-slate-400 max-w-xl">
              基于 gpt-image-2 强力驱动的画作演变与局部编辑工作台
            </p>
          </div>

          <nav className="flex items-center justify-center gap-2">
            <button onClick={() => { setReturnProjectId(null); setHomeView("settings"); }} className="px-3 py-2 rounded-lg border border-white/10 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white flex items-center gap-1.5 cursor-pointer"><Settings className="w-3.5 h-3.5 text-indigo-400" />设置</button>
            <button onClick={() => { setReturnProjectId(null); setHomeView("assets"); }} className="px-3 py-2 rounded-lg border border-white/10 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white flex items-center gap-1.5 cursor-pointer"><Images className="w-3.5 h-3.5 text-emerald-400" />资产管理</button>
          </nav>

          {/* Cards Container */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Create Project Card */}
            <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col justify-between gap-6 hover:border-indigo-500/30 transition-all">
              <div className="flex flex-col gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-white">新建画布</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  开启一块全新的无限画布，探索创意的无限可能。输入一个项目名称，点击创建即可开始
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="输入画布项目名称 (如: 奇幻森林、未来都市...)"
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateNewProject(newProjectName);
                      setNewProjectName("");
                    }
                  }}
                />
                <button
                  onClick={() => {
                    handleCreateNewProject(newProjectName);
                    setNewProjectName("");
                  }}
                  className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4" />
                  <span>立即创建</span>
                </button>
              </div>
            </div>

            {/* Existing Projects Card */}
            <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-bold text-white">选择已有项目 ({projects.length})</span>
                </div>
              </div>

              {projects.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <Archive className="w-10 h-10 mb-2 opacity-30 text-slate-400" />
                  <p className="text-xs font-semibold text-slate-400">暂无已有项目</p>
                  <p className="text-[11px] mt-1 text-slate-600 max-w-[200px]">
                    您还没有任何项目。请在左侧输入名字新建一个，开始体验吧！
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto max-h-[250px] pr-1 flex flex-col gap-3">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleLoadProject(p.id)}
                      className="p-3.5 rounded-2xl bg-slate-950/50 border border-white/5 hover:border-purple-500/30 hover:bg-slate-950/80 cursor-pointer transition-all flex items-center justify-between group"
                    >
                      <div className="flex flex-col gap-1 pr-4 min-w-0">
                        <span className="font-bold text-xs text-slate-200 group-hover:text-white truncate">
                          {p.name}
                        </span>
                        <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                          <span>节点: {p.nodes.length}</span>
                          <span>连线: {p.connections.length}</span>
                          <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProject(p.id, e);
                          }}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="删除项目"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-[#020617] text-slate-200 overflow-hidden select-none font-sans relative">
      {/* Mesh Gradient Background Layer */}
      <div className="absolute inset-0 opacity-40 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-indigo-600 rounded-full blur-[130px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] bg-purple-700 rounded-full blur-[160px]" />
      </div>

      {/* 1. Header Navigation Rail */}
      <header className="absolute top-4 left-4 z-40 bg-slate-900/40 backdrop-blur-xl border border-white/10 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-4">
        <div 
          onClick={() => setShowProjectPanel(!showProjectPanel)}
          className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 cursor-pointer hover:scale-105 active:scale-95 transition-all group no-drag"
          title="点击 Logo 打开/关闭画布列表"
        >
          <Sparkles className="w-4 h-4 text-white animate-spin-slow group-hover:rotate-180 transition-transform duration-500" />
        </div>
        <div 
          onClick={() => setShowProjectPanel(!showProjectPanel)}
          className="flex flex-col cursor-pointer hover:opacity-80 transition-opacity no-drag"
          title="点击 打开/关闭画布列表"
        >
          <h1 className="text-xs font-bold text-white tracking-wider uppercase flex items-center gap-1.5">
            <span>Sang Image 工作台</span>
            <span className="text-[9px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-md font-mono">
              v{packageMetadata.version}
            </span>
          </h1>
          <p className="text-[10px] text-slate-400">
            {currentProject?.name || "创意画布"}
          </p>
        </div>
      </header>

      {/* 1.1 Project Management Sidebar Drawer */}
      {showProjectPanel && (
        <div className="absolute top-[80px] left-4 bottom-[80px] w-80 z-40 bg-slate-950/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-left duration-200">
          {/* Panel Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-900/40">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-indigo-400 animate-pulse" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">我的画布</span>
            </div>
            <button
              onClick={() => setShowProjectPanel(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Create New Project Area */}
          <div className="p-4 border-b border-white/5 bg-white/5 flex flex-col gap-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">新建空白画布</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="输入画布名称..."
                className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => {
                  handleCreateNewProject(newProjectName);
                  setNewProjectName("");
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-md shadow-indigo-600/20"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建</span>
              </button>
            </div>
          </div>

          {/* Saved Projects List */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
              项目列表 ({projects.length})
            </span>
            {projects.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-5 text-slate-500">
                <Archive className="w-8 h-8 mb-2 opacity-50 text-slate-600" />
                <p className="text-xs font-medium text-slate-400">暂无画布</p>
                <p className="text-[10px] mt-1 text-slate-600">在上方创建一个空白画布，开始绘制。</p>
              </div>
            ) : (
              projects.map((p) => {
                const isActive = p.id === currentProjectId;
                return (
                  <div
                    key={p.id}
                    onClick={() => handleLoadProject(p.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 group relative ${
                      isActive
                        ? "bg-indigo-600/10 border-indigo-500/50 hover:bg-indigo-600/15"
                        : "bg-slate-900/40 border-white/5 hover:border-white/10 hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="flex items-start justify-between pr-6">
                      <span className="font-bold text-xs text-slate-200 group-hover:text-white leading-tight break-all">
                        {p.name}
                      </span>
                      {isActive && (
                        <span className="shrink-0 text-[8px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-full border border-indigo-500/20">
                          当前加载
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                      <span>节点: {p.nodes.length}</span>
                      <span>连线: {p.connections.length}</span>
                    </div>

                    <div className="text-[9px] text-slate-500 font-mono">
                      更新于: {new Date(p.updatedAt).toLocaleTimeString()}
                    </div>

                    {/* Delete Icon */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(p.id, e);
                      }}
                      className="absolute right-2 top-2 p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      title="删除画布"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Canvas navigation */}
          {currentProjectId && (
            <div className="p-3 border-t border-white/10 bg-slate-900/40 grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => {
                  setCurrentProjectId(null);
                  localStorage.removeItem("gpt_image_current_project_id");
                  setReturnProjectId(null);
                  setHomeView("home");
                }}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center justify-center gap-1.5 min-w-0 py-1.5 hover:bg-white/5 rounded-xl transition-all cursor-pointer"
              >
                <Home className="w-3.5 h-3.5 shrink-0" />
                <span>主页</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setReturnProjectId(currentProjectId);
                  setCurrentProjectId(null);
                  localStorage.removeItem("gpt_image_current_project_id");
                  setHomeView("assets");
                }}
                className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center justify-center gap-1.5 min-w-0 py-1.5 hover:bg-white/5 rounded-xl transition-all cursor-pointer"
              >
                <Images className="w-3.5 h-3.5 shrink-0" />
                <span>资产</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setReturnProjectId(currentProjectId);
                  setCurrentProjectId(null);
                  localStorage.removeItem("gpt_image_current_project_id");
                  setHomeView("settings");
                }}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center justify-center gap-1.5 min-w-0 py-1.5 hover:bg-white/5 rounded-xl transition-all cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5 shrink-0" />
                <span>设置</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 2. Top-Center Alert Banner for local vs server defaults */}
      {showBanner && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/85 backdrop-blur-md border border-white/15 text-slate-200 rounded-2xl pl-4 pr-3 py-2 shadow-2xl flex items-center gap-2.5 max-w-lg animate-in fade-in slide-in-from-top-2 duration-300">
          <Info className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-xs font-medium text-slate-300">
            <span>新节点默认使用 <strong className="text-emerald-400 font-bold">{defaultEndpointConfig.name}</strong>，可在节点内切换模型。</span>
          </span>
          <button
            onClick={() => setShowBanner(false)}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer shrink-0 ml-1"
            title="关闭提示"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Zoom display in bottom right corner */}
      <div className="fixed bottom-6 right-6 z-40 bg-slate-950/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-xl shadow-2xl flex items-center gap-2.5 font-mono text-xs font-semibold text-slate-300">
        <span className="flex items-center gap-1">
          <Eye className="w-3.5 h-3.5 text-indigo-400" />
          <span>缩放: {Math.round(zoom * 100)}%</span>
        </span>
        <div className="w-px h-3.5 bg-white/10" />
        <span>节点: {nodes.length}</span>
      </div>

      {/* 5. Main Pannable & Zoomable Infinite Canvas Grid */}
      <div
        id="infinite-grid-viewport"
        ref={containerRef}
        tabIndex={0}
        onWheel={handleWheel}
        onMouseDown={handleMouseDownCanvas}
        onDoubleClick={handleDoubleClickCanvas}
        onPaste={handleCanvasPaste}
        className={`flex-1 relative overflow-hidden select-none outline-none ${
          isSpacePressed || activeTool === "pan"
            ? isPanningRef.current
              ? "cursor-grabbing"
              : "cursor-grab"
            : "cursor-default"
        }`}
      >
        {/* Infinite Grid Background inside transformation container using design's radial dot grid */}
        <div
          id="infinite-grid-bg"
          className="absolute inset-0 pointer-events-none select-none opacity-40"
          style={{
            backgroundImage: `radial-gradient(#94a3b8 1px, transparent 1px)`,
            backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
            backgroundPosition: `${panX}px ${panY}px`,
          }}
        />

        {/* Dynamic Nodes Container applying Pan & Zoom transformation */}
        <div
          id="nodes-transform-container"
          className="absolute inset-0 pointer-events-none origin-top-left"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          }}
        >
          {/* Animated SVG Connection Lines between nodes */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ zIndex: 1 }}>
            <defs>
              <linearGradient id="wireGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <style>{`
              @keyframes wire-dash {
                to {
                  stroke-dashoffset: -20;
                }
              }
              .animate-wire-dash {
                animation: wire-dash 1.2s linear infinite;
              }
            `}</style>
            {connections.map((conn) => {
              const fromNode = nodes.find((n) => n.id === conn.fromId);
              const toNode = nodes.find((n) => n.id === conn.toId);
              if (!fromNode || !toNode) return null;

              // Calculate start coordinates (middle-right of source node)
              const x1 = fromNode.x + fromNode.width;
              const y1 = fromNode.y + fromNode.height / 2; // Middle-right side port

              // Calculate end coordinates (middle-left input port)
              const x2 = toNode.x;
              const y2 = toNode.y + toNode.height / 2;
              const sourceConnections = connections.filter((connection) => connection.fromId === conn.fromId);
              const connectionIndex = sourceConnections.findIndex((connection) => connection.id === conn.id);
              const horizontalDistance = Math.abs(x2 - x1);
              const controlDistance = 50 + connectionIndex * 28;
              const curveProgress = Math.min(0.36, controlDistance / Math.max(horizontalDistance, 120));
              const controlX = (x1 + x2) / 2;
              const inverseProgress = 1 - curveProgress;
              const deleteControlX = inverseProgress ** 3 * x1
                + 3 * inverseProgress ** 2 * curveProgress * controlX
                + 3 * inverseProgress * curveProgress ** 2 * controlX
                + curveProgress ** 3 * x2;
              const deleteControlY = inverseProgress ** 3 * y1
                + 3 * inverseProgress ** 2 * curveProgress * y1
                + 3 * inverseProgress * curveProgress ** 2 * y2
                + curveProgress ** 3 * y2;
              const showDeleteControl = connectionActionsFromId === conn.fromId;

              return (
                <g key={conn.id}>
                  {/* Outer glow line */}
                  <path
                    d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="#818cf8"
                    strokeWidth="6"
                    strokeOpacity="0.25"
                    className="blur-sm"
                  />
                  {/* Main animated flowing connection path */}
                  <path
                    d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="url(#wireGradient)"
                    strokeWidth="2.5"
                    strokeDasharray="6 3"
                    className="animate-wire-dash"
                  />
                  {showDeleteControl && (
                    <g
                      transform={`translate(${deleteControlX} ${deleteControlY})`}
                      onClick={() => handleRemoveConnection(conn.id)}
                      style={{ cursor: "pointer", pointerEvents: "all" }}
                    >
                      <circle r="10" fill="#1e293b" stroke="#fb7185" strokeWidth="1.5" />
                      <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="#fda4af" strokeWidth="1.8" strokeLinecap="round" />
                    </g>
                  )}
                </g>
              );
            })}
            {connectingFromId && connectionCursor && (() => {
              const sourceNode = nodes.find((node) => node.id === connectingFromId);
              if (!sourceNode) return null;
              const x1 = sourceNode.x + sourceNode.width;
              const y1 = sourceNode.y + sourceNode.height / 2;
              const x2 = connectionCursor.x;
              const y2 = connectionCursor.y;
              return <path
                d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#a5b4fc"
                strokeWidth="2"
                strokeDasharray="5 4"
                className="animate-wire-dash"
              />;
            })()}
          </svg>

          {nodes.map((node) => {
            const parentEditor = connections
              .filter((connection) => connection.toId === node.id)
              .map((connection) => nodes.find((candidate) => candidate.id === connection.fromId))
              .find((candidate) => candidate?.type === "editor");
            const parentInputImageUrl = parentEditor
              ? connections
                .filter((connection) => connection.toId === parentEditor.id)
                .map((connection) => nodes.find((candidate) => candidate.id === connection.fromId))
                .find((candidate) => candidate?.type === "image")?.imageUrl
              : undefined;

            return (
              <div key={node.id} className="pointer-events-auto">
                <ImageNode
                node={node}
                zoom={zoom}
                activeTool={isSpacePressed ? "pan" : activeTool}
                onGenerate={handleGenerateImage}
                onGenerateEdit={handleGenerateEdit}
                onCancelGeneration={handleCancelGeneration}
                onDelete={handleDeleteNode}
                onDuplicate={handleDuplicateNode}
                onCreateStandaloneImage={handleCreateStandaloneImage}
                onUpdatePosition={handleUpdateNodePosition}
                parentInputImageUrl={parentInputImageUrl}
                
                // Connection system wires and events mapping
                connectingFromId={connectingFromId}
                onStartConnecting={handleStartConnecting}
                onCompleteConnecting={handleCompleteConnecting}
                connectedToNodes={connections.filter(c => c.fromId === node.id).map(c => nodes.find(n => n.id === c.toId)).filter(Boolean) as CanvasNode[]}
                incomingNodes={connections.filter(c => c.toId === node.id).map(c => nodes.find(n => n.id === c.fromId)).filter(Boolean) as CanvasNode[]}
                onUploadReferenceImage={handleUploadReferenceImage}
                endpoints={config.endpoints}
                />
              </div>
            );
          })}
        </div>
      </div>
 
      {/* 6. Bottom Floating Toolbar */}
      <Toolbar
        activeTool={activeTool}
        onChangeTool={setActiveTool}
        onResetView={handleRecenter}
        onClearCanvas={handleClearCanvas}
        onAddGeneratorNode={handleAddGeneratorNode}
        onAddEditorNode={handleAddEditorNode}
        onAddTextNode={handleAddTextNode}
        onUploadImageNode={handleUploadImageNode}
      />
    </div>
  );
}
