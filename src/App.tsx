import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { jsPDF } from 'jspdf';
import type { EnhanceMode } from './imageWorker';

type PdfMode = 'original' | 'a4';
type EnhancePreviewMode = Exclude<EnhanceMode, 'original'>;

type ImageItem = {
  id: string;
  file: File;
  dataUrl: string;
  width: number;
  height: number;
  preferEnhanced: boolean;
};

const worker = new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' });

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const readImageInfo = (file: File): Promise<ImageItem> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const image = new Image();
      image.onload = () => {
        resolve({
          id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
          preferEnhanced: true
        });
      };
      image.onerror = reject;
      image.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function SortableCard({
  item,
  onDelete,
  onPreview
}: {
  item: ImageItem;
  onDelete: (id: string) => void;
  onPreview: (item: ImageItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.58 : 1 }}
      className="card"
    >
      <div className="drag" {...attributes} {...listeners}>⋮⋮</div>
      <img src={item.dataUrl} alt={item.file.name} className="thumb" />
      <div className="meta">
        <div className="name" title={item.file.name}>{item.file.name}</div>
        <div className="sub">{formatSize(item.file.size)} · {item.width} × {item.height}</div>
        <div className="row-actions">
          <button className="mini" onClick={() => onPreview(item)}>预览增强效果</button>
          <button className="mini danger" onClick={() => onDelete(item.id)}>删除</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [mode, setMode] = useState<PdfMode>('a4');
  const [isBusy, setIsBusy] = useState(false);
  const [scanEnabled, setScanEnabled] = useState(false);
  const [enhanceMode, setEnhanceMode] = useState<EnhancePreviewMode>('document');
  const [progress, setProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [previewItem, setPreviewItem] = useState<ImageItem | null>(null);
  const [previewEnhanced, setPreviewEnhanced] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor));
  const cacheRef = useRef<Map<string, string>>(new Map());

  const accept = useMemo(() => ['image/jpeg', 'image/png', 'image/webp'], []);

  const processImage = (id: string, dataUrl: string, targetMode: EnhancePreviewMode): Promise<string> => {
    const key = `${id}:${targetMode}`;
    const cached = cacheRef.current.get(key);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve, reject) => {
      const reqId = `${key}:${Date.now()}`;
      const onMessage = (event: MessageEvent<{ id: string; ok: boolean; dataUrl?: string; error?: string }>) => {
        if (event.data.id !== reqId) return;
        worker.removeEventListener('message', onMessage as EventListener);
        if (event.data.ok && event.data.dataUrl) {
          cacheRef.current.set(key, event.data.dataUrl);
          resolve(event.data.dataUrl);
        } else {
          reject(new Error(event.data.error || '处理失败'));
        }
      };
      worker.addEventListener('message', onMessage as EventListener);
      worker.postMessage({ id: reqId, mode: targetMode, dataUrl });
    });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const imageFiles = Array.from(files).filter((f) => accept.includes(f.type));
    const next = await Promise.all(imageFiles.map(readImageInfo));
    setItems((prev) => [...prev, ...next]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((arr) => {
      const oldIndex = arr.findIndex((i) => i.id === active.id);
      const newIndex = arr.findIndex((i) => i.id === over.id);
      return arrayMove(arr, oldIndex, newIndex);
    });
  };

  const getPdfSource = async (item: ImageItem, index: number, total: number): Promise<string> => {
    if (!scanEnabled || !item.preferEnhanced || enhanceMode === 'original') return item.dataUrl;
    setProgress(`正在处理第 ${index + 1} / ${total} 张`);
    try {
      return await processImage(item.id, item.dataUrl, enhanceMode);
    } catch {
      setErrorMsg('部分图片增强失败，已自动回退原图继续生成。');
      return item.dataUrl;
    }
  };

  const generatePdf = async () => {
    if (!items.length) return;
    setIsBusy(true);
    setErrorMsg('');
    try {
      const firstData = await getPdfSource(items[0], 0, items.length);
      const doc = new jsPDF({ unit: 'px', format: mode === 'a4' ? 'a4' : [items[0].width, items[0].height], hotfixes: ['px_scaling'] });

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const source = index === 0 ? firstData : await getPdfSource(item, index, items.length);

        if (index > 0) {
          if (mode === 'a4') doc.addPage('a4');
          else doc.addPage([item.width, item.height], 'portrait');
        }

        if (mode === 'original') {
          doc.addImage(source, 'PNG', 0, 0, item.width, item.height, undefined, 'NONE');
        } else {
          const pageW = doc.internal.pageSize.getWidth();
          const pageH = doc.internal.pageSize.getHeight();
          const ratio = Math.min(pageW / item.width, pageH / item.height);
          const drawW = item.width * ratio;
          const drawH = item.height * ratio;
          const x = (pageW - drawW) / 2;
          const y = (pageH - drawH) / 2;
          doc.addImage(source, 'PNG', x, y, drawW, drawH, undefined, 'NONE');
        }

        await new Promise((r) => setTimeout(r, 0));
      }

      doc.save(`images-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setIsBusy(false);
      setProgress('');
    }
  };

  const openPreview = async (item: ImageItem) => {
    setPreviewItem(item);
    if (!scanEnabled || enhanceMode === 'original') {
      setPreviewEnhanced(item.dataUrl);
      return;
    }
    setProgress('单张图片处理中...');
    try {
      const out = await processImage(item.id, item.dataUrl, enhanceMode);
      setPreviewEnhanced(out);
    } catch {
      setPreviewEnhanced(item.dataUrl);
      setErrorMsg('预览增强失败，已回退显示原图。');
    } finally {
      setProgress('');
    }
  };

  return (
    <main className="app">
      <section className="surface">
        <h1>图片转 PDF</h1>
        <p className="muted">本地处理，无需上传。拖拽排序后导出高质量 PDF。</p>

        <div className="scan-box">
          <label><input type="checkbox" checked={scanEnabled} onChange={(e) => setScanEnabled(e.target.checked)} /> 启用扫描增强</label>
          <select value={enhanceMode} onChange={(e) => setEnhanceMode(e.target.value as EnhancePreviewMode)} disabled={!scanEnabled}>
            <option value="original">原图</option>
            <option value="document">文档增强</option>
            <option value="bw">黑白扫描</option>
            <option value="gray">灰度扫描</option>
          </select>
          <div className="hint">文档增强会在本地优化亮度、对比度和背景，不会上传图片。</div>
        </div>

        <label className="upload">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void addFiles(e.target.files)} />
          <span className="upload-title">+ 添加图片</span>
          <span className="upload-sub">JPG / PNG / WEBP · 可多选</span>
        </label>

        <div className="toolbar">
          <select value={mode} onChange={(e) => setMode(e.target.value as PdfMode)}>
            <option value="a4">A4 自适应</option>
            <option value="original">原图尺寸</option>
          </select>
          <button className="ghost" onClick={() => setItems([])} disabled={!items.length}>清空</button>
          <button className="primary" onClick={() => void generatePdf()} disabled={!items.length || isBusy}>{isBusy ? '生成中...' : '生成 PDF'}</button>
        </div>

        {!!progress && <div className="stats">{progress}</div>}
        {!!errorMsg && <div className="error">{errorMsg}</div>}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
            <section className="grid">
              {items.map((item) => (
                <SortableCard key={item.id} item={item} onDelete={(id) => setItems((arr) => arr.filter((x) => x.id !== id))} onPreview={(x) => void openPreview(x)} />
              ))}
              {!items.length && <div className="empty">先上传图片，支持拖拽排序与删除。</div>}
            </section>
          </SortableContext>
        </DndContext>
      </section>

      {previewItem && (
        <div className="modal" onClick={() => setPreviewItem(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <h3>预览增强效果</h3>
            <div className="compare">
              <div><p>原图</p><img src={previewItem.dataUrl} alt="origin" /></div>
              <div><p>增强后</p><img src={previewEnhanced || previewItem.dataUrl} alt="enhanced" /></div>
            </div>
            <div className="footer-actions">
              <button className="ghost" onClick={() => { setItems((arr) => arr.map((x) => x.id === previewItem.id ? { ...x, preferEnhanced: false } : x)); setPreviewItem(null); }}>使用原图</button>
              <button className="primary" onClick={() => { setItems((arr) => arr.map((x) => x.id === previewItem.id ? { ...x, preferEnhanced: true } : x)); setPreviewItem(null); }}>使用增强图</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
