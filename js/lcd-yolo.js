// lcd-yolo.js — YOLO ONNX 온디바이스 LCD 영역 자동 검출
// YOLOv8n 모델, onnxruntime-web 사용, 서버 불필요

const LcdYolo = (() => {
  const MODEL_PATH = 'models/lcd_detector_512.onnx';
  const INPUT_SIZE = 512;  // 640→512: 추론 ~0.6초로 빠르면서 검출 64/64 유지(320은 58/64로 손실)
  const CONF_THRESH = 0.4;

  let session = null;
  let loadPromise = null;  // 공유 프로미스 — 동시 호출 경합/행 방지

  // GitHub Pages는 crossOriginIsolated=false → SharedArrayBuffer 없음 → 단일 스레드 강제
  if (typeof ort !== 'undefined') {
    ort.env.wasm.numThreads = 1;
  }

  async function load() {
    if (session) return session;
    if (!loadPromise) {
      loadPromise = ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['wasm'],
      }).then(s => { session = s; return s; })
        .catch(e => { loadPromise = null; throw e; });  // 실패 시 재시도 가능하게 리셋
    }
    return loadPromise;
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
    // output shape: [1, 5, N] — N은 입력크기에 따라 다름(640→8400, 320→2100). dims에서 동적으로
    const data = output.data;
    const numDet = output.dims ? output.dims[2] : (data.length / 5);

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
