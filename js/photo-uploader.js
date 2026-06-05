// photo-uploader.js — 사진 압축(Canvas) + Firebase Storage 업로드

const PhotoUploader = (() => {

  // 사진 압축: 해상도 원본 유지(awms 최소 해상도·용량 검증 충족), JPEG quality 0.85
  // awms는 저해상도/저용량(과압축) 사진을 "파일 업로드 실패"로 거부 → 약압축만 (2~4MB → 1~2MB)
  async function compress(fileOrBlob, maxW = 4096, quality = 0.85) {
    const img = await createImageBitmap(fileOrBlob);
    const ratio = Math.min(maxW / Math.max(img.width, img.height), 1);
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    // OffscreenCanvas 우선 (성능), 폴백 = 일반 canvas
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(w, h);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
    }
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

    let blob;
    if (canvas.convertToBlob) {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    }
    // canvas가 자동 삽입한 ICC 프로파일 제거 — awms saveRow가 ICC 포함 사진 거부(성공사진은 전부 ICC 없음)
    return await stripICC(blob);
  }

  // JPEG에서 APP2 ICC_PROFILE 세그먼트 제거 (픽셀 무손실)
  async function stripICC(blob) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) return blob; // JPEG 아니면 그대로
    const out = [0xFF, 0xD8];
    let i = 2;
    while (i < u8.length) {
      if (u8[i] !== 0xFF) { for (; i < u8.length; i++) out.push(u8[i]); break; }
      const marker = u8[i + 1];
      if (marker === 0xDA) { for (; i < u8.length; i++) out.push(u8[i]); break; } // SOS=이미지 데이터
      const len = (u8[i + 2] << 8) | u8[i + 3];
      let isICC = false;
      if (marker === 0xE2) { // APP2
        let sig = '';
        for (let k = i + 4; k < i + 15 && k < u8.length; k++) sig += String.fromCharCode(u8[k]);
        isICC = sig.startsWith('ICC_PROFILE');
      }
      if (!isICC) for (let j = i; j < i + 2 + len; j++) out.push(u8[j]);
      i += 2 + len;
    }
    return new Blob([new Uint8Array(out)], { type: 'image/jpeg' });
  }

  // Firebase Storage 업로드 — path: replacements/{address}/{filename}
  async function upload(blob, path) {
    if (typeof firebase === 'undefined' || !firebase.storage) {
      throw new Error('Firebase Storage SDK 미로드');
    }
    const ref = firebase.storage().ref(path);
    const snap = await ref.put(blob, { contentType: 'image/jpeg' });
    const url = await snap.ref.getDownloadURL();
    return url;
  }

  // 압축 후 업로드 한 번에
  async function compressAndUpload(fileOrBlob, path) {
    const compressed = await compress(fileOrBlob);
    const url = await upload(compressed, path);
    return { url, size: compressed.size };
  }

  return { compress, upload, compressAndUpload };
})();
