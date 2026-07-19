import React, { useState } from "react";
import { Check, Cpu, Eye, EyeOff, Globe, Plus, Settings, Shield, Trash2, X } from "lucide-react";
import { ApiEndpoint, AppConfig } from "../types";

interface SettingsPanelProps {
  config: AppConfig;
  onChangeConfig: (newConfig: AppConfig) => void;
  onBack?: () => void;
}

const createEndpoint = (): ApiEndpoint => ({
  id: `endpoint-${Date.now()}`,
  name: "新接入点",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  models: ["gpt-image-2"],
});

export default function SettingsPanel({ config, onChangeConfig, onBack }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(Boolean(onBack));
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const updateEndpoint = (endpointId: string, changes: Partial<ApiEndpoint>) => {
    onChangeConfig({
      ...config,
      endpoints: config.endpoints.map((endpoint) => endpoint.id === endpointId ? { ...endpoint, ...changes } : endpoint),
    });
  };

  const addEndpoint = () => {
    const endpoint = createEndpoint();
    onChangeConfig({ ...config, endpoints: [...config.endpoints, endpoint] });
  };

  const removeEndpoint = (endpointId: string) => {
    if (config.endpoints.length === 1) return;
    const endpoints = config.endpoints.filter((endpoint) => endpoint.id !== endpointId);
    onChangeConfig({
      endpoints,
      defaultEndpointId: config.defaultEndpointId === endpointId ? endpoints[0].id : config.defaultEndpointId,
    });
  };

  return (
    <div id="settings-panel-container" className={onBack ? "w-screen min-h-screen bg-[#020617] text-slate-200 p-5 sm:p-10 flex flex-col items-center" : "fixed top-4 right-4 z-50 flex flex-col items-end"}>
      {!onBack && <button
        id="btn-toggle-settings"
        onClick={() => setIsOpen((open) => !open)}
        title="接入点设置"
        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all shadow-md cursor-pointer ${
          isOpen ? "bg-slate-800 border-white/20 text-white" : "bg-slate-900/70 border-white/10 text-slate-200 hover:bg-slate-800 backdrop-blur-md"
        }`}
      >
        <Settings className="w-4 h-4" />
        <span>设置</span>
        <span className="text-[10px] text-slate-400">{config.endpoints.length}</span>
      </button>}

      {isOpen && (
        <section id="settings-content" className={`${onBack ? "w-full max-w-3xl" : "mt-2 w-[28rem] max-h-[calc(100vh-5rem)]"} overflow-y-auto bg-slate-950/95 backdrop-blur-2xl border border-white/15 rounded-xl p-4 shadow-2xl text-slate-200 flex flex-col gap-3`}>
          <header className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />
              <div><p className="text-xs text-indigo-400 font-semibold">应用配置</p><h1 className="text-xl font-semibold text-white">接入点与模型</h1></div>
            </div>
            {onBack ? <button onClick={onBack} className="px-3 py-2 text-xs font-semibold text-slate-200 border border-white/10 hover:bg-white/10 rounded-lg cursor-pointer">返回首页</button> : <button onClick={() => setIsOpen(false)} title="关闭设置" className="p-1 text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>}
          </header>

          {config.endpoints.map((endpoint) => (
            <div key={endpoint.id} className="border border-white/10 bg-white/[0.03] rounded-lg p-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={endpoint.name}
                  onChange={(event) => updateEndpoint(endpoint.id, { name: event.target.value })}
                  aria-label="接入点名称"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white focus:outline-none"
                />
                <button
                  onClick={() => onChangeConfig({ ...config, defaultEndpointId: endpoint.id })}
                  title="设为新建节点默认接入点"
                  className={`p-1.5 rounded-lg cursor-pointer ${config.defaultEndpointId === endpoint.id ? "bg-emerald-500/20 text-emerald-300" : "text-slate-500 hover:text-slate-200"}`}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => removeEndpoint(endpoint.id)} disabled={config.endpoints.length === 1} title="删除接入点" className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 disabled:opacity-30 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>

              <label className="relative block">
                <Globe className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input value={endpoint.baseUrl} onChange={(event) => updateEndpoint(endpoint.id, { baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" className="w-full bg-slate-900 border border-white/10 rounded-lg pl-8 pr-2.5 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500" />
              </label>
              <label className="relative block">
                <Shield className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input type={showKeys[endpoint.id] ? "text" : "password"} value={endpoint.apiKey} onChange={(event) => updateEndpoint(endpoint.id, { apiKey: event.target.value })} placeholder="API Key" className="w-full bg-slate-900 border border-white/10 rounded-lg pl-8 pr-8 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500" />
                <button type="button" onClick={() => setShowKeys((previous) => ({ ...previous, [endpoint.id]: !previous[endpoint.id] }))} title="显示或隐藏密钥" className="absolute right-2 top-2 text-slate-500 hover:text-white cursor-pointer">{showKeys[endpoint.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </label>
              <label className="relative block">
                <Cpu className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input value={endpoint.models.join(", ")} onChange={(event) => updateEndpoint(endpoint.id, { models: event.target.value.split(",").map((model) => model.trim()).filter(Boolean) })} placeholder="gpt-image-2, dall-e-3" className="w-full bg-slate-900 border border-white/10 rounded-lg pl-8 pr-2.5 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500" />
              </label>
            </div>
          ))}

          <button onClick={addEndpoint} className="w-full py-2 rounded-lg border border-dashed border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/10 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"><Plus className="w-3.5 h-3.5" />添加接入点</button>
        </section>
      )}
    </div>
  );
}