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

type PdfMode = 'original' | 'a4';

type ImageItem = {
  id: string;
  file: File;
  dataUrl: string;
  width: number;
  height: number;
};

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
          height: image.naturalHeight
        });
      };
      image.onerror = reject;
      image.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function SortableCard({ item, onDelete }: { item: ImageItem; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div ref={setNodeRef} style={style} className="card" {...attributes} {...listeners}>
      <img src={item.dataUrl} alt={item.file.name} className="thumb" />
      <div className="meta">
        <div className="name" title={item.file.name}>{item.file.name}</div>
        <div className="sub">{formatSize(item.file.size)} · {item.width} × {item.height}</div>
      </div>
      <button className="ghost" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}>删除</button>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [mode, setMode] = useState<PdfMode>('a4');
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor));

  const accept = useMemo(() => ['image/jpeg', 'image/png', 'image/webp'], []);

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

  const generatePdf = async () => {
    if (!items.length) return;
    setIsBusy(true);
    try {
      const doc = new jsPDF({
        unit: 'px',
        format: mode === 'a4' ? 'a4' : [items[0].width, items[0].height],
        hotfixes: ['px_scaling']
      });

      items.forEach((item, index) => {
        if (index > 0) {
          if (mode === 'a4') doc.addPage('a4');
          else doc.addPage([item.width, item.height], 'portrait');
        }

        if (mode === 'original') {
          doc.addImage(item.dataUrl, undefined, 0, 0, item.width, item.height, undefined, 'NONE');
        } else {
          const pageW = doc.internal.pageSize.getWidth();
          const pageH = doc.internal.pageSize.getHeight();
          const ratio = Math.min(pageW / item.width, pageH / item.height);
          const drawW = item.width * ratio;
          const drawH = item.height * ratio;
          const x = (pageW - drawW) / 2;
          const y = (pageH - drawH) / 2;
          doc.addImage(item.dataUrl, undefined, x, y, drawW, drawH, undefined, 'NONE');
        }
      });

      const fileName = `images-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fileName);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="app">
      <h1>图片转 PDF</h1>
      <p className="muted">本地处理，无需上传。支持拖拽排序后一次性导出高质量 PDF。</p>

      <label className="upload">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => void addFiles(e.target.files)}
        />
        选择图片（JPG / PNG / WEBP）
      </label>

      <div className="toolbar">
        <select value={mode} onChange={(e) => setMode(e.target.value as PdfMode)}>
          <option value="a4">A4 自适应</option>
          <option value="original">原图尺寸</option>
        </select>
        <button className="ghost" onClick={() => setItems([])} disabled={!items.length}>清空</button>
        <button onClick={() => void generatePdf()} disabled={!items.length || isBusy}>
          {isBusy ? '生成中...' : '生成 PDF'}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <section className="grid">
            {items.map((item) => (
              <SortableCard key={item.id} item={item} onDelete={(id) => setItems((arr) => arr.filter((x) => x.id !== id))} />
            ))}
            {!items.length && <div className="empty">先上传图片，支持拖拽排序与删除。</div>}
          </section>
        </SortableContext>
      </DndContext>
    </main>
  );
}
