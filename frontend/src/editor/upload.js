// Picture uploads for the editor.
//
// Pictures are redrawn through a canvas before upload. That drops EXIF
// (GPS position, camera, date) and shrinks huge photos. House photos become
// JPEG; car cutouts stay PNG so the see-through background survives.
//
// They go to Home Assistant's own image store (POST /api/image/upload) and
// are shown from /api/image/serve/<id>/original. That link works without a
// login, so anyone who has it can open the picture.

export const UPLOAD_PATH = "/api/image/upload";
export const serveUrl = (id) => `/api/image/serve/${id}/original`;

const MAX_BYTES = 10 * 1024 * 1024; // HA's upload limit

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall back to an <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// True if any pixel is noticeably see-through. Checks a scaled copy.
export function hasAlpha(source, w, h) {
  const k = Math.min(1, 256 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 245) return true;
  return false;
}

// File -> {blob, width, height, alpha}. kind: "photo" (JPEG) or "cutout" (PNG).
export async function reencode(file, { kind = "photo", maxWidth = 2400, quality = 0.9 } = {}) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new Error("not_image");
  const img = await decode(file);
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  if (!iw || !ih) throw new Error("not_image");
  const k = Math.min(1, maxWidth / iw);
  const w = Math.round(iw * k);
  const h = Math.round(ih * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  img.close?.();
  const alpha = kind === "cutout" ? hasAlpha(canvas, w, h) : false;
  const type = kind === "cutout" ? "image/png" : "image/jpeg";
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode_failed"))), type, quality));
  if (blob.size > MAX_BYTES) throw new Error("too_big");
  return { blob, width: w, height: h, alpha, type };
}

// Upload to HA's image store. Returns the picture URL.
export async function upload(hass, blob, name = "daymill.jpg") {
  if (typeof hass?.fetchWithAuth !== "function") throw new Error("no_upload");
  const form = new FormData();
  form.append("file", blob, name);
  const resp = await hass.fetchWithAuth(UPLOAD_PATH, { method: "POST", body: form });
  if (!resp || !resp.ok) throw new Error(resp?.status === 413 ? "too_big" : "upload_failed");
  const data = await resp.json();
  if (!data?.id) throw new Error("upload_failed");
  return serveUrl(data.id);
}

// Natural size of a picture URL, or null.
export function imageSize(url) {
  return new Promise((res) => {
    if (!url) return res(null);
    const img = new Image();
    img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => res(null);
    img.src = url;
  });
}
