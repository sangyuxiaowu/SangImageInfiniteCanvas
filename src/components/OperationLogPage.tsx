import React, { useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, ClipboardList, Info, RefreshCw, Trash2 } from "lucide-react";
import { clearOperationLogs, getOperationLogs, OperationLogEntry } from "../operationLogs";

interface OperationLogPageProps {
  onBack: () => void;
}

const levelStyles = {
  info: { label: "进行中", icon: Info, className: "text-sky-300 bg-sky-500/10 border-sky-400/20" },
  success: { label: "已完成", icon: CheckCircle2, className: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20" },
  error: { label: "失败", icon: CircleAlert, className: "text-rose-300 bg-rose-500/10 border-rose-400/20" },
};

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export default function OperationLogPage({ onBack }: OperationLogPageProps) {
  const [logs, setLogs] = useState<OperationLogEntry[]>(() => getOperationLogs());

  const refreshLogs = () => setLogs(getOperationLogs());
  const clearLogs = () => {
    clearOperationLogs();
    setLogs([]);
  };

  return (
    <main className="w-screen h-screen bg-[#020617] text-slate-200 p-5 sm:p-10 overflow-hidden">
      <div className="max-w-5xl h-full mx-auto flex flex-col min-h-0">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-lg bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-white">操作日志</h1>
              <p className="text-xs text-slate-400 mt-1">最近 {logs.length} 条应用操作记录</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={refreshLogs} title="刷新日志" className="p-2 text-slate-300 hover:bg-white/10 rounded-lg cursor-pointer">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={clearLogs} title="清空日志" disabled={logs.length === 0} className="p-2 text-rose-300 hover:bg-rose-500/10 rounded-lg disabled:opacity-30 cursor-pointer">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onBack} className="px-3 py-2 text-xs font-semibold text-slate-200 border border-white/10 hover:bg-white/10 rounded-lg cursor-pointer flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回</span>
            </button>
          </div>
        </header>

        <section className="mt-6 flex-1 min-h-0 overflow-y-auto pr-1">
          {logs.length === 0 ? (
            <div className="h-full min-h-56 flex flex-col items-center justify-center text-center text-slate-500">
              <ClipboardList className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">暂无操作记录</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-2 pb-4">
              {[...logs].reverse().map((log) => {
                const style = levelStyles[log.level];
                const StatusIcon = style.icon;
                return (
                  <li key={log.id} className="border border-white/10 bg-slate-900/60 rounded-lg px-4 py-3 flex items-start gap-3">
                    <div className={`mt-0.5 w-7 h-7 shrink-0 rounded-md border flex items-center justify-center ${style.className}`} title={style.label}>
                      <StatusIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-100">{log.action}</p>
                      {log.detail && <p className="mt-1 text-xs text-slate-400 break-words">{log.detail}</p>}
                    </div>
                    <time className="shrink-0 text-[11px] font-mono text-slate-500">{formatTimestamp(log.timestamp)}</time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}