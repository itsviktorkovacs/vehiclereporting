// vehicle-diagrams.js — shared car-silhouette drawing helpers, used both by
// the main Átadás-átvétel screen (handover.js) and the sérülés-zóna editor
// tool (tools/zone-editor.html). Keeping this in one place means updates to
// the diagrams stay in sync between the two.

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawPanelLabel(ctx, panel) {
  ctx.fillStyle = '#5e5e5e';
  ctx.font = '11px sans-serif';
  ctx.fillText(panel.label, panel.x, panel.y - 6);
}

// Per-vehicle-type proportions — simplified, code-drawn approximations
// (not licensed manufacturer technical drawings). "szemelyauto" is loosely
// inspired by an estate/wagon profile, "suv" by a boxier, tall SUV profile,
// "kisbusz" by a single-volume van, "kisteherauto" by a van with a visually
// separate cab + cargo box.
const HO_VEHICLE_PROFILES = {
  szemelyauto: { roofRatio: 0.16, bodyTop: 0.22, radius: 14, roofRadius: 8 },
  suv: { roofRatio: 0.26, bodyTop: 0.14, radius: 8, roofRadius: 5 },
  kisbusz: { roofRatio: 0.4, bodyTop: 0.06, radius: 6, roofRadius: 4 },
  kisteherauto: { roofRatio: 0.4, bodyTop: 0.06, radius: 5, roofRadius: 4 },
};

function drawFrontOrRearPanel(ctx, panel, isFront, vehicleType) {
  const { x, y, w, h } = panel;
  const p = HO_VEHICLE_PROFILES[vehicleType] || HO_VEHICLE_PROFILES.szemelyauto;
  ctx.strokeStyle = '#4a5058';
  ctx.lineWidth = 2;
  roundedRectPath(ctx, x + w * 0.12, y + h * p.bodyTop, w * 0.76, h * (0.96 - p.bodyTop), p.radius);
  ctx.stroke();
  roundedRectPath(ctx, x + w * 0.28, y + h * 0.05, w * 0.44, h * p.roofRatio, p.roofRadius);
  ctx.stroke();
  ctx.strokeStyle = isFront ? '#ff5000' : '#4a5058';
  [x + w * 0.16, x + w * 0.72].forEach(lx => {
    ctx.beginPath();
    ctx.ellipse(lx + w * 0.06, y + h * 0.42, w * 0.06, h * 0.07, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.strokeStyle = '#4a5058';
  ctx.beginPath();
  ctx.rect(x + w * 0.34, y + h * 0.58, w * 0.32, h * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w * 0.14, y + h * 0.8);
  ctx.lineTo(x + w * 0.86, y + h * 0.8);
  ctx.stroke();
  if (vehicleType === 'suv') {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.3, y + h * 0.05);
    ctx.lineTo(x + w * 0.7, y + h * 0.05);
    ctx.stroke();
  }
}

function drawTopPanel(ctx, panel, vehicleType) {
  const { x, y, w, h } = panel;
  const isVan = vehicleType === 'kisbusz' || vehicleType === 'kisteherauto';
  const bodyLen = w * (isVan ? 0.94 : 0.88);
  const bodyH = h * 0.78;
  const bodyX = x + (w - bodyLen) / 2;
  const bodyY = y + (h - bodyH) / 2;
  const radius = Math.min(bodyH * 0.4, 22);

  ctx.strokeStyle = '#4a5058';
  ctx.lineWidth = 2;
  roundedRectPath(ctx, bodyX, bodyY, bodyLen, bodyH, radius);
  ctx.stroke();

  if (vehicleType === 'kisteherauto') {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, bodyY);
    ctx.lineTo(x + w * 0.5, bodyY + bodyH);
    ctx.stroke();
  }

  const glassLen = bodyLen * (isVan ? 0.55 : 0.42);
  const glassH = bodyH * 0.66;
  roundedRectPath(ctx, x + w / 2 - glassLen / 2, bodyY + (bodyH - glassH) / 2, glassLen, glassH, 8);
  ctx.stroke();

  ctx.fillStyle = '#4a5058';
  const wheelW = Math.min(bodyLen * 0.08, 34);
  const wheelH = bodyH * 0.2;
  const wheelMarginX = bodyLen * 0.09;
  [bodyX + wheelMarginX, bodyX + bodyLen - wheelMarginX - wheelW].forEach(wx => {
    [bodyY + bodyH * 0.06, bodyY + bodyH - wheelH - bodyH * 0.06].forEach(wy => {
      ctx.fillRect(wx, wy, wheelW, wheelH);
    });
  });
}

function drawSidePanel(ctx, panel, mirrored, vehicleType) {
  const { x, y, w, h } = panel;
  ctx.save();
  if (mirrored) {
    ctx.translate(x + w, 0);
    ctx.scale(-1, 1);
    ctx.translate(-x, 0);
  }
  ctx.strokeStyle = '#4a5058';
  ctx.lineWidth = 2;
  ctx.beginPath();

  if (vehicleType === 'szemelyauto') {
    ctx.moveTo(x + w * 0.04, y + h * 0.62);
    ctx.lineTo(x + w * 0.04, y + h * 0.5);
    ctx.quadraticCurveTo(x + w * 0.08, y + h * 0.26, x + w * 0.24, y + h * 0.22);
    ctx.lineTo(x + w * 0.32, y + h * 0.1);
    ctx.lineTo(x + w * 0.58, y + h * 0.1);
    ctx.lineTo(x + w * 0.66, y + h * 0.26);
    ctx.lineTo(x + w * 0.9, y + h * 0.28);
    ctx.lineTo(x + w * 0.95, y + h * 0.34);
    ctx.lineTo(x + w * 0.97, y + h * 0.42);
    ctx.lineTo(x + w * 0.97, y + h * 0.62);
    ctx.closePath();
  } else if (vehicleType === 'suv') {
    ctx.moveTo(x + w * 0.04, y + h * 0.66);
    ctx.lineTo(x + w * 0.04, y + h * 0.34);
    ctx.quadraticCurveTo(x + w * 0.06, y + h * 0.16, x + w * 0.22, y + h * 0.14);
    ctx.lineTo(x + w * 0.28, y + h * 0.06);
    ctx.lineTo(x + w * 0.82, y + h * 0.06);
    ctx.quadraticCurveTo(x + w * 0.92, y + h * 0.08, x + w * 0.94, y + h * 0.16);
    ctx.lineTo(x + w * 0.96, y + h * 0.36);
    ctx.lineTo(x + w * 0.96, y + h * 0.66);
    ctx.closePath();
  } else {
    ctx.moveTo(x + w * 0.04, y + h * 0.72);
    ctx.lineTo(x + w * 0.04, y + h * 0.2);
    ctx.quadraticCurveTo(x + w * 0.04, y + h * 0.08, x + w * 0.16, y + h * 0.06);
    ctx.lineTo(x + w * 0.9, y + h * 0.06);
    ctx.quadraticCurveTo(x + w * 0.97, y + h * 0.08, x + w * 0.97, y + h * 0.2);
    ctx.lineTo(x + w * 0.97, y + h * 0.72);
    ctx.closePath();
  }
  ctx.stroke();

  ctx.beginPath();
  if (vehicleType === 'szemelyauto') {
    ctx.moveTo(x + w * 0.14, y + h * 0.48);
    ctx.lineTo(x + w * 0.3, y + h * 0.24);
    ctx.lineTo(x + w * 0.56, y + h * 0.24);
    ctx.lineTo(x + w * 0.64, y + h * 0.38);
    ctx.lineTo(x + w * 0.88, y + h * 0.4);
  } else if (vehicleType === 'suv') {
    ctx.moveTo(x + w * 0.12, y + h * 0.32);
    ctx.lineTo(x + w * 0.26, y + h * 0.18);
    ctx.lineTo(x + w * 0.84, y + h * 0.18);
    ctx.lineTo(x + w * 0.92, y + h * 0.32);
  } else if (vehicleType === 'kisbusz') {
    ctx.moveTo(x + w * 0.1, y + h * 0.18);
    ctx.lineTo(x + w * 0.9, y + h * 0.18);
  } else {
    ctx.moveTo(x + w * 0.1, y + h * 0.18);
    ctx.lineTo(x + w * 0.9, y + h * 0.18);
    ctx.moveTo(x + w * 0.48, y + h * 0.18);
    ctx.lineTo(x + w * 0.48, y + h * 0.62);
    ctx.moveTo(x + w * 0.7, y + h * 0.06);
    ctx.lineTo(x + w * 0.7, y + h * 0.72);
  }
  ctx.stroke();

  const wheelR = vehicleType === 'szemelyauto' ? h * 0.13 : h * 0.15;
  ctx.beginPath();
  ctx.arc(x + w * 0.24, y + h * 0.68, wheelR, 0, Math.PI * 2);
  ctx.stroke();
  const secondWheelX = vehicleType === 'kisteherauto' ? 0.82 : 0.78;
  ctx.beginPath();
  ctx.arc(x + w * secondWheelX, y + h * 0.68, wheelR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Personal-car ("Személyautó") views use real reference images (cropped from
// an uploaded diagram) instead of code-drawn shapes — the other vehicle
// types remain simplified code-drawn approximations.
// window.HO_VEHICLE_IMG_* variables (base64 data-URLs) are loaded from
// vehicle-diagrams-dataurl.js — no path resolution needed here anymore.
// IMPORTANT: these are embedded base64 data-URLs (from
// vehicle-diagrams-dataurl.js), not file paths. This is deliberate — some
// browsers (notably Safari) treat images loaded via relative file:// paths
// as tainting the canvas, which makes canvas.toDataURL() throw a
// SecurityError and silently breaks the "export the marked view" PDF
// feature. Data-URLs never trigger that restriction in any browser,
// regardless of whether the app is opened via file:// or https://.
const HO_VEHICLE_IMAGE_ASSETS = {
  szemelyauto: {
    front: window.HO_VEHICLE_IMG_SZEMELYAUTO_FRONT,
    rear: window.HO_VEHICLE_IMG_SZEMELYAUTO_REAR,
    left: window.HO_VEHICLE_IMG_SZEMELYAUTO_RIGHT,
    right: window.HO_VEHICLE_IMG_SZEMELYAUTO_LEFT,
    top: window.HO_VEHICLE_IMG_SZEMELYAUTO_TOP,
  },
  suv: {
    front: window.HO_VEHICLE_IMG_SUV_FRONT,
    rear: window.HO_VEHICLE_IMG_SUV_REAR,
    left: window.HO_VEHICLE_IMG_SUV_LEFT,
    right: window.HO_VEHICLE_IMG_SUV_RIGHT,
    top: window.HO_VEHICLE_IMG_SUV_TOP,
  },
  kisbusz: {
    front: window.HO_VEHICLE_IMG_KISBUSZ_FRONT,
    rear: window.HO_VEHICLE_IMG_KISBUSZ_REAR,
    left: window.HO_VEHICLE_IMG_KISBUSZ_LEFT,
    right: window.HO_VEHICLE_IMG_KISBUSZ_RIGHT,
    top: window.HO_VEHICLE_IMG_KISBUSZ_TOP,
  },
  kisteherauto: {
    // Top view reuses the Kisbusz top-view reference image (no dedicated
    // Kisteherautó top-view reference was available, and the code-drawn
    // vector fallback was replaced per request).
    front: window.HO_VEHICLE_IMG_KISTEHERAUTO_FRONT,
    rear: window.HO_VEHICLE_IMG_KISTEHERAUTO_REAR,
    left: window.HO_VEHICLE_IMG_KISTEHERAUTO_LEFT,
    right: window.HO_VEHICLE_IMG_KISTEHERAUTO_RIGHT,
    top: window.HO_VEHICLE_IMG_KISTEHERAUTO_TOP,
  },
};
const HO_IMAGE_CACHE = {};

// Returns a loaded Image for this URL if ready, otherwise kicks off loading
// and returns null — the caller should redraw once onLoadCallback fires.
function hoGetOrLoadImage(url, onLoadCallback) {
  const cached = HO_IMAGE_CACHE[url];
  if (cached && cached.complete && cached.naturalWidth > 0) return cached;
  if (cached) {
    // Already loading (kicked off by an earlier caller, e.g. the eager
    // preload) — just add this caller to the list notified on completion,
    // instead of silently dropping their callback.
    if (onLoadCallback) cached.__hoCallbacks.push(onLoadCallback);
    return null;
  }
  const img = new Image();
  img.__hoCallbacks = onLoadCallback ? [onLoadCallback] : [];
  img.onload = () => {
    const callbacks = img.__hoCallbacks;
    img.__hoCallbacks = [];
    callbacks.forEach(cb => {
      try { cb(); } catch (err) { /* one failing callback must never block the others */ }
    });
  };
  img.src = url;
  HO_IMAGE_CACHE[url] = img;
  return null;
}

// Draws `img` centered inside `box`, scaled to fit without distortion
// ("contain" behaviour, like CSS object-fit: contain).
function hoDrawImageContain(ctx, img, box) {
  const scale = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = box.x + (box.w - drawW) / 2;
  const dy = box.y + (box.h - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

// Draws a single panel (front/rear/top/left/right) into `panel` (an
// {x,y,w,h,label} box) for the given vehicleType, using the real reference
// images for "szemelyauto" and code-drawn shapes for the other types.
// `onImageLoad` is called once an initially-unavailable image finishes
// loading, so the caller can redraw.
function drawVehiclePanel(ctx, panelKey, panel, vehicleType, onImageLoad) {
  const imageAssets = HO_VEHICLE_IMAGE_ASSETS[vehicleType];
  if (imageAssets && imageAssets[panelKey]) {
    const img = hoGetOrLoadImage(imageAssets[panelKey], onImageLoad);
    if (img) hoDrawImageContain(ctx, img, panel);
    return;
  }
  if (panelKey === 'front') drawFrontOrRearPanel(ctx, panel, true, vehicleType);
  else if (panelKey === 'rear') drawFrontOrRearPanel(ctx, panel, false, vehicleType);
  else if (panelKey === 'top') drawTopPanel(ctx, panel, vehicleType);
  else if (panelKey === 'left') drawSidePanel(ctx, panel, false, vehicleType);
  else if (panelKey === 'right') drawSidePanel(ctx, panel, true, vehicleType);
}
