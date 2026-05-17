// photo-uploader.js — 사진 압축(Canvas) + Firebase Storage 업로드

const PhotoUploader = (() => {

  // 사진 압축: 긴 변 1280px 이하, JPEG quality 0.7
  // → 보통 2~4MB 원본 → 100~250KB
  async function compress(fileOrBlob, maxW = 1280, quality = 0.7) {
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

    if (canvas.convertToBlob) {
      return await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    return await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
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
