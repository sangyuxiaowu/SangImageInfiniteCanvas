import React from "react";
import { Copy, FileText, Trash2 } from "lucide-react";
import { CanvasNode } from "../types";

interface TextNodeProps {
  node: CanvasNode;
  activeTool: string;
  isConnecting: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
  onUpdate: (updates: Partial<CanvasNode>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onStartConnecting: (clientX: number, clientY: number) => void;
}

const colorClasses: Record<string, string> = {
  slate: "bg-slate-950/65 border-white/10 text-slate-100 shadow-slate-950/55",
  indigo: "bg-indigo-950/50 border-indigo-500/30 text-indigo-100 shadow-indigo-950/50 ring-1 ring-indigo-500/20",
  emerald: "bg-emerald-950/50 border-emerald-500/30 text-emerald-100 shadow-emerald-950/50 ring-1 ring-emerald-500/20",
  amber: "bg-amber-950/50 border-amber-500/30 text-amber-100 shadow-amber-950/50 ring-1 ring-amber-500/20",
  rose: "bg-rose-950/50 border-rose-500/30 text-rose-100 shadow-rose-950/50 ring-1 ring-rose-500/20",
};

const colors = ["slate", "indigo", "emerald", "amber", "rose"];

export default function TextNode({
  node,
  activeTool,
  isConnecting,
  onMouseDown,
  onUpdate,
  onDuplicate,
  onDelete,
  onStartConnecting,
}: TextNodeProps) {
  const colorClass = colorClasses[node.prompt] || colorClasses.slate;

  return (
    <div
      id={`canvas-node-${node.id}`}
      className={`absolute rounded-2xl border backdrop-blur-2xl transition-all select-none flex flex-col overflow-visible shadow-2xl border-white/10 ${colorClass}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height, zIndex: 15 }}
    >
      <div
        onMouseDown={onMouseDown}
        className={`bg-slate-900/50 border-b border-white/5 px-3 py-2 flex items-center justify-between select-none shrink-0 ${
          activeTool === "select" ? "cursor-grab active:cursor-grabbing hover:bg-slate-900/70" : "cursor-default"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[11px] font-bold tracking-tight">文本便签</span>
        </div>

        <div className="flex items-center gap-1 no-drag">
          {colors.map((color) => (
            <button
              key={color}
              onClick={() => onUpdate({ prompt: color })}
              className={`w-2.5 h-2.5 rounded-full border border-white/25 transition-transform hover:scale-125 cursor-pointer ${
                color === "slate" ? "bg-slate-500" :
                color === "indigo" ? "bg-indigo-500" :
                color === "emerald" ? "bg-emerald-500" :
                color === "amber" ? "bg-amber-500" : "bg-rose-500"
              } ${node.prompt === color || (color === "slate" && !node.prompt) ? "ring-1 ring-white scale-110" : ""}`}
            />
          ))}
          <div className="w-px h-3 bg-white/10 mx-1" />
          <button onClick={onDuplicate} className="text-slate-400 hover:text-indigo-300 hover:bg-white/10 p-1 rounded-md transition-all cursor-pointer" title="复制节点">
            <Copy className="w-3 h-3" />
          </button>
          <button onClick={onDelete} className="text-slate-400 hover:text-rose-400 hover:bg-white/10 p-1 rounded-md transition-all cursor-pointer" title="删除便签">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 p-3.5 no-drag select-none flex flex-col bg-slate-950/15">
        <textarea
          value={node.text || ""}
          onChange={(event) => onUpdate({ text: event.target.value })}
          placeholder="让女孩抱着小猫..."
          className="w-full flex-1 bg-transparent border-none text-slate-100 text-xs focus:outline-none focus:ring-0 placeholder-slate-500 resize-none font-medium leading-relaxed"
        />
      </div>

      <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 z-50 no-drag">
        <button
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartConnecting(event.clientX, event.clientY);
          }}
          className={`w-3 h-3 rounded-full border-2 transition-all hover:scale-150 cursor-pointer ${
            isConnecting
              ? "border-indigo-300 animate-pulse shadow-[0_0_0_3px_rgba(99,102,241,0.35)]"
              : "bg-transparent border-slate-300 hover:border-indigo-400"
          }`}
          title="拉出连线关联到生图或修改节点"
        />
      </div>
    </div>
  );
}