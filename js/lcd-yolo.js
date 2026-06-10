// lcd-yolo.js — YOLO ONNX 온디바이스 LCD 영역 자동 검출
// YOLOv8n 모델, onnxruntime-web 사용, 서버 불필요

const LcdYolo = (() => {
  const MODEL_PATH = 'models/lcd_detector.onnx';
  const INPUT_SIZE = 640;
  const CONF_THRESH = 0.4;

  let session = null;
  let loading = false;

  async function load() {
    if (session) return session;
    if (loading) {
      // 이미 로딩 중이면 완료까지 대기
      await new Promise(r => { const t = setInterval(() => { if (session || !loading) { clearInterval(t); r(); } }, 50); });
      return session;
    }
    loading = true;
    try {
      session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['wasm'],
      });
    } finally {
      loading = false;
    }
    return session;
  }

  // 이미지 → 640x640 float32 텐서 (letterbox)
  function preprocess(imageBitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d');

    const iw = imageBitmap.width;
    const ih = imageBitmap.height;
    const scale = Math.min(INPUT_SIZE / iw, INPUT_SIZE / ih);
    const dw = Math.round(iw * scale);
    const dh = Math.round(ih * scale);
    const offX = Math.round((INPUT_SIZE - dw) / 2);
    const offY = Math.round((INPUT_SIZE - dh) / 2);

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx.drawImage(imageBitmap, offX, offY, dw, dh);

    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
      tensor[i]                          = data[i * 4]     / 255; // R
      tensor[i + INPUT_SIZE * INPUT_SIZE]     = data[i * 4 + 1] / 255; // G
      tensor[i + INPUT_SIZE * INPUT_SIZE * 2] = data[i * 4 + 2] / 255; // B
    }
    return { tensor, offX, offY, scale, dw, dh };
  }

  // YOLOv8 output [1,5,8400] → 정규화 bbox {x0,y0,x1,y1} (원본 이미지 기준)
  function postprocess(output, offX, offY, scale, origW, origH) {
    // output shape: [1, 5, 8400]
    const data = output.data;
    const numDet = 8400;

    let best = null;
    let bestScore = CONF_THRESH;

    for (let i = 0; i < numDet; i++) {
      const score = data[4 * numDet + i]; // conf
      if (score < bestScore) continue;

      const cx = data[0 * numDet + i]; // 640 기준
      const cy = data[1 * numDet + i];
      const w  = data[2 * numDet + i];
      const h  = data[3 * numDet + i];

      // letterbox 역변환 → 원본 좌표
      const x0 = ((cx - w / 2) - offX) / scale;
      const y0 = ((cy - h / 2) - offY) / scale;
      const x1 = ((cx + w / 2) - offX) / scale;
      const y1 = ((cy + h / 2) - offY) / scale;

      // 정규화
      const nx0 = Math.max(0, Math.min(1, x0 / origW));
      const ny0 = Math.max(0, Math.min(1, y0 / origH));
      const nx1 = Math.max(0, Math.min(1, x1 / origW));
      const ny1 = Math.max(0, Math.min(1, y1 / origH));

      bestScore = score;
      best = { x0: nx0, y0: ny0, x1: nx1, y1: ny1, score };
    }
    return best;
  }

  // 메인 API: File|Blob → {x0,y0,x1,y1} 또는 null
  async function detect(file) {
    if (typeof ort === 'undefined') { console.warn('[LcdYolo] ort 미로드'); return null; }
    try {
      const sess = await load();
      const bmp = await createImageBitmap(file);
      const { tensor, offX, offY, scale } = preprocess(bmp);
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const results = await sess.run({ images: inputTensor });
      const output = results[Object.keys(results)[0]];
      const bbox = postprocess(output, offX, offY, scale, bmp.width, bmp.height);
      console.log('[LcdYolo] bbox', bbox);
      return bbox;
    } catch (e) {
      console.error('[LcdYolo] 추론 실패', e);
      return null;
    }
  }

  // 앱 시작 시 백그라운드 프리로드 (첫 사진 선택 시 지연 없애기)
  function preload() {
    if (typeof ort === 'undefined') return;
    load().catch(() => {});
  }

  return { detect, preload };
})();
