export type EnhanceMode = 'original' | 'document' | 'bw' | 'gray';

type WorkerRequest = {
  id: string;
  mode: Exclude<EnhanceMode, 'original'>;
  dataUrl: string;
};

type WorkerResponse =
  | { id: string; ok: true; dataUrl: string }
  | { id: string; ok: false; error: string };

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const toGray = (r: number, g: number, b: number): number => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

function applyDocumentEnhance(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = toGray(r, g, b);

    const bgLift = gray > 170 ? 30 : 0;
    const nr = clamp((r - 128) * 1.28 + 128 + bgLift + 8);
    const ng = clamp((g - 128) * 1.28 + 128 + bgLift + 8);
    const nb = clamp((b - 128) * 1.28 + 128 + bgLift + 8);

    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
}

function applyGrayEnhance(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const gray = toGray(data[i], data[i + 1], data[i + 2]);
    const boosted = clamp((gray - 128) * 1.35 + 128 + (gray > 160 ? 25 : 0));
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
}

function applyAdaptiveBW(data: Uint8ClampedArray, width: number, height: number) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = toGray(data[i], data[i + 1], data[i + 2]);
  }

  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  const window = Math.max(15, ((Math.min(width, height) / 20) | 1));
  const half = Math.floor(window / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - half);
      const y1 = Math.max(0, y - half);
      const x2 = Math.min(width - 1, x + half);
      const y2 = Math.min(height - 1, y + half);

      const A = integral[y1 * (width + 1) + x1];
      const B = integral[y1 * (width + 1) + (x2 + 1)];
      const C = integral[(y2 + 1) * (width + 1) + x1];
      const D = integral[(y2 + 1) * (width + 1) + (x2 + 1)];
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const mean = (D - B - C + A) / area;
      const g = gray[y * width + x];
      const bw = g < mean - 10 ? 0 : 255;
      const idx = (y * width + x) * 4;
      data[idx] = bw;
      data[idx + 1] = bw;
      data[idx + 2] = bw;
    }
  }
}

function sharpen(data: Uint8ClampedArray, width: number, height: number, amount = 0.55) {
  const copy = new Uint8ClampedArray(data);
  const idx = (x: number, y: number) => (y * width + x) * 4;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const center = copy[idx(x, y) + c] * 5;
        const around =
          copy[idx(x - 1, y) + c] +
          copy[idx(x + 1, y) + c] +
          copy[idx(x, y - 1) + c] +
          copy[idx(x, y + 1) + c];
        const val = center - around;
        data[idx(x, y) + c] = clamp(copy[idx(x, y) + c] + val * amount * 0.2);
      }
    }
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, mode, dataUrl } = event.data;
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bmp = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas not supported');

    ctx.drawImage(bmp, 0, 0);
    const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const { data } = imageData;

    if (mode === 'document') {
      applyDocumentEnhance(data);
      sharpen(data, bmp.width, bmp.height, 0.5);
    } else if (mode === 'gray') {
      applyGrayEnhance(data);
      sharpen(data, bmp.width, bmp.height, 0.35);
    } else if (mode === 'bw') {
      applyAdaptiveBW(data, bmp.width, bmp.height);
      sharpen(data, bmp.width, bmp.height, 0.2);
    }

    ctx.putImageData(imageData, 0, 0);
    const outBlob = await canvas.convertToBlob({ type: 'image/png', quality: 1 });
    const reader = new FileReader();
    reader.onloadend = () => {
      const result: WorkerResponse = { id, ok: true, dataUrl: reader.result as string };
      self.postMessage(result);
    };
    reader.readAsDataURL(outBlob);
  } catch (error) {
    const result: WorkerResponse = { id, ok: false, error: error instanceof Error ? error.message : '处理失败' };
    self.postMessage(result);
  }
};
