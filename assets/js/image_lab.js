(() => {
  const $ = (id) => document.getElementById(id);
  const state = { matrix: null, width: 0, height: 0, blob: null, blur: "none", kernel: "edge", convMode: "convolution", convType: "normal", convResult: null, convMap: { cols: 0, rows: 0 }, convRun: 0, scanning: false, poolKind: "max", poolResult: null, poolMap: { cols: 0, rows: 0 }, poolRun: 0, poolScanning: false, bound: false, sampleX: 0, sampleY: 0, channel: { red: true, green: true, blue: true } };
  const dbReady = new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const request = indexedDB.open("pixel-foundations", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
      if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => resolve(null);
  });
  const kernels = {
    edge: { values: [-1,-1,-1,-1,8,-1,-1,-1,-1], name: "Edge detect", description: "Edge detection responds strongly where brightness changes." },
    sharpen: { values: [0,-1,0,-1,5,-1,0,-1,0], name: "Sharpen", description: "Sharpen keeps the center pixel and subtracts its neighbors." },
    blur: { values: Array(9).fill(1 / 9), name: "Box blur", description: "Box blur averages the nine pixels under the kernel." },
    emboss: { values: [-2,-1,0,-1,1,1,0,1,2], name: "Emboss", description: "Emboss highlights changes along one direction, creating a raised look." },
  };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

  function saveImage() {
    dbReady.then((db) => {
      if (!db || !state.matrix) return;
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").put({ id: "latest", blob: state.blob, width: state.width, height: state.height, matrix: state.matrix, savedAt: Date.now() });
    });
  }

  function restoreImage() {
    dbReady.then((db) => {
      if (!db) return;
      const request = db.transaction("images", "readonly").objectStore("images").get("latest");
      request.onsuccess = () => {
        const saved = request.result;
        if (saved?.blob && saved?.matrix) loadPixels(saved.blob, saved.matrix, saved.width, saved.height);
      };
    });
  }

  function loadPixels(blob, matrix, width, height) {
    state.blob = blob;
    state.matrix = new Uint8ClampedArray(matrix);
    state.width = width;
    state.height = height;
    state.sampleX = Math.floor(width / 2);
    state.sampleY = Math.floor(height / 2);
    const imageUrl = URL.createObjectURL(blob);
    $("source-image").src = imageUrl;
    $("source-image").classList.remove("hidden");
    $("empty-preview").classList.add("hidden");
    $("image-meta").classList.remove("hidden");
    $("image-meta").textContent = `${width} × ${height} pixels · local matrix ready`;
    $("result-dimensions").textContent = `${width} × ${height}`;
    renderChannels();
    tone.probe = null; blur.probe = null;
    renderOperations();
    renderBlur();
    renderHsvPreview();
    renderMatrixGrid();
    renderKernel();
    renderPoolPreview();
    updatePixelSample(Math.floor(width / 2), Math.floor(height / 2));
  }

  function updatePixelSample(x, y) {
    if (!state.matrix) return;
    state.sampleX = x;
    state.sampleY = y;
    const i = (y * state.width + x) * 4;
    const r = state.channel.red ? state.matrix[i] : 0;
    const g = state.channel.green ? state.matrix[i + 1] : 0;
    const b = state.channel.blue ? state.matrix[i + 2] : 0;
    $("pixel-readout").textContent = `x ${x}  y ${y}  ·  R ${r}  G ${g}  B ${b}`;
    $("pixel-swatch").style.background = `rgb(${r},${g},${b})`;
    const cells = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const sx = Math.max(0, Math.min(state.width - 1, x + dx));
      const sy = Math.max(0, Math.min(state.height - 1, y + dy));
      const at = (sy * state.width + sx) * 4;
      const r = state.channel.red ? state.matrix[at] : 0;
      const g = state.channel.green ? state.matrix[at + 1] : 0;
      const b = state.channel.blue ? state.matrix[at + 2] : 0;
      const color = `rgb(${r},${g},${b})`;
      const cell = document.createElement("span");
      cell.className = "tensor-cell";
      cell.style.boxShadow = `inset 0 0 0 1px ${color}22`;
      cell.textContent = `(${r}, ${g}, ${b})`;
      cells.push(cell);
    }
    $("pixel-matrix").replaceChildren(...cells);
  }

  function decodeFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    createImageBitmap(file).then((bitmap) => {
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      loadPixels(file, data, canvas.width, canvas.height);
      saveImage();
    }).catch(() => { $("image-meta").textContent = "Could not decode this image."; });
  }

  function renderChannels() {
    const means = [0, 0, 0];
    const count = state.width * state.height;
    if (state.matrix) for (let i = 0; i < state.matrix.length; i += 4) {
      means[0] += state.matrix[i]; means[1] += state.matrix[i + 1]; means[2] += state.matrix[i + 2];
    }
    ["red", "green", "blue"].forEach((name, channel) => {
      const card = $(`channel-${name}`);
      card.classList.toggle("active", state.channel[name]);
      card.querySelector(".channel-state").textContent = state.channel[name] ? "ON" : "OFF";
      if (!state.matrix) { $(`${name}-value`).textContent = "—"; return; }
      $(`${name}-value`).textContent = count ? `${state.channel[name] ? Math.round(means[channel] / count) : 0} / 255` : "—";
      const canvas = document.createElement("canvas");
      canvas.width = state.width; canvas.height = state.height;
      const ctx = canvas.getContext("2d");
      const out = ctx.createImageData(state.width, state.height);
      for (let i = 0; i < state.matrix.length; i += 4) {
        const v = state.channel[name] ? state.matrix[i + channel] : 0;
        out.data[i + channel] = v; out.data[i + 3] = state.matrix[i + 3];
      }
      ctx.putImageData(out, 0, 0);
      const preview = card.querySelector(".channel-preview");
      preview.replaceChildren(canvas);
      canvas.style.width = "100%"; canvas.style.height = "100%"; canvas.style.objectFit = "cover"; canvas.style.borderRadius = "inherit";
    });
    renderCompositeImage();
    if (state.matrix) updatePixelSample(state.sampleX, state.sampleY);
  }

  function renderCompositeImage() {
    if (!state.matrix) return;
    const canvas = $("rgb-composite-canvas");
    const output = new Uint8ClampedArray(state.matrix.length);
    for (let i = 0; i < state.matrix.length; i += 4) {
      output[i] = state.channel.red ? state.matrix[i] : 0;
      output[i + 1] = state.channel.green ? state.matrix[i + 1] : 0;
      output[i + 2] = state.channel.blue ? state.matrix[i + 2] : 0;
      output[i + 3] = state.matrix[i + 3];
    }
    canvas.width = state.width; canvas.height = state.height;
    canvas.getContext("2d").putImageData(new ImageData(output, state.width, state.height), 0, 0);
    canvas.classList.remove("hidden");
    $("rgb-composite-empty").classList.add("hidden");
    $("rgb-channel-status").textContent = ["red", "green", "blue"].filter(name => state.channel[name]).map(name => name[0].toUpperCase() + name.slice(1)).join(" + ") || "All channels off · black image";
  }

  function convolve(source, width, height, values, divisor = 1, bias = 0) {
    const out = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.max(0, Math.min(width - 1, x + kx));
          const sy = Math.max(0, Math.min(height - 1, y + ky));
          sum += source[(sy * width + sx) * 4 + c] * values[(ky + 1) * 3 + kx + 1];
        }
        out[dst + c] = clamp(sum / divisor + bias);
      }
      out[dst + 3] = source[dst + 3];
    }
    return out;
  }

  function blurPixels(source, width, height, radius, mode) {
    const out = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const values = [];
        let sum = 0, weightSum = 0;
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          const sy = Math.max(0, Math.min(height - 1, y + dy));
          const value = source[(sy * width + sx) * 4 + c];
          if (mode === "median") values.push(value);
          else {
            const weight = mode === "gaussian" ? Math.exp(-(dx * dx + dy * dy) / (2 * Math.max(1, radius * radius / 2))) : 1;
            sum += value * weight; weightSum += weight;
          }
        }
        if (mode === "median") { values.sort((a, b) => a - b); out[dst + c] = values[Math.floor(values.length / 2)]; }
        else out[dst + c] = clamp(sum / weightSum);
      }
      out[dst + 3] = source[dst + 3];
    }
    return out;
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, max ? d / max : 0, max];
  }
  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const rgb = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
    return rgb.map(n => clamp((n + m) * 255));
  }

  function currentHsvAdjustment() {
    return {
      hue: Number($("hsv-hue").value),
      saturation: Number($("hsv-saturation").value) / 100,
      value: Number($("hsv-value").value) / 100,
    };
  }

  function renderHsvCone() {
    const canvas = $("hsv-cone");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { hue, saturation, value } = currentHsvAdjustment();
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, baseY = h - 38, coneHeight = 222, radius = 122;
    const border = getComputedStyle(canvas).getPropertyValue("--border").trim() || "#888";
    const ink = getComputedStyle(canvas).getPropertyValue("--foreground").trim() || "#222";
    const project = (angle, s, v) => {
      const a = angle * Math.PI / 180;
      const r = radius * v * s;
      return { x: cx + Math.cos(a) * r, y: baseY - coneHeight * v + Math.sin(a) * r * .42 };
    };
    const path = (points) => {
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
    };
    ctx.clearRect(0, 0, w, h);
    const apex = { x: cx, y: baseY };
    const top = Array.from({ length: 6 }, (_, i) => project(i * 60, 1, 1));

    for (let i = 0; i < 6; i++) {
      const middleHue = i * 60 + 30;
      path([apex, top[i], top[(i + 1) % 6]]);
      const sideColor = hsvToRgb(middleHue, .82, .72);
      ctx.fillStyle = `rgba(${sideColor[0]},${sideColor[1]},${sideColor[2]},.18)`;
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(apex.x, apex.y); ctx.lineTo(top[i].x, top[i].y); ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke();
    }
    for (const level of [.25, .5, .75, 1]) {
      const ring = Array.from({ length: 6 }, (_, i) => project(i * 60, 1, level));
      path(ring); ctx.strokeStyle = border; ctx.lineWidth = level === 1 ? 1.5 : 1; ctx.stroke();
    }
    const topCenter = { x: cx, y: baseY - coneHeight };
    for (let i = 0; i < 6; i++) {
      path([topCenter, top[i], top[(i + 1) % 6]]);
      const color = hsvToRgb(i * 60 + 30, 1, 1);
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},.72)`; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, topCenter.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = border; ctx.stroke();
    const marker = project(hue % 360, Math.min(1, saturation), Math.min(1, value));
    ctx.beginPath(); ctx.moveTo(apex.x, apex.y); ctx.lineTo(marker.x, marker.y); ctx.setLineDash([4, 4]); ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(marker.x, marker.y, 7, 0, Math.PI * 2); ctx.fillStyle = `rgb(${hsvToRgb(hue % 360, Math.min(1, saturation), Math.min(1, value)).join(",")})`; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = `10px ${getComputedStyle(canvas).fontFamily}`; ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.fillText("V = 1 · white center", 10, 18); ctx.fillText("V = 0 · black tip", 10, h - 8);
    $("hsv-setting-readout").textContent = `ΔH ${hue}° · S ${Math.round(saturation * 100)}% · V ${Math.round(value * 100)}%`;
  }

  function renderHsvPreview() {
    renderHsvCone();
    if (!state.matrix) return;
    const canvas = $("hsv-image-canvas");
    const pixels = new Uint8ClampedArray(state.matrix);
    const { hue, saturation, value } = currentHsvAdjustment();
    for (let i = 0; i < pixels.length; i += 4) {
      const [h, s, v] = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);
      const rgb = hsvToRgb((h + hue) % 360, Math.min(1, s * saturation), Math.min(1, v * value));
      pixels[i] = rgb[0]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[2];
    }
    canvas.width = state.width; canvas.height = state.height;
    canvas.getContext("2d").putImageData(new ImageData(pixels, state.width, state.height), 0, 0);
  }

  // ================= 02 / TONE & DETAIL =================
  const tone = { stages: null, probe: null };
  const GRAY_PRESETS = [[33, 33, 33], [30, 59, 11], [21, 72, 7], [28, 52, 16]];
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const f1 = (v) => (Math.round(v * 10) / 10).toString();

  function renderOperations() {
    renderSharpKernel();
    const base = state.matrix;
    const w = ["gray-r", "gray-g", "gray-b"].map((id) => Number($(id).value));
    const total = w[0] + w[1] + w[2] || 1;
    renderWeightBar(w, total);
    document.querySelectorAll("[data-gray]").forEach((b) => b.classList.toggle("selected", b.dataset.gray === w.join(",")));
    if (!base) { drawContrastCurve(null); drawSharpProfile(); return; }
    const gray = new Uint8ClampedArray(base);
    if ($("grayscale-toggle").checked) {
      for (let i = 0; i < gray.length; i += 4) { const l = (gray[i] * w[0] + gray[i + 1] * w[1] + gray[i + 2] * w[2]) / total; gray[i] = gray[i + 1] = gray[i + 2] = l; }
    }
    const c = Number($("contrast").value) / 100, contrast = new Uint8ClampedArray(gray);
    for (let i = 0; i < contrast.length; i += 4) for (let ch = 0; ch < 3; ch++) contrast[i + ch] = clamp((contrast[i + ch] - 128) * c + 128);
    const k = Number($("sharpen").value);
    const final = k > 0 ? convolve(contrast, state.width, state.height, [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0]) : contrast;
    tone.stages = { base, gray, contrast, final };
    for (const [id, data] of [["operation-canvas", final]]) {
      const cv = $(id); cv.width = state.width; cv.height = state.height;
      cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), state.width, state.height), 0, 0);
    }
    if (!tone.probe) tone.probe = { x: Math.floor(state.width / 2), y: Math.floor(state.height / 2) };
    drawContrastCurve(gray); drawSharpProfile(); renderProbe();
  }

  function renderWeightBar(w, total) {
    const bar = $("gray-weights"); if (!bar) return;
    bar.replaceChildren(...["red", "green", "blue"].map((name, i) => {
      const s = document.createElement("span"); s.className = name; s.style.flex = `${Math.max(w[i], 0.0001)} 0 0`;
      s.textContent = `${["R", "G", "B"][i]} ${Math.round(w[i] / total * 100)}%`; return s;
    }));
  }

  function drawContrastCurve(grayPixels) {
    const cv = $("contrast-curve"); if (!cv) return;
    const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, pad = 26, c = Number($("contrast").value) / 100;
    const X = (v) => pad + (v / 255) * (W - pad - 8), Y = (v) => H - pad - (v / 255) * (H - pad - 8);
    const fg = css("--foreground", "#222"), mut = css("--muted-foreground", "#888"), line = css("--border", "#ccc"), pri = css("--primary", "#0a7"), neg = "#d4474c";
    ctx.clearRect(0, 0, W, H); ctx.font = "11px ui-monospace,monospace";
    // input histogram (what the curve acts on)
    let clipped = 0, count = 0;
    if (grayPixels) {
      const bins = new Array(64).fill(0);
      for (let i = 0; i < grayPixels.length; i += 4) {
        const v = grayPixels[i]; bins[v >> 2]++; count++;
        const o = (v - 128) * c + 128; if (o < 0 || o > 255) clipped++;
      }
      const max = Math.max(...bins);
      ctx.fillStyle = "rgba(100,140,200,.28)";
      bins.forEach((n, i) => { const h = (n / max) * (H - pad - 8) * .55; ctx.fillRect(X(i * 4), H - pad - h, X(4) - X(0) + .5, h); });
    }
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.strokeRect(X(0), Y(255), X(255) - X(0), Y(0) - Y(255));
    ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(255), Y(255)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(X(128), Y(0)); ctx.lineTo(X(128), Y(255)); ctx.moveTo(X(0), Y(128)); ctx.lineTo(X(255), Y(128)); ctx.stroke();
    // curve, red where clipped
    ctx.lineWidth = 3;
    let prev = null;
    for (let v = 0; v <= 255; v += 1) {
      const raw = (v - 128) * c + 128, out = clamp(raw), clip = raw < 0 || raw > 255;
      if (prev) { ctx.strokeStyle = clip ? neg : pri; ctx.beginPath(); ctx.moveTo(X(prev.v), Y(prev.out)); ctx.lineTo(X(v), Y(out)); ctx.stroke(); }
      prev = { v, out };
    }
    ctx.fillStyle = mut; ctx.fillText("input", W - 46, H - 8); ctx.fillText("output", 2, 12);
    ctx.fillText("0", X(0) - 3, H - 10); ctx.fillText("128", X(128) - 10, H - 10); ctx.fillText("255", X(255) - 18, H - 10);
    // probe marker
    if (tone.stages && tone.probe) {
      const i = (tone.probe.y * state.width + tone.probe.x) * 4, v = tone.stages.gray[i], o = clamp((v - 128) * c + 128);
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(X(v), Y(o), 5, 0, 7); ctx.fill();
    }
    cv.dataset.clip = count ? (clipped / count * 100).toFixed(1) : "0";
  }

  function sharpenKernel(k) { return [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0]; }
  function renderSharpKernel() {
    const el = $("sharp-kernel"); if (!el) return;
    const k = Number($("sharpen").value);
    el.replaceChildren(...sharpenKernel(k).map((v) => {
      const s = document.createElement("span"); s.textContent = f1(v);
      s.style.background = v === 0 ? "var(--secondary)" : v > 0 ? `color-mix(in oklab, var(--primary) ${Math.min(80, 20 + v * 12)}%, var(--secondary))` : `color-mix(in oklab, #d4474c ${Math.min(70, 20 + Math.abs(v) * 25)}%, var(--secondary))`;
      return s;
    }));
  }
  function drawSharpProfile() {
    const cv = $("sharp-profile"); if (!cv) return;
    const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, k = Number($("sharpen").value), N = 26;
    const sig = Array.from({ length: N }, (_, i) => { const t = clamp((i - 9) / 7, 0, 1); return 70 + 110 * (t * t * (3 - 2 * t)); });
    const out = sig.map((v, i) => { const a = sig[Math.max(0, i - 1)], b = sig[Math.min(N - 1, i + 1)]; return v + k * (2 * v - a - b) * 2; });
    const X = (i) => 10 + (i / (N - 1)) * (W - 20), Y = (v) => H - 14 - (clamp(v, -20, 275) + 20) / 295 * (H - 24);
    ctx.clearRect(0, 0, W, H); ctx.lineWidth = 2;
    ctx.strokeStyle = css("--border", "#ccc"); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(10, Y(255)); ctx.lineTo(W - 10, Y(255)); ctx.moveTo(10, Y(0)); ctx.lineTo(W - 10, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    for (const [arr, color] of [[sig, css("--muted-foreground", "#888")], [out, css("--primary", "#0a7")]]) {
      ctx.strokeStyle = color; ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
    }
    ctx.fillStyle = css("--muted-foreground", "#888"); ctx.font = "10px ui-monospace,monospace";
    ctx.fillText("gray = original edge", 12, 12); ctx.fillStyle = css("--primary", "#0a7"); ctx.fillText("green = sharpened (1-D slice)", 12, 24);
  }

  function renderProbe() {
    if (!tone.stages || !tone.probe) return;
    const { x, y } = tone.probe, W = state.width, H = state.height, i = (y * W + x) * 4, st = tone.stages;
    const rgb = (a) => `(${a[i]}, ${a[i + 1]}, ${a[i + 2]})`;
    $("tone-probe").textContent = `pixel (${x}, ${y})   input ${rgb(st.base)}  →  gray ${rgb(st.gray)}  →  contrast ${rgb(st.contrast)}  →  sharpen ${rgb(st.final)}`;
    const w = ["gray-r", "gray-g", "gray-b"].map((id) => Number($(id).value)), total = w[0] + w[1] + w[2] || 1;
    const [R, G, B] = [st.base[i], st.base[i + 1], st.base[i + 2]];
    $("gray-live").textContent = $("grayscale-toggle").checked
      ? `this pixel: (${w[0]}×${R} + ${w[1]}×${G} + ${w[2]}×${B}) / ${total} = ${f1((R * w[0] + G * w[1] + B * w[2]) / total)}`
      : `grayscale is off: this pixel stays (${R}, ${G}, ${B}). Tick “Apply grayscale”.`;
    const c = Number($("contrast").value) / 100, v = st.gray[i], raw = (v - 128) * c + 128;
    $("contrast-live").textContent = `this pixel (R): (${v} − 128) × ${c.toFixed(2)} + 128 = ${f1(raw)}${raw < 0 || raw > 255 ? "  → clipped to " + clamp(raw) : ""}   ·   ${$("contrast-curve").dataset.clip}% of pixels are clipped`;
    const k = Number($("sharpen").value), at = (dx, dy) => st.contrast[(clamp(y + dy, 0, H - 1) * W + clamp(x + dx, 0, W - 1)) * 4];
    const c0 = at(0, 0), n = [at(0, -1), at(0, 1), at(-1, 0), at(1, 0)], diff = 4 * c0 - n[0] - n[1] - n[2] - n[3];
    $("sharpen-live").textContent = `this pixel (R): ${c0} + ${k.toFixed(1)} × (4×${c0} − ${n.join(" − ")}) = ${c0} + ${k.toFixed(1)} × ${diff} = ${f1(c0 + k * diff)}`;
  }

  function bindToneProbe(canvas) {
    canvas.addEventListener("mousemove", (e) => {
      if (!state.matrix) return;
      const r = canvas.getBoundingClientRect();
      tone.probe = { x: clamp(Math.floor((e.clientX - r.left) / r.width * state.width), 0, state.width - 1), y: clamp(Math.floor((e.clientY - r.top) / r.height * state.height), 0, state.height - 1) };
      renderProbe(); drawContrastCurve(tone.stages.gray);
    });
  }

  // ================= 03 / BLUR =================
  const blur = { type: "box", src: null, key: null, noise: null, out: null, probe: null, raf: 0, lut: null, lutSigma: 0 };
  const BLUR_INFO = {
    box: { title: "BOX BLUR", viz: "Kernel weights", desc: "Every pixel in the (2r+1)×(2r+1) window counts equally. Cheap and simple, but it smears edges and gives a boxy look.", formula: "out(x,y) = 1/(2r+1)² · Σi Σj in(x+i, y+j),   i, j ∈ [−r, r]", tip: "Best for: fast smoothing and as a building block of fast filters. Weakness: every edge softens equally and noise is only averaged, never removed." },
    gaussian: { title: "GAUSSIAN BLUR", viz: "Kernel weights", desc: "Nearby pixels count more than far ones, following a bell curve. σ sets how wide the bell is; r only decides where the kernel is cut off (use r ≥ 3σ to avoid visible cut-off).", formula: "G(i,j) = e^( −(i² + j²) / (2σ²) ) / Z,    out(x,y) = Σ G(i,j) · in(x+i, y+j)", tip: "Best for: natural-looking blur, smoothing before edge detection or downscaling. It is separable, so two 1-D passes give the identical result much faster." },
    median: { title: "MEDIAN FILTER", viz: "Sorted neighborhood", desc: "Sort the window and keep the middle value. Nothing is averaged, so an extreme outlier never leaks into its neighbors.", formula: "out(x,y) = median{ in(x+i, y+j) : |i| ≤ r, |j| ≤ r }", tip: "Best for: salt-and-pepper noise (switch the noise toggle on and compare with Box). Keeps edges sharper than averaging, but is non-linear, slower, and erases thin lines." },
    bilateral: { title: "BILATERAL FILTER", viz: "Weights at the probed pixel", desc: "A Gaussian whose weights also shrink when a neighbor's color differs from the center. Flat areas are smoothed, strong edges are protected.", formula: "w = e^( −(i²+j²)/(2σs²) ) · e^( −‖in(p+q) − in(p)‖² / (2σr²) ),    out = Σ w·in / Σ w", tip: "Best for: denoising and skin smoothing without blurring outlines. σs = how far to look, σr = how different a color may be and still be averaged. A huge σr turns it into a plain Gaussian." },
    motion: { title: "MOTION BLUR", viz: "Line kernel", desc: "Average along one straight line, as if the camera moved during the exposure. Length sets the streak size, angle sets its direction.", formula: "out(x,y) = 1/L · Σt in(x + t·cosθ, y − t·sinθ),    t spread over L samples centered at 0", tip: "Best for: speed effects and modelling real camera shake. It blurs only along one direction, so edges perpendicular to the line stay sharp." },
  };

  function blurSource() {
    if (!state.matrix) return null;
    const noise = $("blur-noise").checked;
    if (blur.src && blur.key === state.matrix && blur.noise === noise) return blur.src;
    const sc = Math.min(1, 300 / Math.max(state.width, state.height)), W = Math.max(8, Math.round(state.width * sc)), H = Math.max(8, Math.round(state.height * sc));
    const a = document.createElement("canvas"); a.width = state.width; a.height = state.height; a.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(state.matrix), state.width, state.height), 0, 0);
    const b = document.createElement("canvas"); b.width = W; b.height = H; const bx = b.getContext("2d"); bx.drawImage(a, 0, 0, W, H);
    const img = bx.getImageData(0, 0, W, H), d = img.data;
    if (noise) { let seed = 20240607; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); for (let i = 0; i < d.length; i += 4) { const r = rnd(); if (r < 0.05) d[i] = d[i + 1] = d[i + 2] = r < 0.025 ? 0 : 255; } }
    blur.key = state.matrix; blur.noise = noise; blur.src = { w: W, h: H, data: d };
    return blur.src;
  }

  function sepFilter(src, k) { // symmetric 1-D kernel, edge clamp
    const { w, h, data } = src, r = (k.length - 1) / 2, tmp = new Float32Array(data.length), out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let s = 0; for (let i = -r; i <= r; i++) s += data[(y * w + clamp(x + i, 0, w - 1)) * 4 + c] * k[i + r];
      tmp[(y * w + x) * 4 + c] = s;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) { let s = 0; for (let i = -r; i <= r; i++) s += tmp[(clamp(y + i, 0, h - 1) * w + x) * 4 + c] * k[i + r]; out[(y * w + x) * 4 + c] = s; }
      out[(y * w + x) * 4 + 3] = 255;
    }
    return out;
  }
  const boxKernel = (r) => Array(2 * r + 1).fill(1 / (2 * r + 1));
  function gaussKernel(r, sigma) { const k = []; let s = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; } return k.map((v) => v / s); }
  function medianFilter(src, r) {
    const { w, h, data } = src, out = new Uint8ClampedArray(data.length), n = (2 * r + 1) ** 2, buf = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let m = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) buf[m++] = data[(clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4 + c];
        buf.sort(); out[o + c] = buf[n >> 1];
      }
      out[o + 3] = 255;
    }
    return out;
  }
  function rangeLut(sr) { if (blur.lut && blur.lutSigma === sr) return blur.lut; const l = new Float32Array(3 * 255 * 255 + 1); for (let i = 0; i < l.length; i++) l[i] = Math.exp(-i / (2 * sr * sr)); blur.lut = l; blur.lutSigma = sr; return l; }
  function bilateralFilter(src, r, ss, sr) {
    const { w, h, data } = src, out = new Uint8ClampedArray(data.length), lut = rangeLut(sr), sp = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) sp.push(Math.exp(-(dx * dx + dy * dy) / (2 * ss * ss)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, r0 = data[o], g0 = data[o + 1], b0 = data[o + 2]; let sr_ = 0, sg = 0, sb = 0, sw = 0, m = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const q = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4, dr = data[q] - r0, dg = data[q + 1] - g0, db = data[q + 2] - b0;
        const wt = sp[m++] * lut[dr * dr + dg * dg + db * db]; sr_ += data[q] * wt; sg += data[q + 1] * wt; sb += data[q + 2] * wt; sw += wt;
      }
      out[o] = sr_ / sw; out[o + 1] = sg / sw; out[o + 2] = sb / sw; out[o + 3] = 255;
    }
    return out;
  }
  function motionEntries(len, angleDeg) {
    const a = angleDeg * Math.PI / 180, R = Math.ceil((len - 1) / 2), map = new Map(), steps = Math.max(2, (len - 1) * 2);
    for (let s = 0; s <= steps; s++) { const t = -(len - 1) / 2 + (s / steps) * (len - 1), dx = Math.round(t * Math.cos(a)), dy = Math.round(-t * Math.sin(a)), key = dx + "," + dy; map.set(key, (map.get(key) || 0) + 1); }
    const total = [...map.values()].reduce((p, c) => p + c, 0);
    return { R, entries: [...map].map(([k, v]) => { const [dx, dy] = k.split(",").map(Number); return { dx, dy, w: v / total }; }) };
  }
  function motionFilter(src, len, angle) {
    const { w, h, data } = src, { entries } = motionEntries(len, angle), out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; let r = 0, g = 0, b = 0;
      for (const e of entries) { const q = (clamp(y + e.dy, 0, h - 1) * w + clamp(x + e.dx, 0, w - 1)) * 4; r += data[q] * e.w; g += data[q + 1] * e.w; b += data[q + 2] * e.w; }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
    return out;
  }

  const bval = (id) => Number($(id).value);
  function runBlur(src) {
    const t = blur.type, r = bval("b-radius");
    if (t === "box") return sepFilter(src, boxKernel(r));
    if (t === "gaussian") return sepFilter(src, gaussKernel(r, bval("b-sigma")));
    if (t === "median") return medianFilter(src, r);
    if (t === "bilateral") return bilateralFilter(src, r, bval("b-sigs"), bval("b-sigr"));
    return motionFilter(src, bval("b-len"), bval("b-angle"));
  }

  function renderBlurText() {
    const info = BLUR_INFO[blur.type];
    $("blur-title").textContent = info.title; $("blur-desc").textContent = info.desc; $("blur-formula").textContent = info.formula; $("blur-tip").textContent = info.tip; $("blur-viz-title").textContent = info.viz;
    document.querySelectorAll("[data-for]").forEach((g) => g.classList.toggle("hidden", !g.dataset.for.split(" ").includes(blur.type)));
    document.querySelectorAll("[data-blurtype]").forEach((b) => b.classList.toggle("selected", b.dataset.blurtype === blur.type));
  }

  function renderBlur() {
    renderBlurText();
    const src = blurSource(); if (!src) return;
    blur.out = $("blur-compare").checked ? src.data : runBlur(src);
    const cv = $("blur-canvas"); cv.width = src.w; cv.height = src.h;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(blur.out), src.w, src.h), 0, 0);
    $("blur-dims").textContent = `${src.w} × ${src.h} working copy`;
    if (!blur.probe) blur.probe = { x: Math.floor(src.w / 2), y: Math.floor(src.h / 2) };
    blur.probe.x = clamp(blur.probe.x, 0, src.w - 1); blur.probe.y = clamp(blur.probe.y, 0, src.h - 1);
    renderBlurViz();
  }
  function scheduleBlur() { cancelAnimationFrame(blur.raf); blur.raf = requestAnimationFrame(renderBlur); }

  function kernelGrid(weights, n, labels) {
    const max = Math.max(...weights, 1e-9), grid = document.createElement("div"); grid.className = "kernel-grid";
    grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`; grid.style.width = `${Math.min(100, n * 8 + 40)}%`; grid.style.maxWidth = `${n * 30}px`;
    weights.forEach((v) => {
      const s = document.createElement("span"); s.style.background = `color-mix(in oklab, var(--primary) ${Math.round(Math.pow(v / max, .7) * 85)}%, var(--secondary))`; s.title = `${(v * 100).toFixed(2)}%`;
      if (labels) s.textContent = (v * 100).toFixed(1); grid.appendChild(s);
    });
    return grid;
  }
  function renderBlurViz() {
    const src = blur.src, box = $("blur-viz"), t = blur.type; if (!src) return;
    const r = bval("b-radius"), { x, y } = blur.probe, note = $("blur-viz-note"), tag = $("blur-viz-tag");
    box.replaceChildren();
    const lum = (px, py) => { const q = (clamp(py, 0, src.h - 1) * src.w + clamp(px, 0, src.w - 1)) * 4; return Math.round(0.299 * src.data[q] + 0.587 * src.data[q + 1] + 0.114 * src.data[q + 2]); };
    if (t === "box") {
      const n = 2 * r + 1; box.appendChild(kernelGrid(Array(n * n).fill(1 / (n * n)), n, n <= 7)); tag.textContent = `${n} × ${n}`;
      note.textContent = `All ${n * n} weights are equal (${(100 / (n * n)).toFixed(2)}% each). Raise r and the window, and the smear, grows.`;
    } else if (t === "gaussian") {
      const g = gaussKernel(r, bval("b-sigma")), n = g.length, w2 = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) w2.push(g[i] * g[j]);
      box.appendChild(kernelGrid(w2, n, n <= 7)); tag.textContent = `${n} × ${n} · σ ${bval("b-sigma")}`;
      const edge = g[0] * g[r] * 100, ctr = g[r] * g[r] * 100;
      note.textContent = `Center weight ${ctr.toFixed(1)}%, middle of the border ${edge.toFixed(2)}%. ${bval("b-sigma") * 3 > r + .5 ? "σ is wide for this r: the kernel is cut off while weights are still large. Raise r to see the true bell." : "Weights fade out well inside the window."}`;
    } else if (t === "median") {
      const vals = []; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) vals.push(lum(x + dx, y + dy));
      const sorted = [...vals].sort((a, b) => a - b), mid = sorted.length >> 1, center = lum(x, y), wrap = document.createElement("div"); wrap.className = "sorted-bars";
      sorted.forEach((v, i) => { const b = document.createElement("i"); b.style.height = `${Math.max(3, v / 255 * 70)}px`; if (i === mid) b.className = "mid"; b.title = String(v); wrap.appendChild(b); });
      box.appendChild(wrap); tag.textContent = `${sorted.length} values`;
      note.textContent = `Center pixel brightness = ${center}. Sorted window: min ${sorted[0]}, median ${sorted[mid]} (highlighted), max ${sorted[sorted.length - 1]}. Output = ${sorted[mid]}.${Math.abs(center - sorted[mid]) > 80 ? " The center was an outlier and is replaced." : ""}`;
    } else if (t === "bilateral") {
      const ss = bval("b-sigs"), sr = bval("b-sigr"), n = 2 * r + 1, ws = [], q0 = (y * src.w + x) * 4; let sum = 0, strong = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const q = (clamp(y + dy, 0, src.h - 1) * src.w + clamp(x + dx, 0, src.w - 1)) * 4, d2 = (src.data[q] - src.data[q0]) ** 2 + (src.data[q + 1] - src.data[q0 + 1]) ** 2 + (src.data[q + 2] - src.data[q0 + 2]) ** 2;
        const wt = Math.exp(-(dx * dx + dy * dy) / (2 * ss * ss)) * Math.exp(-d2 / (2 * sr * sr)); ws.push(wt); sum += wt;
      }
      const norm = ws.map((v) => v / sum), mx = Math.max(...norm); norm.forEach((v) => { if (v > mx * 0.05) strong++; });
      box.appendChild(kernelGrid(norm, n, n <= 7)); tag.textContent = `pixel (${x}, ${y})`;
      note.textContent = `This kernel is different for every pixel. Here ${strong} of ${n * n} neighbors have meaningful weight: those that look similar to the center. Move the mouse across an edge to see the kernel snap to one side.`;
    } else {
      const { R, entries } = motionEntries(bval("b-len"), bval("b-angle")), n = 2 * R + 1, ws = Array(n * n).fill(0);
      entries.forEach((e) => { ws[(e.dy + R) * n + e.dx + R] = e.w; });
      box.appendChild(kernelGrid(ws, n, n <= 7)); tag.textContent = `${bval("b-len")} px at ${bval("b-angle")}°`;
      note.textContent = `${entries.length} cells lie on the line, each weighted ${(100 / entries.length).toFixed(1)}%. Angle 0° is horizontal, 90° vertical.`;
    }
    const q = (y * src.w + x) * 4, o = blur.out;
    $("blur-probe").textContent = `pixel (${x}, ${y})   source (${src.data[q]}, ${src.data[q + 1]}, ${src.data[q + 2]})  →  shown (${Math.round(o[q])}, ${Math.round(o[q + 1])}, ${Math.round(o[q + 2])})`;
  }

  function bindBlur() {
    document.querySelectorAll("[data-blurtype]").forEach((b) => b.addEventListener("click", () => { blur.type = b.dataset.blurtype; scheduleBlur(); }));
    ["blur-compare", "blur-noise"].forEach((id) => $(id).addEventListener("change", scheduleBlur));
    $("blur-canvas").addEventListener("mousemove", (e) => {
      if (!blur.src) return;
      const r = e.currentTarget.getBoundingClientRect();
      blur.probe = { x: clamp(Math.floor((e.clientX - r.left) / r.width * blur.src.w), 0, blur.src.w - 1), y: clamp(Math.floor((e.clientY - r.top) / r.height * blur.src.h), 0, blur.src.h - 1) };
      renderBlurViz();
    });
    renderBlurText();
  }
  function bindOwnSliders() {
    document.querySelectorAll("input[data-own]").forEach((input) => input.addEventListener("input", () => {
      const out = $(`${input.id}-value`), v = Number(input.value), suffix = input.dataset.suffix || "";
      if (out) out.textContent = (input.id === "sharpen" ? v.toFixed(1) : (Number.isInteger(v) ? v : v.toFixed(1))) + suffix;
      if (input.id.startsWith("b-")) scheduleBlur();
      else if (input.id.startsWith("cv-")) renderKernel();
      else if (input.id.startsWith("pool-")) renderPoolPreview();
      else renderOperations();
    }));
    document.querySelectorAll("[data-gray]").forEach((b) => b.addEventListener("click", () => {
      const [r, g, bl] = b.dataset.gray.split(",");
      [["gray-r", r], ["gray-g", g], ["gray-b", bl]].forEach(([id, v]) => { $(id).value = v; $(`${id}-value`).textContent = `${v}%`; });
      $("grayscale-toggle").checked = true; renderOperations();
    }));
    bindToneProbe($("operation-canvas"));
  }

  function convSettings() {
    const k = Number($("cv-k").value);
    return { k, stride: Number($("cv-stride").value), padding: Number($("cv-padding").value), dilation: state.convMode === "convolution" && state.convType === "dilated" ? Number($("cv-dilation").value) : 1, offset: state.convMode === "convolution" && state.convType === "deformable" ? Number($("cv-offset").value) : 0 };
  }

  function makeConvKernel(k, name) {
    if (k === 3) return [...kernels[name].values];
    const values = Array(k * k).fill(0), c = Math.floor(k / 2);
    if (name === "blur") return values.map(() => 1 / (k * k));
    if (name === "edge") { values.fill(-1); values[c * k + c] = k * k - 1; return values; }
    if (name === "sharpen") { values[c * k + c] = 5; values[c * k + c - 1] = -1; values[c * k + c + 1] = -1; values[(c - 1) * k + c] = -1; values[(c + 1) * k + c] = -1; return values; }
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) values[y * k + x] = y + x < k - 1 ? -1 : y + x > k - 1 ? 1 : 0;
    values[c * k + c] = 1;
    return values;
  }

  function makeConvSource() {
    const scale = Math.min(1, 128 / Math.max(state.width, state.height));
    const width = Math.max(1, Math.round(state.width * scale)), height = Math.max(1, Math.round(state.height * scale));
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = Math.min(state.width - 1, Math.floor((x + .5) * state.width / width));
      const sy = Math.min(state.height - 1, Math.floor((y + .5) * state.height / height));
      const si = (sy * state.width + sx) * 4, di = (y * width + x) * 4;
      data[di] = state.channel.red ? state.matrix[si] : 0;
      data[di + 1] = state.channel.green ? state.matrix[si + 1] : 0;
      data[di + 2] = state.channel.blue ? state.matrix[si + 2] : 0;
      data[di + 3] = 255;
    }
    return { data, width, height };
  }

  function sampleConvPixel(source, x, y, channel) {
    if (x < 0 || y < 0 || x > source.width - 1 || y > source.height - 1) return 0;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(source.width - 1, x0 + 1), y1 = Math.min(source.height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const at = (px, py) => source.data[(py * source.width + px) * 4 + channel];
    return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
  }

  function calculateConvResult() {
    if (!state.matrix) return null;
    const cfg = convSettings(), source = makeConvSource(), { k, stride, padding, dilation } = cfg;
    const effective = (k - 1) * dilation + 1;
    let width = state.convType === "transposed" && state.convMode === "convolution"
      ? (source.width - 1) * stride - 2 * padding + effective
      : Math.floor((source.width + 2 * padding - (state.convMode === "convolution" ? effective : k)) / stride) + 1;
    let height = state.convType === "transposed" && state.convMode === "convolution"
      ? (source.height - 1) * stride - 2 * padding + effective
      : Math.floor((source.height + 2 * padding - (state.convMode === "convolution" ? effective : k)) / stride) + 1;
    width = Math.max(1, Math.min(768, width)); height = Math.max(1, Math.min(768, height));
    const result = new Uint8ClampedArray(width * height * 4), weights = makeConvKernel(k, state.kernel), bias = state.kernel === "emboss" && state.convMode === "convolution" ? 128 : 0;

    if (state.convMode === "max-pool" || state.convMode === "avg-pool") {
      for (let oy = 0; oy < height; oy++) for (let ox = 0; ox < width; ox++) {
        const out = (oy * width + ox) * 4;
        for (let c = 0; c < 3; c++) {
          let value = state.convMode === "max-pool" ? -Infinity : 0, count = 0;
          for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
            const sx = ox * stride - padding + kx, sy = oy * stride - padding + ky;
            if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
            const px = source.data[(sy * source.width + sx) * 4 + c];
            value = state.convMode === "max-pool" ? Math.max(value, px) : value + px;
            count++;
          }
          result[out + c] = clamp(state.convMode === "max-pool" ? (count ? value : 0) : (count ? value / count : 0));
        }
        result[out + 3] = 255;
      }
    } else if (state.convType === "transposed") {
      const sums = new Float32Array(width * height * 3);
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
          const ox = x * stride - padding + kx * dilation, oy = y * stride - padding + ky * dilation;
          if (ox < 0 || oy < 0 || ox >= width || oy >= height) continue;
          const weight = weights[ky * k + kx], di = (oy * width + ox) * 3, si = (y * source.width + x) * 4;
          for (let c = 0; c < 3; c++) sums[di + c] += source.data[si + c] * weight;
        }
      }
      for (let i = 0; i < width * height; i++) { result[i * 4] = clamp(sums[i * 3] + bias); result[i * 4 + 1] = clamp(sums[i * 3 + 1] + bias); result[i * 4 + 2] = clamp(sums[i * 3 + 2] + bias); result[i * 4 + 3] = 255; }
    } else {
      for (let oy = 0; oy < height; oy++) for (let ox = 0; ox < width; ox++) {
        const out = (oy * width + ox) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
            let sx = ox * stride - padding + kx * dilation;
            let sy = oy * stride - padding + ky * dilation;
            if (state.convType === "deformable") {
              const n = ky * k + kx;
              sx += cfg.offset * Math.sin(ox * .17 + oy * .11 + n * 1.37);
              sy += cfg.offset * Math.cos(ox * .13 - oy * .19 + n * 1.13);
            }
            sum += sampleConvPixel(source, sx, sy, c) * weights[ky * k + kx];
          }
          result[out + c] = clamp(sum + bias);
        }
        result[out + 3] = 255;
      }
    }
    return { data: result, width, height, inputData: source.data, inputWidth: source.width, inputHeight: source.height, settings: cfg };
  }

  function renderKernelPoints() {
    const host = $("kernel-sample-points");
    const cfg = convSettings(), k = cfg.k, effective = (k - 1) * cfg.dilation + 1;
    host.style.gridTemplateColumns = `repeat(${effective}, 1fr)`;
    host.style.gridTemplateRows = `repeat(${effective}, 1fr)`;
    host.replaceChildren();
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
      const dot = document.createElement("span"); dot.className = "kernel-sample-point"; dot.dataset.x = String(x); dot.dataset.y = String(y);
      dot.style.gridColumn = String(x * cfg.dilation + 1); dot.style.gridRow = String(y * cfg.dilation + 1);
      host.append(dot);
    }
  }

  function calculatePoolResult() {
    if (!state.matrix) return null;
    const inputSize = 12, k = Number($("pool-k").value), stride = Number($("pool-stride").value), pad = Number($("pool-padding").value);
    const source = new Uint8ClampedArray(inputSize * inputSize * 4);
    for (let y = 0; y < inputSize; y++) for (let x = 0; x < inputSize; x++) {
      let sums = [0, 0, 0], count = 0;
      const x0 = Math.floor(x * state.width / inputSize), x1 = Math.max(x0 + 1, Math.floor((x + 1) * state.width / inputSize));
      const y0 = Math.floor(y * state.height / inputSize), y1 = Math.max(y0 + 1, Math.floor((y + 1) * state.height / inputSize));
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) { const at = (py * state.width + px) * 4; for (let c = 0; c < 3; c++) sums[c] += state.channel[(["red", "green", "blue"])[c]] ? state.matrix[at + c] : 0; count++; }
      const at = (y * inputSize + x) * 4; for (let c = 0; c < 3; c++) source[at + c] = sums[c] / count; source[at + 3] = 255;
    }
    const width = Math.max(1, Math.floor((inputSize + pad * 2 - k) / stride) + 1), height = width;
    const data = new Uint8ClampedArray(width * height * 4), values = [];
    for (let oy = 0; oy < height; oy++) for (let ox = 0; ox < width; ox++) {
      const out = (oy * width + ox) * 4;
      for (let c = 0; c < 3; c++) {
        let aggregate = state.poolKind === "max" ? 0 : 0, count = 0;
        for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) { const ix = ox * stride + kx - pad, iy = oy * stride + ky - pad; if (ix < 0 || iy < 0 || ix >= inputSize || iy >= inputSize) continue; const value = source[(iy * inputSize + ix) * 4 + c]; aggregate = state.poolKind === "max" ? Math.max(aggregate, value) : aggregate + value; count++; }
        data[out + c] = state.poolKind === "max" ? aggregate : aggregate / Math.max(1, count);
      }
      data[out + 3] = 255; values.push({ x: ox, y: oy });
    }
    return { data, width, height, source, inputSize, k, stride, pad, values };
  }

  function renderPoolPreview() {
    const result = calculatePoolResult(); if (!result) return;
    state.poolResult = result; state.poolRun++; state.poolScanning = false;
    $("play-pooling").disabled = false;
    $("play-pooling").textContent = "▶  Build pooled output";
    const { data, width, height, inputSize, k, stride, pad } = result;
    const grid = $("pool-matrix-grid"); grid.style.gridTemplateColumns = `repeat(${inputSize + pad * 2}, minmax(0,1fr))`; grid.replaceChildren();
    for (let y = -pad; y < inputSize + pad; y++) for (let x = -pad; x < inputSize + pad; x++) {
      const cell = document.createElement("span");
      if (x < 0 || y < 0 || x >= inputSize || y >= inputSize) cell.className = "padding-pixel";
      else { const i = (y * inputSize + x) * 4, gray = Math.round(result.source[i] * .299 + result.source[i + 1] * .587 + result.source[i + 2] * .114); cell.className = "matrix-pixel"; cell.style.background = `color-mix(in oklab,var(--primary) ${gray / 255 * 100}%,var(--secondary))`; }
      cell.dataset.gx = String(x + pad); cell.dataset.gy = String(y + pad); grid.append(cell);
    }
    const overlay = $("pool-window-overlay"); overlay.style.width = `calc(${100 * k / (inputSize + pad * 2)}% - 3px)`; overlay.style.height = `auto`; overlay.style.aspectRatio = "1"; overlay.style.left = "7px"; overlay.style.top = "7px"; overlay.style.display = "block";
    $("pool-formula").textContent = state.poolKind === "max" ? `Y[x,y] = max(X[x·${stride}−p+i, y·${stride}−p+j]) over ${k}×${k}` : `Y[x,y] = Σ valid X / valid count over ${k}×${k}`;
    $("pool-dimensions").textContent = `Input ${inputSize} × ${inputSize} → padded ${inputSize + 2 * pad} × ${inputSize + 2 * pad} → output ${width} × ${height}`;
    $("pool-status").textContent = `Ready · ${state.poolKind === "max" ? "max" : "average"} pooling · stride ${stride}`;
    $("pool-progress").textContent = `${width * height} / ${width * height} windows`;
    const canvas = $("pool-output-canvas"); canvas.width = width; canvas.height = height; canvas.getContext("2d").clearRect(0, 0, width, height);
    $("pool-output-focus").style.display = "none";
    $("pool-equation").textContent = state.poolKind === "max" ? "Each output pixel keeps strongest value inside its window." : "Each output pixel averages valid input values inside its window.";
  }

  function afterWindowMove(element, delay, callback) {
    let finished = false;
    const cleanup = () => {
      element.removeEventListener("transitionend", onEnd);
      clearTimeout(fallback);
    };
    const finish = () => { if (finished) return; finished = true; cleanup(); callback(); };
    const onEnd = event => {
      if (event.target === element && (event.propertyName === "left" || event.propertyName === "top")) finish();
    };
    element.addEventListener("transitionend", onEnd);
    const fallback = setTimeout(finish, delay + 40);
  }

  function runPoolScan() {
    if (!state.poolResult || state.poolScanning) return;
    renderPoolPreview(); const result = state.poolResult, run = ++state.poolRun, button = $("play-pooling"), canvas = $("pool-output-canvas"), ctx = canvas.getContext("2d");
    state.poolScanning = true; button.disabled = true; $("pool-status").textContent = "Building output from highlighted windows…"; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    const overlay = $("pool-window-overlay"), focus = $("pool-output-focus"), grid = $("pool-matrix-grid"), gridCells = [...grid.children], delay = Math.max(20, Number($("pool-delay").value)), pad = result.pad;
    overlay.style.transitionDuration = `${delay}ms`; focus.style.transitionDuration = `${delay}ms`;
    let index = 0;
    function step() {
      if (run !== state.poolRun) return;
      const x = index % result.width, y = Math.floor(index / result.width), stride = result.stride;
      const rect = grid.getBoundingClientRect(), cellsWide = result.inputSize + 2 * pad;
      const stepSize = (rect.width - 14 - 2 * (cellsWide - 1)) / cellsWide + 2;
      overlay.style.left = `${7 + x * stride * stepSize}px`; overlay.style.top = `${7 + y * stride * stepSize}px`;
      focus.style.display = "block";
      focus.style.left = `${x / result.width * 100}%`; focus.style.top = `${y / result.height * 100}%`;
      focus.style.width = `${100 / result.width}%`; focus.style.height = `${100 / result.height}%`;
      for (const cell of gridCells) cell.classList.toggle("active-pixel", Number(cell.dataset.gx) >= x * stride && Number(cell.dataset.gx) < x * stride + result.k && Number(cell.dataset.gy) >= y * stride && Number(cell.dataset.gy) < y * stride + result.k);
      const buildPixel = () => {
        if (run !== state.poolRun) return;
        const image = new ImageData(result.data, result.width, result.height); ctx.putImageData(image, 0, 0, x, y, 1, 1);
        $("pool-equation").textContent = `Input window (${x * stride}, ${y * stride}) → output pixel (${x}, ${y}) = ${state.poolKind === "max" ? "maximum" : "mean"}`;
        index++; $("pool-progress").textContent = `${index} / ${result.width * result.height} windows`;
        if (index < result.width * result.height) step(); else { state.poolScanning = false; button.disabled = false; focus.style.display = "none"; $("pool-status").textContent = `Complete · ${result.width} × ${result.height}`; }
      };
      if (index === 0) buildPixel(); else afterWindowMove(overlay, delay, buildPixel);
    }
    step();
  }

  function renderConvolutionPreview() {
    state.convResult = calculateConvResult();
    if (!state.convResult) return;
    const { width, height, inputWidth, inputHeight, settings } = state.convResult;
    const canvas = $("convolution-canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").clearRect(0, 0, width, height);
    $("conv-dimensions").textContent = state.convType === "transposed" && state.convMode === "convolution"
      ? `Input ${inputWidth} × ${inputHeight}  →  scattered output ${width} × ${height}  (padding crops edges)`
      : `Input ${inputWidth} × ${inputHeight}  →  padded ${inputWidth + settings.padding * 2} × ${inputHeight + settings.padding * 2}  →  output ${width} × ${height}`;
    $("conv-progress").textContent = `${width * height} / ${width * height}`;
    $("scan-status").textContent = `Ready · press Build output live · ${width} × ${height}`;
    renderOutputMap(true);
  }

  function renderOutputMap(complete) {
    if (!state.convResult) return;
    const { width, height } = state.convResult, cfg = convSettings();
    const effective = (cfg.k - 1) * cfg.dilation + 1;
    const visualWidth = state.convType === "transposed" && state.convMode === "convolution" ? 23 * cfg.stride - 2 * cfg.padding + effective : Math.floor((24 + 2 * cfg.padding - (state.convMode === "convolution" ? effective : cfg.k)) / cfg.stride) + 1;
    const visualHeight = state.convType === "transposed" && state.convMode === "convolution" ? 23 * cfg.stride - 2 * cfg.padding + effective : Math.floor((24 + 2 * cfg.padding - (state.convMode === "convolution" ? effective : cfg.k)) / cfg.stride) + 1;
    const cols = Math.max(1, Math.min(24, visualWidth)), rows = Math.max(1, Math.min(24, visualHeight));
    state.convMap = { cols, rows };
    $("conv-output-focus").style.display = "none";
  }

  function renderKernel() {
    state.convRun++;
    state.scanning = false;
    const scanButton = $("play-convolution");
    scanButton.disabled = false;
    scanButton.textContent = "▶  Build output live";
    const cfg = convSettings(), k = cfg.k, weights = state.convMode === "convolution" ? makeConvKernel(k, state.kernel) : Array(k * k).fill(state.convMode === "max-pool" ? "max" : "avg");
    const display = $("kernel-display");
    display.style.gridTemplateColumns = `repeat(${k}, minmax(0, 1fr))`;
    display.style.width = `min(100%, ${Math.max(132, k * 39)}px)`;
    display.replaceChildren(...weights.map((v) => { const cell = document.createElement("div"); cell.className = "kernel-cell"; cell.textContent = typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v; return cell; }));
    $("kernel-size-tag").textContent = `${k} × ${k}`;
    $("dilation-control").classList.toggle("hidden", state.convType !== "dilated");
    $("deform-control").classList.toggle("hidden", state.convType !== "deformable");
    $("conv-input-title").textContent = state.convType === "transposed" ? "INPUT · KERNEL SCATTER" : cfg.padding ? `INPUT + ${cfg.padding}px ZERO PADDING` : "INPUT · NO PADDING";
    const filter = kernels[state.kernel];
    const formulas = {
      normal: `Y[x,y] = Σ W[i,j] × X[x·${cfg.stride} − ${cfg.padding} + i, y·${cfg.stride} − ${cfg.padding} + j]`,
      dilated: `Y[x,y] = Σ W[i,j] × X[x·${cfg.stride} − ${cfg.padding} + i·${cfg.dilation}, y·${cfg.stride} − ${cfg.padding} + j·${cfg.dilation}]`,
      transposed: `Y[x·${cfg.stride} + i − ${cfg.padding}, y·${cfg.stride} + j − ${cfg.padding}] += X[x,y] × W[i,j]`,
      deformable: `Y[x,y] = Σ W[i,j] × X[x·s − p + i + Δpᵢⱼ]`,
    };
    {
      $("kernel-formula").textContent = formulas[state.convType];
      $("kernel-description").textContent = filter.description;
      $("conv-explainer").textContent = state.convType === "dilated" ? "Dilation spaces kernel samples apart, expanding receptive field without adding weights." : state.convType === "transposed" ? "Transposed convolution scatters each input value through the kernel, increasing spatial resolution." : state.convType === "deformable" ? "Deformable convolution shifts sample locations by learned offsets; demo uses a controllable offset field." : "CNNs learn kernel weights during training; these presets make the multiply-and-sum step visible.";
      $("conv-output-label").textContent = `${filter.name.toUpperCase()} · ${state.convType.toUpperCase()}`;
    }
    $("conv-size-formula").textContent = state.convType === "transposed"
        ? `output size = (N − 1) × s − 2p + d × (k − 1) + 1`
        : `output size = floor((N + 2p − d × (k − 1) − 1) / s) + 1`;
    renderKernelPoints();
    renderMatrixGrid();
    renderConvolutionPreview();
  }

  function renderMatrixGrid() {
    if (!state.matrix) { $("scan-kernel-overlay").style.display = "none"; return; }
    const host = $("matrix-grid"), cols = 24, rows = 24;
    const cfg = convSettings(), padding = state.convType === "transposed" && state.convMode === "convolution" ? 0 : cfg.padding;
    const totalCols = cols + padding * 2, totalRows = rows + padding * 2, samples = [];
    host.style.gridTemplateColumns = `repeat(${totalCols}, minmax(0, 1fr))`;
    host.replaceChildren();
    for (let y = -padding; y < rows + padding; y++) for (let x = -padding; x < cols + padding; x++) {
      const cell = document.createElement("div");
      cell.dataset.gx = String(x + padding); cell.dataset.gy = String(y + padding);
      if (x < 0 || y < 0 || x >= cols || y >= rows) cell.className = "padding-pixel";
      else {
        const sx = Math.min(state.width - 1, Math.floor((x + .5) * state.width / cols));
        const sy = Math.min(state.height - 1, Math.floor((y + .5) * state.height / rows));
        const i = (sy * state.width + sx) * 4;
        const r = state.channel.red ? state.matrix[i] : 0, g = state.channel.green ? state.matrix[i + 1] : 0, b = state.channel.blue ? state.matrix[i + 2] : 0;
        const value = Math.round(r * .299 + g * .587 + b * .114);
        samples.push(value);
        cell.className = "matrix-pixel";
        cell.style.background = `color-mix(in oklab, var(--primary) ${Math.round(value / 255 * 100)}%, var(--secondary))`;
        cell.dataset.x = String(x); cell.dataset.y = String(y);
      }
      host.append(cell);
    }
    state.scanSamples = samples;
    state.scanGrid = { cols, rows, padding, totalCols, totalRows };
    const overlay = $("scan-kernel-overlay"), gridRect = host.getBoundingClientRect();
    const step = (gridRect.width - 14 - 2 * (totalCols - 1)) / totalCols + 2;
    const effective = (cfg.k - 1) * cfg.dilation + 1;
    overlay.style.width = `${step * effective - 2}px`;
    overlay.style.height = `${step * effective - 2}px`;
    overlay.style.left = "7px"; overlay.style.top = "7px";
    overlay.style.display = "block";
  }

  function runScan() {
    if (!state.matrix || state.scanning) return;
    if (!state.convResult) renderConvolutionPreview();
    const result = state.convResult;
    if (!result) return;
    state.scanning = true;
    const run = ++state.convRun, button = $("play-convolution"), canvas = $("convolution-canvas");
    const ctx = canvas.getContext("2d"), built = new ImageData(result.width, result.height);
    button.disabled = true; button.textContent = "Building output…";
    canvas.width = result.width; canvas.height = result.height;
    ctx.clearRect(0, 0, result.width, result.height);
    renderOutputMap(false);
    const cells = [...$("matrix-grid").children], focus = $("conv-output-focus");
    const { cols, rows } = state.convMap, delay = Math.max(20, Number($("cv-delay").value));
    const overlay = $("scan-kernel-overlay");
    overlay.style.transitionDuration = `${delay}ms`; focus.style.transitionDuration = `${delay}ms`;
    $("kernel-sample-points").querySelectorAll(".kernel-sample-point").forEach(dot => { dot.style.transitionDuration = `${delay}ms`; });
    let position = 0;

    function moveKernel(mapX, mapY) {
      const cfg = convSettings(), grid = state.scanGrid, overlay = $("scan-kernel-overlay"), host = $("matrix-grid");
      const rect = host.getBoundingClientRect(), step = (rect.width - 14 - 2 * (grid.totalCols - 1)) / grid.totalCols + 2;
      const outX = Math.floor((mapX + .5) * result.width / cols), outY = Math.floor((mapY + .5) * result.height / rows);
      let gx, gy;
      if (state.convType === "transposed" && state.convMode === "convolution") {
        gx = Math.floor((outX + cfg.padding) / cfg.stride * 24 / result.inputWidth);
        gy = Math.floor((outY + cfg.padding) / cfg.stride * 24 / result.inputHeight);
      } else {
        gx = mapX * cfg.stride;
        gy = mapY * cfg.stride;
      }
      gx = Math.max(0, Math.min(grid.totalCols - 1, gx)); gy = Math.max(0, Math.min(grid.totalRows - 1, gy));
      overlay.style.left = `${7 + gx * step}px`; overlay.style.top = `${7 + gy * step}px`;
      const targets = [];
      for (let ky = 0; ky < cfg.k; ky++) for (let kx = 0; kx < cfg.k; kx++) {
        const n = ky * cfg.k + kx;
        const dx = state.convType === "deformable" ? cfg.offset * Math.sin(outX * .17 + outY * .11 + n * 1.37) * 24 / result.inputWidth : 0;
        const dy = state.convType === "deformable" ? cfg.offset * Math.cos(outX * .13 - outY * .19 + n * 1.13) * 24 / result.inputHeight : 0;
        targets.push({ x: Math.round(gx + kx * cfg.dilation + dx), y: Math.round(gy + ky * cfg.dilation + dy), dx, dy });
      }
      cells.forEach(cell => {
        const x = Number(cell.dataset.gx), y = Number(cell.dataset.gy);
        cell.classList.toggle("active-pixel", targets.some(point => point.x === x && point.y === y));
      });
      $("kernel-sample-points").querySelectorAll(".kernel-sample-point").forEach((dot, i) => {
        const point = targets[i];
        dot.style.transform = `translate(${point.dx * step}px, ${point.dy * step}px)`;
      });
    }

    function buildNextPosition() {
      if (run !== state.convRun) return;
      const mapX = position % cols, mapY = Math.floor(position / cols);
      moveKernel(mapX, mapY);
      focus.style.display = "block";
      focus.style.left = `${mapX / cols * 100}%`; focus.style.top = `${mapY / rows * 100}%`;
      focus.style.width = `${100 / cols}%`; focus.style.height = `${100 / rows}%`;
      $("scan-status").textContent = `Window ${position + 1}/${cols * rows} · row ${mapY + 1}/${rows}, column ${mapX + 1}/${cols}`;
      if (position === 0) buildOutputPosition(mapX, mapY);
      else afterWindowMove(overlay, delay, () => buildOutputPosition(mapX, mapY));
    }

    function buildOutputPosition(mapX, mapY) {
      if (run !== state.convRun) return;
      const x0 = Math.floor(mapX * result.width / cols), x1 = Math.max(x0 + 1, Math.floor((mapX + 1) * result.width / cols));
      const y0 = Math.floor(mapY * result.height / rows), y1 = Math.max(y0 + 1, Math.floor((mapY + 1) * result.height / rows));
      for (let y = y0; y < Math.min(y1, result.height); y++) built.data.set(result.data.subarray(y * result.width * 4 + x0 * 4, y * result.width * 4 + Math.min(x1, result.width) * 4), y * result.width * 4 + x0 * 4);
      ctx.putImageData(built, 0, 0, x0, y0, Math.min(result.width - x0, x1 - x0), Math.min(result.height - y0, y1 - y0));
      const sx = Math.min(result.width - 1, Math.floor((mapX + .5) * result.width / cols));
      const sy = Math.min(result.height - 1, Math.floor((mapY + .5) * result.height / rows));
      const at = (sy * result.width + sx) * 4, brightness = Math.round(result.data[at] * .299 + result.data[at + 1] * .587 + result.data[at + 2] * .114);
      $("scan-equation").textContent = `Input window (${mapX * convSettings().stride}, ${mapY * convSettings().stride}) → output region (${x0}, ${y0})–(${x1 - 1}, ${y1 - 1}) · pixel (${sx}, ${sy}) = (${result.data[at]}, ${result.data[at + 1]}, ${result.data[at + 2]})`;
      $("scan-status").textContent = `Constructed window ${position + 1}/${cols * rows} · row ${mapY + 1}/${rows}, column ${mapX + 1}/${cols}`;
      $("conv-progress").textContent = `${position + 1} / ${cols * rows} windows`;
      position++;
      if (position < cols * rows) buildNextPosition();
      else {
        state.scanning = false; button.disabled = false; button.textContent = "↻  Rebuild output live";
        focus.style.display = "none";
        $("scan-status").textContent = `Complete · ${result.width} × ${result.height}`;
      }
    }
    buildNextPosition();
  }

  function bind() {
    if (state.bound || !$("image-upload")) return;
    state.bound = true;
    $("image-upload").addEventListener("change", (e) => decodeFile(e.target.files?.[0]));
    const drop = $("upload-preview");
    ["dragenter", "dragover"].forEach(name => drop.addEventListener(name, e => { e.preventDefault(); drop.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach(name => drop.addEventListener(name, e => { e.preventDefault(); drop.classList.remove("dragging"); }));
    drop.addEventListener("drop", e => decodeFile(e.dataTransfer.files?.[0]));
    document.querySelectorAll(".channel-card").forEach(card => card.addEventListener("click", () => {
      const channel = card.dataset.channel; state.channel[channel] = !state.channel[channel]; renderChannels(); renderKernel(); renderPoolPreview();
    }));
    document.querySelectorAll("input[type=range]").forEach(input => input.addEventListener("input", () => {
      if (input.dataset.own) return;
      const out = $(`${input.id}-value`);
      if (out) out.textContent = `${input.value}${input.id.startsWith("gray-") || input.id.includes("saturation") || input.id === "hsv-value" || input.id === "contrast" ? "%" : input.id.includes("hue") ? "°" : input.id === "sharpen" ? "×" : input.id === "blur-radius" ? " px" : "%"}`;
      if (input.id.startsWith("hsv-")) renderHsvPreview(); else renderOperations();
    }));
    $("grayscale-toggle").addEventListener("change", renderOperations);
    bindOwnSliders();
    bindBlur();
    document.querySelectorAll("[data-conv-mode]").forEach(button => button.addEventListener("click", () => {
      state.convMode = button.dataset.convMode;
      document.querySelectorAll("[data-conv-mode]").forEach(item => item.classList.toggle("selected", item === button));
      renderKernel();
    }));
    document.querySelectorAll("[data-conv-type]").forEach(button => button.addEventListener("click", () => {
      state.convType = button.dataset.convType;
      document.querySelectorAll("[data-conv-type]").forEach(item => item.classList.toggle("selected", item === button));
      renderKernel();
    }));
    document.querySelectorAll("[data-kernel]").forEach(button => button.addEventListener("click", () => {
      state.kernel = button.dataset.kernel;
      document.querySelectorAll("[data-kernel]").forEach(b => b.classList.toggle("active", b === button));
      renderKernel();
    }));
    document.querySelectorAll("[data-pool-kind]").forEach(button => button.addEventListener("click", () => {
      state.poolKind = button.dataset.poolKind;
      document.querySelectorAll("[data-pool-kind]").forEach(item => item.classList.toggle("selected", item === button));
      renderPoolPreview();
    }));
    $("play-pooling").addEventListener("click", runPoolScan);
    $("play-convolution").addEventListener("click", runScan);
    $("reset-operations").addEventListener("click", () => {
      [["gray-r", "28", "%"], ["gray-g", "52", "%"], ["gray-b", "16", "%"], ["contrast", "100", "%"], ["sharpen", "0", ""]].forEach(([id, value, suffix]) => { $(id).value = value; const out = $(`${id}-value`); if (out) out.textContent = id === "sharpen" ? "0.0" : `${value}${suffix}`; });
      $("grayscale-toggle").checked = false;
      renderOperations();
    });
    $("reset-hsv").addEventListener("click", () => {
      [["hsv-hue", "0", "°"], ["hsv-saturation", "100", "%"], ["hsv-value", "100", "%"]].forEach(([id, value, suffix]) => { $(id).value = value; $(`${id}-value`).textContent = `${value}${suffix}`; });
      renderHsvPreview();
    });
    $("source-image").addEventListener("mousemove", e => {
      if (!state.matrix) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(state.width - 1, Math.floor((e.clientX - rect.left) / rect.width * state.width)));
      const y = Math.max(0, Math.min(state.height - 1, Math.floor((e.clientY - rect.top) / rect.height * state.height)));
      updatePixelSample(x, y);
    });
    $("rgb-composite-canvas").addEventListener("mousemove", e => {
      if (!state.matrix) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(state.width - 1, Math.floor((e.clientX - rect.left) / rect.width * state.width)));
      const y = Math.max(0, Math.min(state.height - 1, Math.floor((e.clientY - rect.top) / rect.height * state.height)));
      updatePixelSample(x, y);
    });
    renderHsvPreview();
    renderKernel();
    restoreImage();
  }
  function initializeWhenReady() {
    if (!$("image-upload")) { requestAnimationFrame(initializeWhenReady); return; }
    bind();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeWhenReady, { once: true }); else initializeWhenReady();
})();
