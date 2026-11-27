(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAXDIM = 256;

  // ---------- constants ----------
  const QY = [16,11,10,16,24,40,51,61, 12,12,14,19,26,58,60,55, 14,13,16,24,40,57,69,56, 14,17,22,29,51,87,80,62,
              18,22,37,56,68,109,103,77, 24,35,55,64,81,104,113,92, 49,64,78,87,103,121,120,101, 72,92,95,98,112,100,103,99];
  const QC = [17,18,24,47,99,99,99,99, 18,21,26,66,99,99,99,99, 24,26,56,99,99,99,99,99, 47,66,99,99,99,99,99,99,
              99,99,99,99,99,99,99,99, 99,99,99,99,99,99,99,99, 99,99,99,99,99,99,99,99, 99,99,99,99,99,99,99,99];
  const ZZ = (() => { // zig-zag order: ZZ[k] = row-major index of k-th coefficient
    const out = []; let x = 0, y = 0, up = true;
    for (let k = 0; k < 64; k++) {
      out.push(y * 8 + x);
      if (up) { if (x === 7) { y++; up = false; } else if (y === 0) { x++; up = false; } else { x++; y--; } }
      else { if (y === 7) { x++; up = true; } else if (x === 0) { y++; up = true; } else { x--; y++; } }
    }
    return out;
  })();
  const COS = (() => { // C[u][x] = c(u)/2 * cos((2x+1)uπ/16)
    const m = new Float64Array(64);
    for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) m[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) / 2 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    return m;
  })();
  const SUBS = { "444": [1, 1], "422": [2, 1], "420": [2, 2] };

  // ---------- state ----------
  const S = {
    bound: false, token: 0, img: null, quality: 50, chroma: 1, sub: "420", chan: "Y", view: "orig",
    blk: { x: 0, y: 0 }, uv: [1, 0], pix: [0, 0], enc: null, anim: { zz: 0, rle: 0, huff: 0, dpcm: 0, q: 0, blk: 0, dct: 0, px: 0 }, raf: 0,
  };

  // ---------- color ----------
  const rgb2ycc = (r, g, b) => [
    0.299 * r + 0.587 * g + 0.114 * b,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ];
  const ycc2rgb = (y, cb, cr) => [
    clamp(Math.round(y + 1.402 * (cr - 128))),
    clamp(Math.round(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128))),
    clamp(Math.round(y + 1.772 * (cb - 128))),
  ];

  // ---------- transforms ----------
  function fdct(f) { // f: 64 level-shifted values -> 64 coefficients
    const t = new Float64Array(64), F = new Float64Array(64);
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += f[y * 8 + x] * COS[u * 8 + x]; t[y * 8 + u] = s; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < 8; y++) s += t[y * 8 + u] * COS[v * 8 + y]; F[v * 8 + u] = s; }
    return F;
  }
  function idct(F) {
    const t = new Float64Array(64), f = new Float64Array(64);
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += F[v * 8 + u] * COS[u * 8 + x]; t[v * 8 + x] = s; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let v = 0; v < 8; v++) s += t[v * 8 + x] * COS[v * 8 + y]; f[y * 8 + x] = s; }
    return f;
  }
  function qTable(base, isChroma) {
    const q = S.quality, s = q < 50 ? 5000 / q : 200 - 2 * q;
    return base.map((t) => {
      let v = Math.floor((t * s + 50) / 100);
      if (isChroma) v *= S.chroma;
      return clamp(Math.round(v), 1, 255);
    });
  }
  const tableFor = (chan) => qTable(chan === "Y" ? QY : QC, chan !== "Y");

  // ---------- planes (independent of quality) ----------
  function buildPlanes() {
    const { w, h, data } = S.img;
    const pw = Math.ceil(w / 16) * 16, ph = Math.ceil(h / 16) * 16;
    const Y = new Float32Array(pw * ph), Cb = new Float32Array(pw * ph), Cr = new Float32Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = (Math.min(y, h - 1) * w + Math.min(x, w - 1)) * 4;
      const [a, b, c] = rgb2ycc(data[i], data[i + 1], data[i + 2]);
      Y[y * pw + x] = a; Cb[y * pw + x] = b; Cr[y * pw + x] = c;
    }
    const [fx, fy] = SUBS[S.sub];
    const cw = pw / fx, ch = ph / fy, sCb = new Float32Array(cw * ch), sCr = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let a = 0, b = 0;
      for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) { const k = (y * fy + j) * pw + x * fx + i; a += Cb[k]; b += Cr[k]; }
      sCb[y * cw + x] = a / (fx * fy); sCr[y * cw + x] = b / (fx * fy);
    }
    const planes = { Y: { d: Y, w: pw, h: ph }, Cb: { d: sCb, w: cw, h: ch }, Cr: { d: sCr, w: cw, h: ch } };
    for (const k of ["Y", "Cb", "Cr"]) {
      const p = planes[k]; p.bw = p.w / 8; p.bh = p.h / 8; p.coef = new Float32Array(p.w * p.h); // 64 coeffs per block, block-major
      for (let by = 0; by < p.bh; by++) for (let bx = 0; bx < p.bw; bx++) {
        const f = blockOf(p, bx, by, true); const F = fdct(f); p.coef.set(F, (by * p.bw + bx) * 64);
      }
    }
    return { planes, pw, ph, fx, fy };
  }
  function blockOf(p, bx, by, shift) {
    const out = new Float64Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = p.d[(by * 8 + y) * p.w + bx * 8 + x] - (shift ? 128 : 0);
    return out;
  }
  const coefAt = (p, bx, by) => p.coef.subarray((by * p.bw + bx) * 64, (by * p.bw + bx) * 64 + 64);

  // ---------- quantize + entropy statistics ----------
  const sizeOf = (v) => { v = Math.abs(v); let n = 0; while (v) { n++; v >>= 1; } return n; };
  function huffLengths(freq) { // freq: Map symbol->count -> Map symbol->length
    const nodes = [...freq].map(([s, c]) => ({ c, s }));
    if (!nodes.length) return new Map();
    if (nodes.length === 1) return new Map([[nodes[0].s, 1]]);
    while (nodes.length > 1) {
      nodes.sort((a, b) => a.c - b.c);
      const a = nodes.shift(), b = nodes.shift();
      nodes.push({ c: a.c + b.c, l: a, r: b });
    }
    const out = new Map();
    (function walk(n, d) { if (n.l) { walk(n.l, d + 1); walk(n.r, d + 1); } else out.set(n.s, d); })(nodes[0], 0);
    return out;
  }
  function canonical(lens) { // symbol->length  =>  symbol->bitstring
    const list = [...lens].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const codes = new Map(); let code = 0, prev = list.length ? list[0][1] : 0;
    for (const [s, l] of list) { code <<= (l - prev); prev = l; codes.set(s, code.toString(2).padStart(l, "0")); code++; }
    return codes;
  }
  function symbolsOfBlock(q, prevDC) { // q: row-major quantized ints; returns {dc, ac:[{run,size,amp,zrl}], eob}
    const dcDiff = q[0] - prevDC, dc = { diff: dcDiff, size: sizeOf(dcDiff) };
    const ac = []; let run = 0, last = 0;
    for (let k = 63; k >= 1; k--) if (q[ZZ[k]] !== 0) { last = k; break; }
    for (let k = 1; k <= last; k++) {
      const v = q[ZZ[k]];
      if (v === 0) { run++; continue; }
      while (run > 15) { ac.push({ run: 15, size: 0, amp: 0, zrl: true }); run -= 16; }
      ac.push({ run, size: sizeOf(v), amp: v }); run = 0;
    }
    return { dc, ac, eob: last < 63, last };
  }
  function ampBits(v, size) { if (!size) return ""; const x = v >= 0 ? v : v + (1 << size) - 1; return x.toString(2).padStart(size, "0"); }

  function encode() {
    const { planes } = S.pl;
    const tY = tableFor("Y"), tC = tableFor("Cb");
    const enc = { q: {}, tables: { Y: tY, Cb: tC, Cr: tC }, zeros: 0, total: 0, survive: { Y: new Float64Array(64), C: new Float64Array(64) }, nblocks: { Y: 0, C: 0 }, syms: {}, freq: { lumaDC: new Map(), lumaAC: new Map(), chromaDC: new Map(), chromaAC: new Map() } };
    for (const k of ["Y", "Cb", "Cr"]) {
      const p = planes[k], T = enc.tables[k], isY = k === "Y", grp = isY ? "luma" : "chroma";
      const qs = new Int16Array(p.bw * p.bh * 64); let prev = 0; const syms = [];
      for (let b = 0; b < p.bw * p.bh; b++) {
        const F = p.coef.subarray(b * 64, b * 64 + 64), q = qs.subarray(b * 64, b * 64 + 64);
        for (let i = 0; i < 64; i++) { q[i] = Math.round(F[i] / T[i]); if (q[i] === 0) enc.zeros++; else enc.survive[isY ? "Y" : "C"][i]++; }
        enc.total += 64; enc.nblocks[isY ? "Y" : "C"]++;
        const sy = symbolsOfBlock(q, prev); prev = q[0]; syms.push(sy);
        const fd = enc.freq[grp + "DC"], fa = enc.freq[grp + "AC"];
        fd.set(sy.dc.size, (fd.get(sy.dc.size) || 0) + 1);
        for (const a of sy.ac) { const s = (a.run << 4) | a.size; fa.set(s, (fa.get(s) || 0) + 1); }
        if (sy.eob) fa.set(0, (fa.get(0) || 0) + 1);
      }
      enc.q[k] = qs; enc.syms[k] = syms;
    }
    enc.len = {}; enc.code = {};
    let bits = 0, hdr = 2 + 18 + 2 * 67 + 19 + 14 + 2;
    for (const g of Object.keys(enc.freq)) {
      enc.len[g] = huffLengths(enc.freq[g]); enc.code[g] = canonical(enc.len[g]);
      for (const [s, c] of enc.freq[g]) bits += c * enc.len[g].get(s);
      hdr += 19 + enc.len[g].size;
    }
    for (const k of ["Y", "Cb", "Cr"]) for (const sy of enc.syms[k]) { bits += sy.dc.size; for (const a of sy.ac) bits += a.size; }
    enc.bits = bits; enc.hdr = hdr; enc.bytes = Math.ceil(bits / 8) + hdr;
    return enc;
  }

  // ---------- reconstruction ----------
  function reconstruct(opts = {}) {
    const { planes, pw, ph, fx, fy } = S.pl, { w, h } = S.img;
    const out = {}, keepMask = opts.keep ? (() => { const m = new Uint8Array(64); for (let k = 0; k < opts.keep; k++) m[ZZ[k]] = 1; return m; })() : null;
    for (const k of ["Y", "Cb", "Cr"]) {
      const p = planes[k], T = S.enc.tables[k], q = S.enc.q[k], d = new Float32Array(p.w * p.h), F = new Float64Array(64);
      for (let by = 0; by < p.bh; by++) for (let bx = 0; bx < p.bw; bx++) {
        const b = by * p.bw + bx;
        for (let i = 0; i < 64; i++) {
          let v = opts.noQuant ? p.coef[b * 64 + i] : q[b * 64 + i] * T[i];
          if (keepMask && !keepMask[i]) v = 0;
          F[i] = v;
        }
        const f = idct(F);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) d[(by * 8 + y) * p.w + bx * 8 + x] = f[y * 8 + x] + 128;
      }
      out[k] = { d, w: p.w };
    }
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const yv = out.Y.d[y * pw + x], cx = Math.min(out.Cb.w - 1, Math.floor(x / fx)), cy = Math.floor(y / fy);
      const [r, g, b] = ycc2rgb(yv, out.Cb.d[cy * out.Cb.w + cx], out.Cr.d[cy * out.Cr.w + cx]);
      const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    return data;
  }

  // ---------- canvas helpers ----------
  function putRGBA(canvas, data, w, h) {
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  }
  function drawPlane(canvas, which) {
    const { w, h, data } = S.img, out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const [y, cb, cr] = rgb2ycc(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      let r, g, b;
      if (which === "Y") r = g = b = y;
      else if (which === "Cb") [r, g, b] = ycc2rgb(128, cb, 128);
      else [r, g, b] = ycc2rgb(128, 128, cr);
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
    }
    putRGBA(canvas, out, w, h);
  }
  const heat = (v, max) => { // diverging, -max..max
    const t = clamp(v / (max || 1), -1, 1), a = Math.abs(t) ** 0.6;
    return t >= 0 ? `color-mix(in oklab, var(--cb-col) ${Math.round(a * 55)}%, var(--secondary))` : `color-mix(in oklab, var(--cr-col) ${Math.round(a * 55)}%, var(--secondary))`;
  };
  const gray = (v) => { const g = Math.round(clamp(v)); return `rgb(${g},${g},${g})`; };
  function makeMx(el, n = 64) { const cells = []; for (let i = 0; i < n; i++) { const s = document.createElement("span"); cells.push(s); } el.replaceChildren(...cells); return cells; }

  // ---------- selected block data ----------
  function curPlane() { return S.pl.planes[S.chan]; }
  function clampBlock() { const p = curPlane(); S.blk.x = clamp(S.blk.x, 0, p.bw - 1); S.blk.y = clamp(S.blk.y, 0, p.bh - 1); }
  function pickDefaultBlock() { // most "interesting" block: highest AC energy in Y
    const p = S.pl.planes.Y; let best = -1, bx = 0, by = 0;
    for (let y = 0; y < p.bh; y++) for (let x = 0; x < p.bw; x++) {
      const c = coefAt(p, x, y); let e = 0; for (let i = 1; i < 64; i++) e += Math.abs(c[i]);
      if (e > best && e < 4000) { best = e; bx = x; by = y; }
    }
    S.blk = { x: bx, y: by };
  }
  function blockData() {
    const p = curPlane(), { x, y } = S.blk, b = y * p.bw + x;
    return { p, shifted: blockOf(p, x, y, true), raw: blockOf(p, x, y, false), F: Array.from(coefAt(p, x, y)), q: Array.from(S.enc.q[S.chan].subarray(b * 64, b * 64 + 64)), T: S.enc.tables[S.chan], b };
  }
  const prevDC = () => { const p = curPlane(), b = S.blk.y * p.bw + S.blk.x; return b === 0 ? 0 : S.enc.q[S.chan][(b - 1) * 64]; };

  // ---------- rendering: global ----------
  const fmtBytes = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B");
  function renderSummary() {
    const { w, h, data } = S.img, raw = w * h * 3, e = S.enc;
    $("stat-raw").textContent = fmtBytes(raw);
    $("stat-jpeg").textContent = fmtBytes(e.bytes);
    $("stat-ratio").textContent = (raw / e.bytes).toFixed(1) + " : 1";
    $("stat-bpp").textContent = ((e.bytes * 8) / (w * h)).toFixed(2);
    const dec = S.recon; let mse = 0;
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) { const d = data[i * 4 + c] - dec[i * 4 + c]; mse += d * d; }
    mse /= w * h * 3;
    $("stat-psnr").textContent = mse === 0 ? "∞" : (10 * Math.log10(255 * 255 / mse)).toFixed(1) + " dB";
  }
  function renderCompare() {
    const { w, h, data } = S.img;
    putRGBA($("cmp-orig"), data, w, h); putRGBA($("cmp-out"), S.recon, w, h);
    const err = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const d = (Math.abs(data[i*4]-S.recon[i*4]) + Math.abs(data[i*4+1]-S.recon[i*4+1]) + Math.abs(data[i*4+2]-S.recon[i*4+2])) / 3 * 6; err[i*4] = err[i*4+1] = err[i*4+2] = clamp(255 - d); err[i*4+3] = 255; }
    putRGBA($("cmp-err"), err, w, h);
    putRGBA($("q-img"), S.recon, w, h);
  }

  // ---------- step 1 ----------
  function renderColor() {
    drawPlane($("pl-y"), "Y"); drawPlane($("pl-cb"), "Cb"); drawPlane($("pl-cr"), "Cr");
    renderColorView(); renderPixel(false);
  }
  function renderColorView() {
    const { w, h, data } = S.img, out = new Uint8ClampedArray(w * h * 4), v = S.view;
    const { planes, pw, fx, fy } = S.pl;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let [Y, Cb, Cr] = rgb2ycc(data[i], data[i + 1], data[i + 2]);
      if (v === "luma") { Cb = 128; Cr = 128; }
      else if (v === "chroma") Y = 128;
      else if (v === "sub") { const cp = planes.Cb, k = Math.floor(y / fy) * cp.w + Math.floor(x / fx); Cb = cp.d[k]; Cr = planes.Cr.d[k]; }
      const [r, g, b] = (v === "orig") ? [data[i], data[i + 1], data[i + 2]] : ycc2rgb(Y, Cb, Cr);
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
    putRGBA($("color-view"), out, w, h);
    $("view-note").textContent = {
      orig: "Click a pixel to run the conversion on it.",
      luma: "Only Y kept: a complete, sharp grayscale picture. Most of the information is here.",
      chroma: "Only Cb/Cr kept (Y fixed at 128): soft color blobs with almost no detail, so they can be stored at lower resolution.",
      sub: `Chroma stored at ${S.sub === "444" ? "full" : S.sub === "422" ? "half width" : "quarter"} resolution, Y untouched. Compare with Original: the loss is hard to see.`,
    }[v];
  }
  async function renderPixel(animate = true) {
    const { w, data } = S.img, [px, py] = S.pix, i = (py * w + px) * 4, R = data[i], G = data[i + 1], B = data[i + 2];
    const [Y, Cb, Cr] = rgb2ycc(R, G, B), tok = ++S.anim.px;
    $("px-swatch").style.background = `rgb(${R},${G},${B})`;
    $("px-pos").textContent = `pixel (${px}, ${py})  R${R} G${G} B${B}`;
    const f = (v) => v.toFixed(1);
    const rows = [
      ["Y", `0.299×${R} + 0.587×${G} + 0.114×${B}`, `${f(0.299*R)} + ${f(0.587*G)} + ${f(0.114*B)}`, Y, "var(--y-col)"],
      ["Cb", `128 − 0.1687×${R} − 0.3313×${G} + 0.5×${B}`, `128 − ${f(0.168736*R)} − ${f(0.331264*G)} + ${f(0.5*B)}`, Cb, "var(--cb-col)"],
      ["Cr", `128 + 0.5×${R} − 0.4187×${G} − 0.0813×${B}`, `128 + ${f(0.5*R)} − ${f(0.418688*G)} − ${f(0.081312*B)}`, Cr, "var(--cr-col)"],
    ];
    const box = $("px-calc"); box.replaceChildren();
    for (let n = 0; n < rows.length; n++) {
      if (animate) await sleep(500); if (tok !== S.anim.px) return;
      const [nm, a, b, v, col] = rows[n], div = document.createElement("div");
      div.className = "px-line"; div.style.animationDelay = "0s";
      div.innerHTML = `<span>${nm} = ${a}</span><span style="opacity:.7">= ${b}</span><b>${nm} = ${f(v)}</b><div class="px-bar"><i style="background:${col}"></i></div>`;
      box.appendChild(div);
      requestAnimationFrame(() => requestAnimationFrame(() => { div.querySelector("i").style.width = `${clamp(v) / 255 * 100}%`; }));
    }
  }

  // ---------- step 2 ----------
  function renderBlockCanvas() {
    const c = $("blk-canvas"), p = curPlane(), { w, h, data } = S.img;
    const sx = S.pl.fx * (S.chan === "Y" ? 1 : 1), sy = S.pl.fy;
    const fx = S.chan === "Y" ? 1 : S.pl.fx, fy = S.chan === "Y" ? 1 : S.pl.fy; // plane pixel -> image pixel
    c.width = w; c.height = h; const ctx = c.getContext("2d");
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = Math.floor(y / fy) * p.w + Math.floor(x / fx), v = p.d[k], i = (y * w + x) * 4;
      let r, g, b;
      if (S.chan === "Y") r = g = b = v; else [r, g, b] = S.chan === "Cb" ? ycc2rgb(128, v, 128) : ycc2rgb(128, 128, v);
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    const bsx = 8 * fx, bsy = 8 * fy; // block size in image px
    ctx.fillStyle = "rgba(0,0,0,.28)"; // padding
    if (p.w * fx > w) ctx.fillRect(w, 0, p.w * fx - w, h);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= w; x += bsx) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); }
    for (let y = 0; y <= h; y += bsy) { ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); }
    ctx.stroke();
    ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2; ctx.strokeRect(S.blk.x * bsx + 1, S.blk.y * bsy + 1, bsx - 2, bsy - 2);
    const padW = p.w * fx - w, padH = p.h * fy - h;
    $("blk-info").textContent = `${S.chan} · block (${S.blk.x}, ${S.blk.y}) of ${p.bw}×${p.bh}`;
    $("blk-pad-note").textContent = `${p.bw * p.bh} blocks in this channel. Image is ${w}×${h}; padded to ${p.w * fx}×${p.h * fy}${padW || padH ? " (padding edge pixels repeated)" : ""}.` + (S.chan !== "Y" && S.sub !== "444" ? ` Chroma is subsampled first, so one block covers ${bsx}×${bsy} image pixels.` : "");
    void sx; void sy;
  }
  function renderBlockMatrix(shifted = false) {
    const { raw, shifted: sh } = blockData(), cells = makeMx($("blk-matrix"));
    cells.forEach((c, i) => { const v = Math.round(shifted ? sh[i] : raw[i]); c.textContent = v; c.style.background = shifted ? heat(v, 128) : gray(raw[i]); c.style.color = shifted ? "" : (raw[i] > 128 ? "#111" : "#eee"); });
    $("blk-vector").textContent = "vector = [" + Array.from(shifted ? sh : raw, (v) => Math.round(v)).join(", ") + "]";
    drawHist(0);
  }
  function drawHist(t) {
    const p = curPlane(), bins = new Array(64).fill(0);
    for (let i = 0; i < p.d.length; i++) bins[clamp(Math.floor(p.d[i] / 4), 0, 63)]++;
    const max = Math.max(...bins), c = $("hist-canvas"), ctx = c.getContext("2d"), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    // x axis spans values -128..255; histogram slides left by 128 as t goes 0 -> 1
    ctx.fillStyle = "rgba(60,140,200,.85)";
    bins.forEach((n, i) => { const v = i * 4 - 128 * t, x = ((v + 128) / 384) * W, bh = (n / max) * (H - 6); ctx.fillRect(x, H - bh, (4 / 384) * W + .5, bh); });
    ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2; const lx = (128 / 384) * W; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
    $("hist-l").textContent = "−128"; $("hist-m").textContent = "0 (yellow)"; $("hist-r").textContent = "255";
  }
  async function playLevelShift() {
    const tok = ++S.anim.blk; renderBlockMatrix(false);
    const { raw, shifted } = blockData(), cells = Array.from($("blk-matrix").children), st = $("blk-status");
    st.textContent = "Reading each sample f(x,y) …"; await sleep(350);
    for (let i = 0; i < 64; i++) {
      if (tok !== S.anim.blk) return;
      const c = cells[i]; c.classList.add("hot");
      const from = Math.round(raw[i]), to = Math.round(shifted[i]);
      st.textContent = `f(${i % 8},${(i / 8) | 0}) = ${from}  →  ${from} − 128 = ${to}`;
      for (let s = 1; s <= 3; s++) { c.textContent = Math.round(from + (to - from) * s / 3); await sleep(i < 8 ? 40 : 14); }
      c.style.background = heat(to, 128); c.style.color = ""; c.classList.remove("hot");
    }
    // histogram slides left
    for (let s = 0; s <= 20; s++) { if (tok !== S.anim.blk) return; drawHist(s / 20); await sleep(30); }
    drawHist(1);
    st.textContent = "Done: samples now centered on 0 (−128…127). Pixel differences are untouched; only the baseline moved.";
    $("blk-vector").textContent = "vector = [" + Array.from(shifted, (v) => Math.round(v)).join(", ") + "]";
  }

  // ---------- step 3 ----------
  function buildBasisGrid() {
    const g = $("basis-grid"); g.replaceChildren();
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
      const c = document.createElement("canvas"); c.width = 8; c.height = 8; paintBasis(c, u, v);
      c.title = `u=${u}, v=${v}`; c.dataset.u = u; c.dataset.v = v; if (u === S.uv[0] && v === S.uv[1]) c.classList.add("sel");
      c.addEventListener("click", () => { S.uv = [u, v]; g.querySelectorAll("canvas").forEach((n) => n.classList.toggle("sel", n === c)); renderDctCalc(); playDct(); });
      g.appendChild(c);
    }
  }
  function paintBasis(c, u, v) {
    const ctx = c.getContext("2d"), img = ctx.createImageData(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const g = clamp(128 + 127 * basisAt(u, v, x, y)), i = (y * 8 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const basisAt = (u, v, x, y) => Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
  function renderDct() {
    const { shifted, F, p } = blockData();
    const ins = makeMx($("dct-in")), outs = makeMx($("dct-out")), maxF = Math.max(...F.map(Math.abs).slice(1), 1);
    ins.forEach((c, i) => { c.textContent = Math.round(shifted[i]); c.style.background = heat(shifted[i], 128); });
    outs.forEach((c, i) => { c.textContent = Math.round(F[i]); c.style.background = i === 0 ? "color-mix(in oklab, var(--primary) 30%, var(--secondary))" : heat(F[i], maxF); c.title = `F(${i % 8},${(i / 8) | 0}) = ${F[i].toFixed(2)}`; });
    const bc = $("dct-block-img"); bc.width = 8; bc.height = 8;
    const img = bc.getContext("2d").createImageData(8, 8);
    for (let i = 0; i < 64; i++) { const g = clamp(shifted[i] + 128); img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = g; img.data[i*4+3] = 255; }
    bc.getContext("2d").putImageData(img, 0, 0);
    void p; renderDctCalc(); renderRebuild();
  }
  function renderDctCalc() {
    const [u, v] = S.uv, { shifted, F } = blockData(), cells = makeMx($("dct-products"));
    $("dct-title").textContent = `Computing F(${u},${v})${u === 0 && v === 0 ? "  (the DC coefficient)" : ""}`;
    const bl = $("basis-large"); bl.width = 8; bl.height = 8; paintBasis(bl, u, v);
    cells.forEach((c) => { c.textContent = "·"; c.style.background = ""; });
    $("dct-sum").textContent = "0.0"; $("dct-final").textContent = "";
    S.dctF = F[v * 8 + u]; S.dctShifted = shifted;
  }
  async function playDct() {
    const tok = ++S.anim.dct; renderDctCalc();
    const [u, v] = S.uv, cells = Array.from($("dct-products").children), sh = S.dctShifted;
    const scale = 0.25 * (u === 0 ? Math.SQRT1_2 : 1) * (v === 0 ? Math.SQRT1_2 : 1);
    let sum = 0;
    for (let i = 0; i < 64; i++) {
      if (tok !== S.anim.dct) return;
      const x = i % 8, y = (i / 8) | 0, prod = sh[i] * basisAt(u, v, x, y);
      sum += prod; cells[i].classList.add("hot"); cells[i].textContent = Math.round(prod); cells[i].style.background = heat(prod, 128);
      $("dct-sum").textContent = sum.toFixed(1); await sleep(35); cells[i].classList.remove("hot");
    }
    if (tok !== S.anim.dct) return;
    $("dct-sum").textContent = (sum * scale).toFixed(1);
    $("dct-final").textContent = `Σ = ${sum.toFixed(1)}, × ¼C(u)C(v) = ${(sum * scale).toFixed(2)}` + (u === 0 && v === 0 ? `  ·  block mean × 8 = ${(sh.reduce((a, b) => a + b, 0) / 64 * 8).toFixed(2)}` : "");
  }
  function renderRebuild() {
    const n = +$("dct-keep").value, { shifted, F } = blockData();
    $("dct-keep-value").textContent = n; $("keep-label").textContent = `N = ${n}`;
    const Fk = new Float64Array(64); for (let k = 0; k < n; k++) Fk[ZZ[k]] = F[ZZ[k]];
    const rec = idct(Fk);
    for (const [id, arr] of [["rb-block-orig", shifted], ["rb-block-new", rec]]) {
      const c = $(id); c.width = 8; c.height = 8; const img = c.getContext("2d").createImageData(8, 8);
      for (let i = 0; i < 64; i++) { const g = clamp(arr[i] + 128); img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = g; img.data[i*4+3] = 255; }
      c.getContext("2d").putImageData(img, 0, 0);
    }
    const { w, h } = S.img; putRGBA($("rb-image"), reconstruct({ keep: n, noQuant: true }), w, h);
  }

  // ---------- step 4 ----------
  function renderQuant() {
    const { F, q, T } = blockData(), maxF = Math.max(...F.map(Math.abs).slice(1), 1);
    const a = makeMx($("q-in")), t = makeMx($("q-table")), o = makeMx($("q-out"));
    $("q-table-tag").textContent = S.chan === "Y" ? "LUMA TABLE" : `CHROMA TABLE${S.chroma > 1 ? " ×" + S.chroma : ""}`;
    a.forEach((c, i) => { c.textContent = Math.round(F[i]); c.style.background = heat(F[i], maxF); });
    t.forEach((c, i) => { c.textContent = T[i]; c.style.background = `color-mix(in oklab, var(--cr-col) ${Math.round(T[i] / 255 * 70)}%, var(--secondary))`; });
    o.forEach((c, i) => { c.textContent = q[i]; c.style.background = q[i] === 0 ? "" : heat(q[i], 20); c.classList.toggle("zero", q[i] === 0); });
    const z = q.filter((v) => v === 0).length;
    $("q-zero-note").textContent = `${z} of 64 coefficients in this block are zero. Whole image: ${(S.enc.zeros / S.enc.total * 100).toFixed(0)}% zeros.`;
    // survival map (Y) and table map
    const sv = $("q-survive"), tm = $("q-tablemap"); sv.width = sv.height = tm.width = tm.height = 8;
    const si = sv.getContext("2d").createImageData(8, 8), ti = tm.getContext("2d").createImageData(8, 8);
    const isY = S.chan === "Y", surv = S.enc.survive[isY ? "Y" : "C"], nb = S.enc.nblocks[isY ? "Y" : "C"];
    for (let i = 0; i < 64; i++) {
      const s = surv[i] / nb, tv = Math.round(255 - T[i]);
      si.data.set([Math.round(255 - s * 200), Math.round(255 - s * 120), 255, 255], i * 4); ti.data.set([tv, tv, tv, 255], i * 4);
    }
    sv.getContext("2d").putImageData(si, 0, 0); tm.getContext("2d").putImageData(ti, 0, 0);
    $("q-survive-cap").textContent = `Share of ${S.chan} blocks where each coefficient is non-zero (darker = survives more)`;
  }
  async function playQuant() {
    const tok = ++S.anim.q, { F, q, T } = blockData(), o = Array.from($("q-out").children), a = Array.from($("q-in").children), t = Array.from($("q-table").children);
    o.forEach((c) => { c.textContent = "·"; c.style.background = ""; c.classList.remove("zero"); });
    for (let k = 0; k < 64; k++) {
      if (tok !== S.anim.q) return;
      const i = ZZ[k]; [a[i], t[i], o[i]].forEach((c) => c.classList.add("hot"));
      o[i].textContent = (F[i] / T[i]).toFixed(1); await sleep(60);
      o[i].textContent = q[i]; o[i].style.background = q[i] === 0 ? "" : heat(q[i], 20); o[i].classList.toggle("zero", q[i] === 0);
      await sleep(25); [a[i], t[i], o[i]].forEach((c) => c.classList.remove("hot"));
    }
  }

  // ---------- step 5 ----------
  const ZZPTS = () => ZZ.map((i) => [((i % 8) + .5) * 50, (((i / 8) | 0) + .5) * 50]);
  function renderZigzagStatic() {
    const { q } = blockData(), cells = makeMx($("zz-matrix"));
    cells.forEach((c, i) => { c.textContent = q[i]; c.style.background = q[i] === 0 ? "" : heat(q[i], 20); c.classList.toggle("zero", q[i] === 0); });
    const path = $("zz-path"), pts = ZZPTS(); path.setAttribute("d", "M" + pts.map((p) => p.join(" ")).join(" L"));
    const len = path.getTotalLength(); path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
    const d = $("zz-dot"); d.setAttribute("cx", pts[0][0]); d.setAttribute("cy", pts[0][1]);
    const seq = ZZ.map((i) => q[i]), last = seq.reduce((m, v, k) => (v !== 0 ? k : m), 0);
    $("zz-strip").replaceChildren(); $("zz-tag").textContent = `${63 - last} trailing zeros`;
    const rs = $("zz-raster"); rs.replaceChildren();
    let rlast = 0; q.forEach((v, i) => { if (v !== 0) rlast = i; });
    q.forEach((v, i) => { const s = document.createElement("span"); s.textContent = v; if (v === 0) s.className = "z"; rs.appendChild(s); });
    $("zz-note").textContent = `Zig-zag ends with ${63 - last} zeros in a row (replaced by one EOB). Row-by-row order ends with only ${63 - rlast}, interrupted by non-zeros earlier, so it needs more run-length symbols.`;
    S.zzLast = last; S.zzLen = len;
  }
  async function playZigzag() {
    const tok = ++S.anim.zz; renderZigzagStatic();
    const { q } = blockData(), cells = Array.from($("zz-matrix").children), strip = $("zz-strip"), pts = ZZPTS(), path = $("zz-path"), dot = $("zz-dot");
    const seg = []; { let acc = 0; seg.push(0); for (let k = 1; k < 64; k++) { acc += Math.hypot(pts[k][0] - pts[k-1][0], pts[k][1] - pts[k-1][1]); seg.push(acc); } }
    const total = path.getTotalLength(), scale = total / seg[63];
    for (let k = 0; k < 64; k++) {
      if (tok !== S.anim.zz) return;
      const i = ZZ[k]; cells[i].classList.add("visited", "hot");
      dot.setAttribute("cx", pts[k][0]); dot.setAttribute("cy", pts[k][1]); path.style.strokeDashoffset = total - seg[k] * scale;
      const s = document.createElement("span"); s.textContent = q[i]; if (q[i] === 0) s.className = "z"; s.title = `#${k} ← (${i % 8},${(i / 8) | 0})`;
      if (k <= S.zzLast) strip.appendChild(s); else if (k === S.zzLast + 1) { const e = document.createElement("span"); e.className = "eob"; e.textContent = `EOB · ${63 - S.zzLast} zeros dropped`; strip.appendChild(e); }
      await sleep(Math.max(12, 260 - 24 * (+$("zz-speed").value)) ); cells[i].classList.remove("hot");
    }
  }

  // ---------- step 6 ----------
  function renderDpcm() {
    const p = curPlane(), qs = S.enc.q[S.chan], grid = $("dpcm-grid"), N = Math.min(16, p.bw), row = S.blk.y, start = clamp(S.blk.x - 8, 0, Math.max(0, p.bw - N));
    grid.replaceChildren(); S.dpcmRows = [];
    let prev = start === 0 ? 0 : qs[(row * p.bw + start - 1) * 64];
    for (let k = 0; k < N; k++) {
      const bx = start + k, dc = qs[(row * p.bw + bx) * 64], diff = dc - prev;
      const d = document.createElement("div"); d.className = "dpcm-cell" + (bx === S.blk.x ? " sel" : "");
      d.innerHTML = `<small>block ${bx}</small>DC ${dc}<b>${diff >= 0 ? "+" : ""}${diff}</b>`;
      grid.appendChild(d); S.dpcmRows.push({ d, dc, diff }); prev = dc;
    }
    const rows = S.dpcmRows, avgDc = rows.reduce((a, r) => a + Math.abs(r.dc), 0) / rows.length, avgDiff = rows.reduce((a, r) => a + Math.abs(r.diff), 0) / rows.length;
    $("dpcm-note").textContent = `Row ${row}, ${S.chan}: mean |DC| = ${avgDc.toFixed(1)} vs mean |DIFF| = ${avgDiff.toFixed(1)}. Smaller numbers need fewer bits.`;
    rows.forEach((r) => r.d.classList.add("done"));
  }
  async function playDpcm() {
    renderDpcm(); const tok = ++S.anim.dpcm; S.dpcmRows.forEach((r) => r.d.classList.remove("done"));
    for (const r of S.dpcmRows) { if (tok !== S.anim.dpcm) return; r.d.classList.add("cur"); await sleep(260); r.d.classList.remove("cur"); r.d.classList.add("done"); }
  }
  function blockSymbols() { const { q } = blockData(); return symbolsOfBlock(q, prevDC()); }
  function renderRle(animate) {
    const sy = blockSymbols(), { q } = blockData(), list = $("rle-list"), tok = ++S.anim.rle; list.replaceChildren();
    const rows = [];
    rows.push(`<span>DC</span><span>DIFF = ${sy.dc.diff}</span><span>size ${sy.dc.size}</span><span>amp ${ampBits(sy.dc.diff, sy.dc.size) || "—"}</span>`);
    let k = 1; for (const a of sy.ac) {
      if (a.zrl) { rows.push(`<span>AC</span><span>16 zeros</span><span>ZRL (15,0)</span><span>—</span>`); continue; }
      rows.push(`<span>AC</span><span>${a.run} zero${a.run === 1 ? "" : "s"}, then ${a.amp}</span><span>(${a.run}, ${a.size})</span><span>amp ${ampBits(a.amp, a.size)}</span>`); k++;
    }
    const tail = 63 - sy.last; void q;
    if (sy.eob) rows.push(`<span>EOB</span><span>${tail} trailing zeros</span><span>(0, 0)</span><span>—</span>`);
    (async () => { for (let i = 0; i < rows.length; i++) { if (tok !== S.anim.rle) return; const d = document.createElement("div"); d.className = "rle-row" + (rows[i].startsWith("<span>EOB") ? " eob" : ""); if (!animate) d.style.animationDuration = "0s"; d.innerHTML = rows[i]; list.appendChild(d); if (animate) await sleep(220); } })();
  }
  function renderHuff() {
    const grp = S.chan === "Y" ? "luma" : "chroma", sy = blockSymbols(), codes = { dc: S.enc.code[grp + "DC"], ac: S.enc.code[grp + "AC"] };
    const used = new Set([`ac:0`]); used.add("dc:" + sy.dc.size); sy.ac.forEach((a) => used.add("ac:" + (((a.run) << 4) | a.size)));
    const freq = S.enc.freq[grp + "AC"], top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 12), maxF = top.length ? top[0][1] : 1;
    const tbl = $("huff-table"); tbl.replaceChildren();
    const head = document.createElement("div"); head.className = "huff-row head"; head.innerHTML = "<span>SYMBOL</span><span>COUNT</span><span>CODE</span>"; tbl.appendChild(head);
    const dcDiv = document.createElement("div"); dcDiv.className = "huff-row head"; dcDiv.innerHTML = `<span>DC size ${sy.dc.size}</span><span></span><span>${codes.dc.get(sy.dc.size) || ""}</span>`; tbl.appendChild(dcDiv);
    top.forEach(([s, c]) => {
      const d = document.createElement("div"); d.className = "huff-row" + (used.has("ac:" + s) ? " used" : "");
      d.innerHTML = `<span>${s === 0 ? "EOB" : `(${s >> 4},${s & 15})`}</span><span>${c}</span><span><span class="huff-bar" style="display:block;width:${Math.max(8, 120 * c / maxF)}px"></span><b>${codes.ac.get(s)}</b></span>`;
      tbl.appendChild(d);
    });
    $("bitstream").replaceChildren(); $("bit-total").textContent = "Press Build bitstream.";
    S.huffCtx = { sy, codes };
  }
  async function playHuff() {
    renderHuff(); const tok = ++S.anim.huff, { sy, codes } = S.huffCtx, bs = $("bitstream"); let bits = 0;
    const add = async (cls, code, label) => { if (tok !== S.anim.huff) return false; const d = document.createElement("span"); d.className = "bitseg " + cls; d.innerHTML = `${code || "∅"}<small>${label}</small>`; bs.appendChild(d); bits += code.length; $("bit-total").textContent = `${bits} bits so far`; await sleep(330); return true; };
    if (!(await add("dc", codes.dc.get(sy.dc.size) || "", `DC size ${sy.dc.size}`))) return;
    if (sy.dc.size && !(await add("amp", ampBits(sy.dc.diff, sy.dc.size), "DC amp"))) return;
    for (const a of sy.ac) {
      const s = (a.run << 4) | a.size;
      if (!(await add("ac", codes.ac.get(s) || "", a.zrl ? "ZRL" : `(${a.run},${a.size})`))) return;
      if (a.size && !(await add("amp", ampBits(a.amp, a.size), `= ${a.amp}`))) return;
    }
    if (sy.eob && !(await add("eob", codes.ac.get(0) || "", "EOB"))) return;
    $("bit-total").textContent = `${bits} bits for this block vs 64 × 8 = 512 bits raw (${(512 / bits).toFixed(1)}× smaller, no further loss)`;
  }
  function renderFileLayout() {
    const e = S.enc, entropy = Math.ceil(e.bits / 8), segs = [
      ["SOI", 2, "var(--secondary)"], ["APP0", 18, "color-mix(in oklab,var(--cb-col) 18%,var(--card))"], ["DQT", 134, "color-mix(in oklab,var(--cr-col) 18%,var(--card))"],
      ["SOF0", 19, "color-mix(in oklab,var(--pos) 20%,var(--card))"], ["DHT", e.hdr - 2 - 18 - 134 - 19 - 14 - 2, "color-mix(in oklab,var(--cb-col) 28%,var(--card))"], ["SOS", 14, "color-mix(in oklab,var(--pos) 28%,var(--card))"],
      ["ENTROPY DATA", entropy, "color-mix(in oklab,var(--primary) 30%,var(--card))"], ["EOI", 2, "var(--secondary)"],
    ], total = segs.reduce((a, s) => a + s[1], 0), box = $("file-layout"); box.replaceChildren();
    segs.forEach(([n, b, col]) => { const d = document.createElement("div"); d.className = "file-seg"; d.style.flex = `${Math.max(b / total, 0.03)} 0 0`; d.style.background = col; d.innerHTML = `<span>${n}<small>${fmtBytes(b)}</small></span>`; d.title = `${n}: ${b} bytes`; box.appendChild(d); });
    $("file-note").textContent = `Total ≈ ${fmtBytes(total)}. DQT stores both quantization tables, SOF0 the image size and subsampling, DHT the Huffman tables, and everything after SOS is the packed bitstream of every block.`;
  }

  // ---------- pipeline orchestration ----------
  function runAll(full) {
    if (!S.img) return;
    if (full) { S.pl = buildPlanes(); }
    S.enc = encode(); S.recon = reconstruct();
    renderSummary(); renderCompare();
    if (full) { renderColor(); pickDefaultBlock(); }
    clampBlock(); refreshBlock();
  }
  function refreshBlock() {
    renderBlockCanvas(); renderBlockMatrix(false); renderDct(); renderQuant(); renderZigzagStatic(); renderDpcm(); renderRle(false); renderHuff(); renderFileLayout();
  }
  function schedule(full) { cancelAnimationFrame(S.raf); S.fullPending = S.fullPending || full; S.raf = requestAnimationFrame(() => { const f = S.fullPending; S.fullPending = false; runAll(f); }); }

  // ---------- image loading ----------
  function sampleImage() {
    const c = document.createElement("canvas"); c.width = 256; c.height = 192; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 256, 192); g.addColorStop(0, "#1b3a8a"); g.addColorStop(.5, "#e8743b"); g.addColorStop(1, "#f6d365"); x.fillStyle = g; x.fillRect(0, 0, 256, 192);
    x.fillStyle = "#2a9d6f"; x.beginPath(); x.arc(70, 120, 48, 0, 7); x.fill();
    x.fillStyle = "#f4f1de"; x.fillRect(150, 30, 70, 70); x.strokeStyle = "#222"; x.lineWidth = 3; x.strokeRect(150, 30, 70, 70);
    x.fillStyle = "#c1121f"; x.beginPath(); x.moveTo(170, 170); x.lineTo(215, 110); x.lineTo(250, 175); x.fill();
    x.fillStyle = "#111"; x.font = "bold 22px sans-serif"; x.fillText("JPEG 8×8", 20, 40);
    for (let i = 0; i < 18; i++) { x.fillStyle = i % 2 ? "#fff" : "#000"; x.fillRect(120 + i * 4, 140, 2, 40); } // fine detail
    return x.getImageData(0, 0, 256, 192);
  }
  function setImage(imgData, label) {
    S.img = { w: imgData.width, h: imgData.height, data: imgData.data };
    window.__labImage = S.img; window.dispatchEvent(new CustomEvent("lab-image"));
    putRGBA($("src-canvas"), imgData.data, imgData.width, imgData.height);
    $("jpeg-meta").textContent = `${label} · ${imgData.width} × ${imgData.height}`;
    S.pix = [Math.floor(imgData.width / 2), Math.floor(imgData.height / 2)];
    runAll(true); renderPixel(true);
  }
  function saveUploadedImage(canvas, imgData, file) {
    if (!window.indexedDB) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const open = indexedDB.open("pixel-foundations", 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
        if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
      };
      open.onsuccess = () => {
        const db = open.result;
        db.onversionchange = () => db.close();
        if (!db.objectStoreNames.contains("images")) { db.close(); return; }
        const tx = db.transaction("images", "readwrite");
        tx.objectStore("images").put({ id: "latest", blob, name: file.name, type: file.type, width: imgData.width, height: imgData.height, matrix: imgData.data.slice(), savedAt: Date.now() });
        tx.oncomplete = () => db.close();
        tx.onerror = tx.onabort = () => db.close();
      };
    }, "image/png");
  }
  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    createImageBitmap(file).then((bm) => {
      const sc = Math.min(1, MAXDIM / Math.max(bm.width, bm.height)), w = Math.max(8, Math.round(bm.width * sc)), h = Math.max(8, Math.round(bm.height * sc));
      const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.drawImage(bm, 0, 0, w, h);
      const pixels = x.getImageData(0, 0, w, h);
      setImage(pixels, file.name);
      saveUploadedImage(c, pixels, file);
      bm.close();
    }).catch(() => { const meta = $("jpeg-meta"); if (meta) meta.textContent = "Could not decode this image."; });
  }
  function canvasPoint(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / r.width * canvas.width), Math.floor((e.clientY - r.top) / r.height * canvas.height)];
  }

  // ---------- binding ----------
  function bind() {
    const root = $("jpeg-root");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1"; S.quality = 50; S.chroma = 1; S.sub = "420"; S.chan = "Y"; S.view = "orig"; S.uv = [1, 0];
    Object.keys(S.anim).forEach((k) => S.anim[k]++);
    $("jpeg-upload").addEventListener("change", (e) => loadFile(e.target.files[0]));
    $("jpeg-sample").addEventListener("click", () => setImage(sampleImage(), "Sample image"));
    $("q-quality").addEventListener("input", (e) => { S.quality = +e.target.value; $("q-quality-value").textContent = S.quality; schedule(false); });
    $("q-chroma").addEventListener("input", (e) => { S.chroma = +e.target.value; $("q-chroma-value").textContent = S.chroma + "×"; schedule(false); });
    root.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => { S.sub = b.dataset.sub; root.querySelectorAll("[data-sub]").forEach((x) => x.classList.toggle("selected", x === b)); schedule(true); }));
    root.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.view; root.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("selected", x === b)); renderColorView(); }));
    root.querySelectorAll("[data-chan]").forEach((b) => b.addEventListener("click", () => { S.chan = b.dataset.chan; root.querySelectorAll("[data-chan]").forEach((x) => x.classList.toggle("selected", x === b)); clampBlock(); refreshBlock(); }));
    $("color-view").addEventListener("click", (e) => { const [x, y] = canvasPoint($("color-view"), e); S.pix = [clamp(x, 0, S.img.w - 1), clamp(y, 0, S.img.h - 1)]; renderPixel(true); });
    $("px-replay").addEventListener("click", () => renderPixel(true));
    $("blk-canvas").addEventListener("click", (e) => {
      const [x, y] = canvasPoint($("blk-canvas"), e), f = S.chan === "Y" ? 1 : S.pl.fx, g = S.chan === "Y" ? 1 : S.pl.fy;
      S.blk = { x: Math.floor(x / (8 * f)), y: Math.floor(y / (8 * g)) }; clampBlock(); refreshBlock();
    });
    $("blk-play").addEventListener("click", playLevelShift);
    $("dct-play").addEventListener("click", playDct);
    $("dct-keep").addEventListener("input", renderRebuild);
    $("q-play").addEventListener("click", playQuant);
    $("zz-play").addEventListener("click", playZigzag);
    $("zz-reset").addEventListener("click", () => { S.anim.zz++; renderZigzagStatic(); });
    $("zz-speed").addEventListener("input", (e) => { $("zz-speed-value").textContent = e.target.value; });
    $("dpcm-play").addEventListener("click", playDpcm);
    $("rle-play").addEventListener("click", () => renderRle(true));
    $("huff-play").addEventListener("click", playHuff);
    $("real-jpeg").addEventListener("click", () => {
      $("src-canvas").toBlob((b) => { $("real-jpeg-out").textContent = b ? `Browser encoder at quality ${S.quality}: ${fmtBytes(b.size)}  ·  this lab's estimate: ${fmtBytes(S.enc.bytes)}` : "Encoder unavailable"; }, "image/jpeg", S.quality / 100);
    });
    buildBasisGrid();
    // start from stored image of the operations page if present, else sample
    const done = (d, l) => setImage(d, l);
    try {
      const open = window.indexedDB && indexedDB.open("pixel-foundations", 2);
      if (!open) throw 0;
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
        if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
      };
      open.onerror = () => done(sampleImage(), "Sample image");
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("images")) { db.close(); return done(sampleImage(), "Sample image"); }
        const rq = db.transaction("images").objectStore("images").get("latest");
        rq.onsuccess = () => { const s = rq.result; db.close(); if (s && s.matrix) { const m = new Uint8ClampedArray(s.matrix); const c0 = document.createElement("canvas"); c0.width = s.width; c0.height = s.height; c0.getContext("2d").putImageData(new ImageData(m, s.width, s.height), 0, 0); const sc = Math.min(1, MAXDIM / Math.max(s.width, s.height)), w = Math.max(8, Math.round(s.width * sc)), h = Math.max(8, Math.round(s.height * sc)), c1 = document.createElement("canvas"); c1.width = w; c1.height = h; c1.getContext("2d").drawImage(c0, 0, 0, w, h); done(c1.getContext("2d").getImageData(0, 0, w, h), "Image from Image operations"); } else done(sampleImage(), "Sample image"); };
        rq.onerror = () => { db.close(); done(sampleImage(), "Sample image"); };
      };
    } catch (_) { done(sampleImage(), "Sample image"); }
  }

  let tries = 0;
  window.initJpegLab = () => { if ($("jpeg-root")) bind(); else if (tries++ < 300) requestAnimationFrame(() => window.initJpegLab()); };
  window.initJpegLab();
})();
