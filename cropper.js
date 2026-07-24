/* =====================================================
   页间集 · 封面裁剪器
   固定 3:4 比例，支持拖动与缩放，输出 600×800 JPEG Blob
===================================================== */

const CROP_RATIO = 3 / 4; // 宽 / 高
const OUT_WIDTH = 600;
const OUT_HEIGHT = 800;

let cropState = {
  file: null,
  naturalWidth: 0,
  naturalHeight: 0,
  onDone: null,
  box: { x: 0, y: 0, w: 0, h: 0 }, // 相对图片显示区域的像素
};

function openCropper(file, onDone) {
  const mask = document.getElementById("cropper-mask");
  const img = document.getElementById("cropper-image");

  cropState.file = file;
  cropState.onDone = onDone;

  const url = URL.createObjectURL(file);
  img.onload = function () {
    cropState.naturalWidth = img.naturalWidth;
    cropState.naturalHeight = img.naturalHeight;
    mask.classList.remove("hidden");
    // 等布局完成后再算初始框
    requestAnimationFrame(resetCrop);
  };
  img.onerror = function () {
    alert("这张图片读不出来，换一张试试");
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function closeCropper() {
  document.getElementById("cropper-mask").classList.add("hidden");
}

/** 图片在页面上的实际显示矩形（相对 stage） */
function getImageRect() {
  const img = document.getElementById("cropper-image");
  const stage = document.getElementById("cropper-stage");
  const ir = img.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();

  return {
    left: ir.left - sr.left,
    top: ir.top - sr.top,
    width: ir.width,
    height: ir.height,
  };
}

/** 居中最大 3:4 */
function resetCrop() {
  const rect = getImageRect();
  let w = rect.width;
  let h = w / CROP_RATIO;

  if (h > rect.height) {
    h = rect.height;
    w = h * CROP_RATIO;
  }

  cropState.box = {
    x: rect.left + (rect.width - w) / 2,
    y: rect.top + (rect.height - h) / 2,
    w: w,
    h: h,
  };
  drawCropBox();
}

function drawCropBox() {
  const box = document.getElementById("crop-box");
  box.style.left = cropState.box.x + "px";
  box.style.top = cropState.box.y + "px";
  box.style.width = cropState.box.w + "px";
  box.style.height = cropState.box.h + "px";
}

/* ===============================
   交互：拖动 / 缩放
================================ */
function initCropInteraction() {
  const box = document.getElementById("crop-box");
  const handle = box.querySelector(".crop-handle");
  let mode = null;
  let startPoint = null;
  let startBox = null;

  function pointOf(e) {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  function begin(e, nextMode) {
    e.preventDefault();
    e.stopPropagation();
    mode = nextMode;
    startPoint = pointOf(e);
    startBox = Object.assign({}, cropState.box);
  }

  function move(e) {
    if (!mode) return;
    e.preventDefault();

    const p = pointOf(e);
    const dx = p.x - startPoint.x;
    const dy = p.y - startPoint.y;
    const rect = getImageRect();

    if (mode === "move") {
      let x = startBox.x + dx;
      let y = startBox.y + dy;
      x = Math.max(rect.left, Math.min(x, rect.left + rect.width - startBox.w));
      y = Math.max(rect.top, Math.min(y, rect.top + rect.height - startBox.h));
      cropState.box = { x: x, y: y, w: startBox.w, h: startBox.h };
    } else {
      // 以左上角为锚点，按宽度驱动，锁定比例
      let w = startBox.w + dx;
      const maxW = Math.min(rect.left + rect.width - startBox.x, (rect.top + rect.height - startBox.y) * CROP_RATIO);
      w = Math.max(60, Math.min(w, maxW));
      cropState.box = { x: startBox.x, y: startBox.y, w: w, h: w / CROP_RATIO };
    }

    drawCropBox();
  }

  function end() {
    mode = null;
  }

  box.addEventListener("mousedown", (e) => begin(e, "move"));
  box.addEventListener("touchstart", (e) => begin(e, "move"), { passive: false });
  handle.addEventListener("mousedown", (e) => begin(e, "resize"));
  handle.addEventListener("touchstart", (e) => begin(e, "resize"), { passive: false });

  window.addEventListener("mousemove", move);
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("mouseup", end);
  window.addEventListener("touchend", end);
  window.addEventListener("resize", () => {
    if (!document.getElementById("cropper-mask").classList.contains("hidden")) resetCrop();
  });
}

/* ===============================
   输出
================================ */
function confirmCrop() {
  const img = document.getElementById("cropper-image");
  const rect = getImageRect();
  const scale = cropState.naturalWidth / rect.width;

  const sx = (cropState.box.x - rect.left) * scale;
  const sy = (cropState.box.y - rect.top) * scale;
  const sw = cropState.box.w * scale;
  const sh = cropState.box.h * scale;

  const canvas = document.createElement("canvas");
  canvas.width = OUT_WIDTH;
  canvas.height = OUT_HEIGHT;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, OUT_WIDTH, OUT_HEIGHT);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_WIDTH, OUT_HEIGHT);

  canvas.toBlob(
    function (blob) {
      closeCropper();
      if (cropState.onDone) cropState.onDone(blob);
    },
    "image/jpeg",
    0.92
  );
}

document.addEventListener("DOMContentLoaded", initCropInteraction);

window.openCropper = openCropper;
window.closeCropper = closeCropper;
window.resetCrop = resetCrop;
window.confirmCrop = confirmCrop;
