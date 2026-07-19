import React, { useRef } from "react";
import { MousePointer, Hand, PlusSquare, RotateCcw, Trash2, HelpCircle, FileText, Upload, Sliders, Sparkles } from "lucide-react";
import { CanvasTool } from "../types";

interface ToolbarProps {
  activeTool: CanvasTool;
  onChangeTool: (tool: CanvasTool) => void;
  onResetView: () => void;
  onClearCanvas: () => void;
  onAddGeneratorNode: () => void;
  onAddEditorNode: () => void;
  onAddTextNode: () => void;
  onUploadImageNode: (base64Url: string) => void;
}

export default function Toolbar({
  activeTool,
  onChangeTool,
  onResetView,
  onClearCanvas,
  onAddGeneratorNode,
  onAddEditorNode,
  onAddTextNode,
  onUploadImageNode,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        onUploadImageNode(result);
      }
    };
    reader.readAsDataURL(file);
    // Reset file value to allow uploading same image
    e.target.value = "";
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div id="toolbar-container" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center bg-slate-950/75 backdrop-blur-2xl border border-white/15 px-4 py-2.5 rounded-2xl shadow-2xl gap-2 font-sans animate-in fade-in slide-in-from-bottom-4 duration-200">
      {/* Select Tool */}
      <button
        id="btn-tool-select"
        onClick={() => onChangeTool("select")}
        title="选择与移动 (V)"
        className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center ${
          activeTool === "select"
            ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
            : "text-slate-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <MousePointer className="w-5 h-5" />
      </button>

      {/* Pan Tool */}
      <button
        id="btn-tool-pan"
        onClick={() => onChangeTool("pan")}
        title="抓手拖拽画布 (H)"
        className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center ${
          activeTool === "pan"
            ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
            : "text-slate-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <Hand className="w-5 h-5" />
      </button>

      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Add Generator Node */}
      <button
        id="btn-add-generator-node"
        onClick={onAddGeneratorNode}
        title="新建文本生图控制节点 (N)"
        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium text-xs transition-all shadow-md shadow-indigo-600/30 cursor-pointer flex items-center gap-1.5"
      >
        <Sparkles className="w-4 h-4" />
        <span>添加生图节点</span>
      </button>

      {/* Add Editor Node */}
      <button
        id="btn-add-editor-node"
        onClick={onAddEditorNode}
        title="新建局部修改控制节点"
        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs transition-all shadow-md shadow-emerald-600/30 cursor-pointer flex items-center gap-1.5"
      >
        <Sliders className="w-4 h-4" />
        <span>添加修改节点</span>
      </button>

      {/* Add Text Node */}
      <button
        id="btn-add-text-node"
        onClick={() => onAddTextNode()}
        title="添加文本节点"
        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-white/10 font-medium text-xs transition-all cursor-pointer flex items-center gap-1.5"
      >
        <FileText className="w-4 h-4 text-indigo-400" />
        <span>添加文本</span>
      </button>

      {/* Upload Reference Image Node */}
      <button
        id="btn-upload-image"
        onClick={handleUploadClick}
        title="上传参考图"
        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-white/10 font-medium text-xs transition-all cursor-pointer flex items-center gap-1.5"
      >
        <Upload className="w-4 h-4 text-emerald-400" />
        <span>上传参考图</span>
      </button>

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Reset View */}
      <button
        id="btn-reset-view"
        onClick={onResetView}
        title="重置视角 (R)"
        className="p-2.5 rounded-xl text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer transition-all flex items-center justify-center"
      >
        <RotateCcw className="w-4 h-4" />
      </button>

      {/* Clear Canvas */}
      <button
        id="btn-clear-canvas"
        onClick={onClearCanvas}
        title="清空画布 (Clear)"
        className="p-2.5 rounded-xl text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer transition-all flex items-center justify-center"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {/* Floating Shortcut Help indicator */}
      <div className="group relative">
        <button
          className="p-2.5 rounded-xl text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center cursor-pointer"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-56 bg-slate-950/95 border border-white/10 text-white text-xs rounded-xl p-3 shadow-2xl leading-relaxed opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 flex flex-col gap-1.5 backdrop-blur-xl">
          <p className="font-semibold text-slate-200">快捷操作提示</p>
          <div className="h-px bg-white/10 my-0.5" />
          <p>• <b>Space / 空格键</b>: 按住不放，拖拽鼠标可平移画布</p>
          <p>• <b>滚轮 / Pinch</b>: 放大或缩小画布</p>
          <p>• <b>V / H</b>: 切换选择与抓手工具</p>
          <p>• <b>双击画布</b>: 快速添加生图框</p>
        </div>
      </div>
    </div>
  );
}

