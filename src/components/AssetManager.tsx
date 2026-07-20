import React, { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, RefreshCw, Trash2 } from "lucide-react";
import { deleteImageAsset, getImageAssetUrl, ImageAssetSummary, listImageAssets } from "../assets";

interface AssetManagerProps {
  onBack: () => void;
}

interface AssetItem extends ImageAssetSummary {
  url?: string;
}

export default function AssetManager({ onBack }: AssetManagerProps) {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const objectUrlsRef = useRef(new Set<string>());

  const loadAssets = async () => {
    setIsLoading(true);
    const summaries = await listImageAssets();
    const nextAssets = await Promise.all(summaries.map(async (asset) => ({ ...asset, url: await getImageAssetUrl(asset.id) })));
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
    nextAssets.forEach((asset) => {
      if (asset.url) objectUrlsRef.current.add(asset.url);
    });
    setAssets(nextAssets);
    setIsLoading(false);
  };

  useEffect(() => {
    void loadAssets();
    return () => objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const removeAsset = async (asset: AssetItem) => {
    await deleteImageAsset(asset.id);
    if (asset.url) {
      URL.revokeObjectURL(asset.url);
      objectUrlsRef.current.delete(asset.url);
    }
    setAssets((current) => current.filter((item) => item.id !== asset.id));
  };

  return (
    <main className="w-screen h-screen bg-[#020617] text-slate-200 p-5 sm:p-10 overflow-hidden">
      <div className="max-w-6xl h-full mx-auto flex flex-col min-h-0">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <h1 className="text-2xl font-bold text-white">资产管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void loadAssets()} title="刷新资产" className="p-2 text-slate-300 hover:bg-white/10 rounded-lg cursor-pointer"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={onBack} className="px-3 py-2 text-xs font-semibold text-slate-200 border border-white/10 hover:bg-white/10 rounded-lg cursor-pointer">返回</button>
          </div>
        </header>

        <section className="mt-6 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between text-sm text-slate-400"><span>图片资产</span><span>{assets.length} 项</span></div>
          {isLoading ? (
            <div className="py-20 text-center text-sm text-slate-500">正在读取本地资产...</div>
          ) : assets.length === 0 ? (
            <div className="py-24 flex flex-col items-center text-center text-slate-500"><ImageIcon className="w-10 h-10 mb-3" /><p className="text-sm">暂无图片资产</p></div>
          ) : (
            <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">
                {assets.map((asset) => (
                  <article key={asset.id} className="bg-slate-900/70 border border-white/10 rounded-lg overflow-hidden">
                    <div className="aspect-square bg-slate-950 flex items-center justify-center">
                      {asset.url ? <img src={asset.url} alt="本地图片资产" className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-slate-700" />}
                    </div>
                    <div className="p-2.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-500 font-mono truncate">{new Date(asset.createdAt).toLocaleString()}</span>
                      <button onClick={() => void removeAsset(asset)} title="删除资产" className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}