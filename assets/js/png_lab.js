(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const h2 = (v) => v.toString(16).padStart(2, "0").toUpperCase();
  const h8 = (v) => (v >>> 0).toString(16).padStart(8, "0").toUpperCase();
  const fmt = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B");
  const CW = 6, CH = 5;
  const FN = ["None", "Sub", "Up", "Average", "Paeth"];
  const FCOL = ["#8b93a1", "#3b6fd8", "#2f9e6b", "#e0a020", "#d4474c"];
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  const P = { bound: false, mode: "auto", comp: "deflate", res: 128, bits: 8, crop: { x: 0, y: 0 }, row: 0, k: 0, tok: 0, raf: 0, built: null, url: null, a: { scan: 0, filt: 0, adler: 0, lz: 0, ihdr: 0, crc: 0, asm: 0, cmp: 0 } };

  // ---------- checksums ----------
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const adler32 = (bytes) => { let a = 1, b = 0; for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; };
  const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));

  // ---------- filters ----------
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const predict = (f, a, b, c) => (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c));
  const sgn = (v) => (v > 127 ? v - 256 : v);

  function workingImage() {
    const src = window.__labImage; if (!src) return null;
    const sc = Math.min(1, P.res / Math.max(src.w, src.h)), w = Math.max(8, Math.round(src.w * sc)), h = Math.max(8, Math.round(src.h * sc));
    const a = document.createElement("canvas"); a.width = src.w; a.height = src.h; a.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(src.data), src.w, src.h), 0, 0);
    const b = document.createElement("canvas"); b.width = w; b.height = h; const bx = b.getContext("2d"); bx.imageSmoothingEnabled = true; bx.drawImage(a, 0, 0, w, h);
    const d = bx.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3), shift = 8 - P.bits, maxv = (1 << P.bits) - 1;
    for (let i = 0, j = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) rgb[j++] = P.bits === 8 ? d[i + c] : Math.round(((d[i + c] >> shift) * 255) / maxv);
    return { w, h, rgb };
  }
  function filterAll(rgb, w, h) {
    const rb = w * 3, rows = [], scores = [];
    for (let y = 0; y < h; y++) {
      const raw = rgb.subarray(y * rb, (y + 1) * rb), up = y ? rgb.subarray((y - 1) * rb, y * rb) : null, fr = [], sc = [];
      for (let f = 0; f < 5; f++) {
        const out = new Uint8Array(rb); let s = 0;
        for (let i = 0; i < rb; i++) { const a = i >= 3 ? raw[i - 3] : 0, b = up ? up[i] : 0, c = up && i >= 3 ? up[i - 3] : 0; out[i] = (raw[i] - predict(f, a, b, c)) & 255; s += Math.abs(sgn(out[i])); }
        fr.push(out); sc.push(s);
      }
      rows.push(fr); scores.push(sc);
    }
    return { rows, scores, rb };
  }
  const chooseRows = (B, mode) => B.scores.map((s) => (mode === "auto" ? s.indexOf(Math.min(...s)) : Number(mode)));
  function makeStream(B, h, chosen) {
    const rb = B.rb, out = new Uint8Array(h * (rb + 1));
    for (let y = 0; y < h; y++) { out[y * (rb + 1)] = chosen[y]; out.set(B.rows[y][chosen[y]], y * (rb + 1) + 1); }
    return out;
  }

  // ---------- zlib ----------
  async function zlibDeflate(bytes) {
    if (typeof CompressionStream === "undefined") return null;
    const cs = new CompressionStream("deflate"), w = cs.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  function zlibStored(bytes) {
    const out = [0x78, 0x01]; let off = 0;
    do { const n = Math.min(65535, bytes.length - off), last = off + n >= bytes.length; out.push(last ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255); for (let i = 0; i < n; i++) out.push(bytes[off + i]); off += n; } while (off < bytes.length);
    out.push(...be32(adler32(bytes))); return Uint8Array.from(out);
  }
  const storedSize = (n) => 2 + 4 + n + 5 * Math.max(1, Math.ceil(n / 65535));
  const compress = async (stream, kind) => (kind === "stored" ? zlibStored(stream) : (await zlibDeflate(stream)) || zlibStored(stream));

  function chunk(type, data) {
    const body = Uint8Array.from([...ascii(type), ...data]), out = new Uint8Array(12 + data.length);
    out.set(be32(data.length), 0); out.set(body, 4); out.set(be32(crc32(body)), 8 + data.length);
    return out;
  }
  function assemble(w, h, idat) {
    const ihdr = Uint8Array.from([...be32(w), ...be32(h), 8, 2, 0, 0, 0]);
    const parts = [Uint8Array.from(SIG), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", [])];
    const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; const offs = [];
    parts.forEach((p) => { offs.push(o); png.set(p, o); o += p.length; });
    return { png, ihdr, parts, offs };
  }

  // ---------- build ----------
  function schedule() { cancelAnimationFrame(P.raf); P.raf = requestAnimationFrame(build); }
  async function build() {
    const tok = ++P.tok, img = workingImage(); if (!img) return;
    const B = filterAll(img.rgb, img.w, img.h), chosen = chooseRows(B, P.mode), stream = makeStream(B, img.h, chosen);
    const deflated = await zlibDeflate(stream), idat = P.comp === "stored" || !deflated ? zlibStored(stream) : deflated;
    if (tok !== P.tok) return;
    const asm = assemble(img.w, img.h, idat);
    P.built = { ...img, B, chosen, stream, idat, deflated, deflateLen: deflated ? deflated.length : null, ...asm };
    P.crop.x = clamp(P.crop.x, 0, img.w - CW); P.crop.y = clamp(P.crop.y, 0, img.h - CH);
    if (!P.cropSet) { P.crop = { x: clamp(Math.floor(img.w / 2) - 3, 0, img.w - CW), y: clamp(Math.floor(img.h / 2) - 2, 0, img.h - CH) }; }
    renderAll();
  }
  function renderAll() {
    const b = P.built; if (!b) return;
    $("pstat-raw").textContent = fmt(b.w * b.h * 3); $("pstat-filt").textContent = fmt(b.stream.length); $("pstat-idat").textContent = fmt(b.idat.length);
    $("pstat-file").textContent = fmt(b.png.length); $("pstat-ratio").textContent = (b.w * b.h * 3 / b.png.length).toFixed(2) + " : 1";
    renderSrc(); renderScan(); renderFilter(); renderFilterImages(); renderZlib(); renderAdler(false); renderLz(false); renderIhdr(false); renderCrc(false); renderChunks(); renderSig(); renderFile(false); renderDeflateCompare(); verify();
  }

  // ---------- step 1 ----------
  function renderSrc() {
    const b = P.built, c = $("png-src"), ctx = c.getContext("2d"), d = new Uint8ClampedArray(b.w * b.h * 4);
    for (let i = 0; i < b.w * b.h; i++) { d[i * 4] = b.rgb[i * 3]; d[i * 4 + 1] = b.rgb[i * 3 + 1]; d[i * 4 + 2] = b.rgb[i * 3 + 2]; d[i * 4 + 3] = 255; }
    c.width = b.w; c.height = b.h; ctx.putImageData(new ImageData(d, b.w, b.h), 0, 0);
    ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = Math.max(1, b.w / 128); ctx.strokeRect(P.crop.x, P.crop.y, CW, CH);
    $("png-dims").textContent = `${b.w} × ${b.h} px · ${P.bits}-bit channels`;
  }
  function renderScan() {
    const b = P.built, box = $("png-scan"); box.replaceChildren(); P.scanRows = [];
    for (let r = 0; r < CH; r++) {
      const y = P.crop.y + r, row = document.createElement("div"); row.className = "scan-row";
      const sw = document.createElement("div"); sw.className = "scan-sw";
      for (let x = 0; x < CW; x++) { const i = (y * b.w + P.crop.x + x) * 3, s = document.createElement("i"); s.style.background = `rgb(${b.rgb[i]},${b.rgb[i + 1]},${b.rgb[i + 2]})`; sw.appendChild(s); }
      const fc = document.createElement("span"); fc.className = "bcell fb"; fc.textContent = b.chosen[y]; fc.title = `filter type ${b.chosen[y]} (${FN[b.chosen[y]]})`; fc.style.setProperty("--fc", FCOL[b.chosen[y]]);
      const cells = [];
      for (let k = 0; k < CW * 3; k++) {
        const s = document.createElement("span"); s.className = "bcell ch" + "rgb"[k % 3]; s.textContent = b.rgb[y * b.w * 3 + P.crop.x * 3 + k];
        if (r === P.row && k === P.k) s.classList.add("sel");
        s.addEventListener("click", () => { P.row = r; P.k = k; renderScan(); renderFilter(); }); cells.push(s);
      }
      const more = document.createElement("small"); more.textContent = `+ ${b.w * 3 - CW * 3} more bytes`;
      row.append(sw, fc, ...cells, more); box.appendChild(row); P.scanRows.push({ sw, fc, cells });
    }
    $("scan-formula").textContent = `row = 1 filter byte + ${b.w} px × 3 channels = ${b.w * 3 + 1} bytes     ×  ${b.h} rows = ${b.stream.length} bytes before compression`;
  }
  async function playScan() {
    const tok = ++P.a.scan, rows = P.scanRows;
    rows.forEach((r) => { r.sw.style.opacity = 0; r.fc.style.opacity = 0; r.cells.forEach((c) => (c.style.opacity = 0)); });
    for (const r of rows) {
      if (tok !== P.a.scan) return;
      r.sw.style.opacity = 1; await sleep(280);
      for (const c of r.cells) { if (tok !== P.a.scan) return; c.style.opacity = 1; c.classList.add("pop"); await sleep(22); }
      r.fc.style.opacity = 1; r.fc.classList.add("pop"); await sleep(320);
    }
  }

  // ---------- step 2 ----------
  function neighbors(y, i) {
    const b = P.built, raw = (yy, ii) => (yy < 0 || ii < 0 ? 0 : b.rgb[yy * b.w * 3 + ii]);
    return { x: raw(y, i), a: raw(y, i - 3), b: raw(y - 1, i), c: raw(y - 1, i - 3), aOut: i < 3, bOut: y < 1, cOut: i < 3 || y < 1 };
  }
  function renderFilter(limit = CW * 3) {
    const b = P.built, y = P.crop.y + P.row, i = P.crop.x * 3 + P.k, n = neighbors(y, i), f = b.chosen[y];
    const cell = (lab, v, out, cls) => `<div class="ng ${cls}"><small>${lab}</small><b>${v}</b>${out ? "<em>outside = 0</em>" : ""}</div>`;
    $("neigh-grid").innerHTML = cell("c · above-left", n.c, n.cOut, "") + cell("b · above", n.b, n.bOut, "") + cell("a · left", n.a, n.aOut, "") + cell("x · this byte", n.x, false, "x");
    const t = $("filter-table"); t.replaceChildren();
    for (let ft = 0; ft < 5; ft++) {
      const pr = predict(ft, n.a, n.b, n.c), res = (n.x - pr) & 255, d = document.createElement("div"); d.className = "ft-row" + (ft === f ? " on" : "");
      d.innerHTML = `<span class="ft-name" style="--fc:${FCOL[ft]}">${ft} · ${FN[ft]}</span><span class="mono">pred ${pr}</span><span class="mono">${n.x} − ${pr} ≡ <b>${res}</b>${res > 127 ? ` (= ${res - 256})` : ""}</span>`;
      t.appendChild(d);
    }
    const p = n.a + n.b - n.c, pa = Math.abs(p - n.a), pb = Math.abs(p - n.b), pc = Math.abs(p - n.c), pick = pa <= pb && pa <= pc ? "a" : pb <= pc ? "b" : "c";
    $("paeth-calc").textContent = `Paeth:  p = a + b − c = ${n.a} + ${n.b} − ${n.c} = ${p}    |p−a| = ${pa}   |p−b| = ${pb}   |p−c| = ${pc}   → nearest is ${pick} = ${paeth(n.a, n.b, n.c)}`;
    const raw = $("filt-raw-strip"), out = $("filt-out-strip"); raw.replaceChildren(); out.replaceChildren();
    for (let k = 0; k < CW * 3; k++) {
      const rv = b.rgb[y * b.w * 3 + P.crop.x * 3 + k], fv = b.B.rows[y][f][P.crop.x * 3 + k];
      const s1 = document.createElement("span"); s1.textContent = rv; const s2 = document.createElement("span"); s2.textContent = k < limit ? fv : "·";
      if (k < limit && Math.abs(sgn(fv)) <= 3) s2.classList.add("z"); if (k === P.k) { s1.classList.add("cur"); s2.classList.add("cur"); }
      raw.appendChild(s1); out.appendChild(s2);
    }
    $("filt-row-tag").textContent = `row ${y} · filter ${f} ${FN[f]}`;
    const sc = b.B.scores[y], mx = Math.max(...sc, 1), min = Math.min(...sc), bars = $("score-bars"); bars.replaceChildren();
    sc.forEach((v, ft) => { const d = document.createElement("div"); d.className = "sb" + (v === min ? " best" : ""); d.innerHTML = `<span>${FN[ft]}</span><i style="width:${Math.max(2, v / mx * 100)}%;background:${FCOL[ft]}"></i><b class="mono">${v}</b>`; bars.appendChild(d); });
  }
  async function playFilter() {
    const tok = ++P.a.filt;
    for (let k = 0; k < CW * 3; k++) { if (tok !== P.a.filt) return; P.k = k; renderScan(); renderFilter(k + 1); await sleep(380); }
  }
  function renderFilterImages() {
    const b = P.built, v = $("png-filtered-view"), m = $("png-filter-map");
    const d = new Uint8ClampedArray(b.w * b.h * 4), md = new Uint8ClampedArray(b.w * b.h * 4);
    for (let y = 0; y < b.h; y++) {
      const row = b.B.rows[y][b.chosen[y]], col = FCOL[b.chosen[y]], cr = parseInt(col.slice(1, 3), 16), cg = parseInt(col.slice(3, 5), 16), cb = parseInt(col.slice(5, 7), 16);
      for (let x = 0; x < b.w; x++) { const o = (y * b.w + x) * 4; for (let c = 0; c < 3; c++) d[o + c] = 128 + sgn(row[x * 3 + c]); d[o + 3] = 255; md[o] = cr; md[o + 1] = cg; md[o + 2] = cb; md[o + 3] = 255; }
    }
    v.width = m.width = b.w; v.height = m.height = b.h;
    v.getContext("2d").putImageData(new ImageData(d, b.w, b.h), 0, 0); m.getContext("2d").putImageData(new ImageData(md, b.w, b.h), 0, 0);
    const ctx = m.getContext("2d"); ctx.font = `${Math.max(8, b.h / 14)}px sans-serif`;
    FN.forEach((n, i) => { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(2, 2 + i * (b.h / 12 + 2), b.w * 0.34, b.h / 12); ctx.fillStyle = FCOL[i]; ctx.fillRect(4, 4 + i * (b.h / 12 + 2), b.h / 14, b.h / 14); ctx.fillStyle = "#fff"; ctx.fillText(n, 6 + b.h / 12, 2 + b.h / 13 + i * (b.h / 12 + 2)); });
  }
  async function compareFilters() {
    const tok = ++P.a.cmp, b = P.built, box = $("filter-compare"); box.textContent = "Compressing…";
    const modes = ["0", "1", "2", "3", "4", "auto"], sizes = [];
    for (const m of modes) {
      const s = makeStream(b.B, b.h, chooseRows(b.B, m)), z = (await compress(s, "deflate")); if (tok !== P.a.cmp) return; sizes.push(z.length);
    }
    const mx = Math.max(...sizes), mn = Math.min(...sizes);
    box.replaceChildren(...modes.map((m, i) => { const d = document.createElement("div"); d.className = "sb" + (sizes[i] === mn ? " best" : ""); d.innerHTML = `<span>${m === "auto" ? "Adaptive" : FN[+m]}</span><i style="width:${sizes[i] / mx * 100}%;background:${m === "auto" ? "var(--primary)" : FCOL[+m]}"></i><b class="mono">${fmt(sizes[i])}</b>`; return d; }));
  }

  // ---------- step 3 ----------
  function renderZlib() {
    const b = P.built, cmf = b.idat[0], flg = b.idat[1];
    $("zlib-hdr").innerHTML = `<span class="hb">${h2(cmf)}</span><span class="hb">${h2(flg)}</span>`;
    $("zlib-formula").textContent = `CMF = 0x${h2(cmf)}: method ${cmf & 15} (8 = DEFLATE), window = 2^(${cmf >> 4} + 8) = ${2 ** ((cmf >> 4) + 8)} B.   FLG = 0x${h2(flg)}: level bits ${flg >> 6}, preset dict ${(flg >> 5) & 1}, check bits ${flg & 31}.   (CMF·256 + FLG) mod 31 = ${(cmf * 256 + flg) % 31} → must be 0`;
  }
  function renderAdler(animate) {
    const b = P.built, tbl = $("adler-table"), tok = ++P.a.adler, N = 12; tbl.replaceChildren();
    const head = document.createElement("div"); head.className = "ad-row head"; head.innerHTML = "<span>byte</span><span>A</span><span>B</span>"; tbl.appendChild(head);
    let a = 1, bb = 0; const rows = [];
    for (let i = 0; i < N; i++) { const v = b.stream[i]; a = (a + v) % 65521; bb = (bb + a) % 65521; const d = document.createElement("div"); d.className = "ad-row"; d.innerHTML = `<span class="mono">${v}</span><span class="mono">${a}</span><span class="mono">${bb}</span>`; rows.push(d); }
    const full = adler32(b.stream), tail = (b.idat[b.idat.length - 4] << 24 | b.idat[b.idat.length - 3] << 16 | b.idat[b.idat.length - 2] << 8 | b.idat[b.idat.length - 1]) >>> 0;
    const note = () => { $("adler-note").textContent = `First ${N} of ${b.stream.length} bytes shown. Adler-32 of the whole filtered stream = 0x${h8(full)}. Last 4 bytes of the zlib stream = 0x${h8(tail)} ${full === tail ? "✓ identical" : "✗"}`; };
    if (!animate) { rows.forEach((r) => tbl.appendChild(r)); note(); return; }
    $("adler-note").textContent = "";
    (async () => { for (const r of rows) { if (tok !== P.a.adler) return; tbl.appendChild(r); await sleep(260); } note(); })();
  }
  function lz77(s, win) {
    const t = []; let i = 0;
    while (i < s.length) {
      let bl = 0, bd = 0;
      for (let j = Math.max(0, i - win); j < i; j++) { let l = 0; while (i + l < s.length && l < 258 && s[j + l] === s[i + l]) l++; if (l > bl) { bl = l; bd = i - j; } }
      if (bl >= 3) { t.push({ t: "m", len: bl, dist: bd, at: i }); i += bl; } else { t.push({ t: "l", v: s[i], at: i }); i++; }
    }
    return t;
  }
  function lzSample() { const b = P.built, y = P.crop.y + P.row, n = +$("lz-len").value, st = Math.min(y * (b.w * 3 + 1), b.stream.length - n); return b.stream.subarray(st, st + n); }
  function renderLz(animate) {
    const s = lzSample(), win = +$("lz-window").value, toks = lz77(s, win), tok = ++P.a.lz;
    $("lz-window-value").textContent = win + " B"; $("lz-len-value").textContent = s.length + " B";
    const cells = $("lz-bytes"), chips = $("lz-tokens"); cells.replaceChildren(); chips.replaceChildren();
    const els = Array.from(s, (v, i) => { const e = document.createElement("span"); e.textContent = h2(v); e.title = `#${i} = ${v}`; cells.appendChild(e); return e; });
    const lits = toks.filter((t) => t.t === "l").length, ms = toks.filter((t) => t.t === "m"), cover = ms.reduce((a, t) => a + t.len, 0);
    const chipOf = (t) => { const c = document.createElement("span"); c.className = "lzchip " + t.t; c.textContent = t.t === "l" ? h2(t.v) : `⟨${t.len}, −${t.dist}⟩`; c.title = t.t === "l" ? "literal byte" : `copy ${t.len} bytes from ${t.dist} bytes back`; return c; };
    const mark = (t) => { const L = t.t === "m" ? t.len : 1; for (let k = 0; k < L; k++) els[t.at + k].classList.add(t.t === "m" ? "dst" : "lit"); };
    const note = () => { $("lz-note").textContent = `${s.length} bytes → ${toks.length} tokens: ${lits} literals + ${ms.length} matches covering ${cover} bytes (${(cover / s.length * 100).toFixed(0)}%). Wider window finds more matches; smooth filtered data has long repeats.`; renderHuff(toks); };
    if (!animate) { toks.forEach((t) => { mark(t); chips.appendChild(chipOf(t)); }); note(); return; }
    $("lz-note").textContent = "";
    (async () => {
      for (const t of toks) {
        if (tok !== P.a.lz) return;
        els[t.at].classList.add("head");
        if (t.t === "m") { for (let k = 0; k < t.len; k++) els[t.at - t.dist + k].classList.add("src"); await sleep(380); for (let k = 0; k < t.len; k++) els[t.at - t.dist + k].classList.remove("src"); }
        else await sleep(110);
        els[t.at].classList.remove("head"); mark(t); chips.appendChild(chipOf(t)); await sleep(60);
      }
      note();
    })();
  }
  function huffLens(freq) {
    const nodes = [...freq].map(([s, c]) => ({ c, s })); if (!nodes.length) return new Map(); if (nodes.length === 1) return new Map([[nodes[0].s, 1]]);
    while (nodes.length > 1) { nodes.sort((a, b) => a.c - b.c); const a = nodes.shift(), b = nodes.shift(); nodes.push({ c: a.c + b.c, l: a, r: b }); }
    const out = new Map(); (function walk(n, d) { if (n.l) { walk(n.l, d + 1); walk(n.r, d + 1); } else out.set(n.s, d); })(nodes[0], 0); return out;
  }
  function renderHuff(toks) {
    const freq = new Map(), label = new Map(); let dBits = 0;
    toks.forEach((t) => { const key = t.t === "l" ? "L" + t.v : "M" + t.len; freq.set(key, (freq.get(key) || 0) + 1); label.set(key, t.t === "l" ? `lit ${h2(t.v)}` : `len ${t.len}`); if (t.t === "m") dBits += 5 + Math.max(0, Math.floor(Math.log2(t.dist)) - 1); });
    const lens = huffLens(freq), list = [...lens].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)), codes = new Map(); let code = 0, prev = list.length ? list[0][1] : 0;
    for (const [k, l] of list) { code <<= l - prev; prev = l; codes.set(k, code.toString(2).padStart(l, "0")); code++; }
    const rows = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 12), mx = rows.length ? rows[0][1] : 1, tbl = $("png-huff"); tbl.replaceChildren();
    const head = document.createElement("div"); head.className = "huff-row head"; head.innerHTML = "<span>SYMBOL</span><span>COUNT</span><span>CODE</span>"; tbl.appendChild(head);
    rows.forEach(([k, c]) => { const d = document.createElement("div"); d.className = "huff-row"; d.innerHTML = `<span>${label.get(k)}</span><span>${c}</span><span><span class="huff-bar" style="display:block;width:${Math.max(8, 120 * c / mx)}px"></span><b>${codes.get(k)}</b></span>`; tbl.appendChild(d); });
    let bits = dBits; for (const [k, c] of freq) bits += c * lens.get(k);
    const raw = toks.reduce((a, t) => a + (t.t === "l" ? 1 : t.len), 0) * 8;
    $("hf-tag").textContent = `${freq.size} distinct symbols`; $("hf-note").textContent = `≈ ${bits} bits (symbols + ~distance bits) vs ${raw} bits raw → ${(raw / bits).toFixed(1)}× smaller on this sample.`;
  }
  function renderDeflateCompare() {
    const b = P.built, items = [["Filtered (raw)", b.stream.length, "var(--muted-foreground)"], ["Stored zlib", storedSize(b.stream.length), "#e0a020"], ["DEFLATE", b.deflateLen ?? storedSize(b.stream.length), "var(--primary)"]], mx = Math.max(...items.map((i) => i[1]));
    $("deflate-compare").replaceChildren(...items.map(([n, v, col]) => { const d = document.createElement("div"); d.className = "sb"; d.innerHTML = `<span>${n}</span><i style="width:${v / mx * 100}%;background:${col}"></i><b class="mono">${fmt(v)}</b>`; return d; }));
  }

  // ---------- step 4 ----------
  const IHDR_FIELDS = (b) => [
    ["Width", be32(b.w), `${b.w} pixels`], ["Height", be32(b.h), `${b.h} pixels`], ["Bit depth", [8], "8 bits per channel"],
    ["Color type", [2], "2 = truecolor RGB, no alpha"], ["Compression", [0], "0 = DEFLATE"], ["Filter method", [0], "0 = adaptive 5-filter"], ["Interlace", [0], "0 = none"],
  ];
  function renderIhdr(animate) {
    const b = P.built, tbl = $("ihdr-table"), tok = ++P.a.ihdr; tbl.replaceChildren();
    const rows = IHDR_FIELDS(b).map(([n, by, desc]) => { const d = document.createElement("div"); d.className = "ih-row"; d.innerHTML = `<span>${n}</span><span class="mono">${by.map(h2).join(" ")}</span><span>${desc}</span>`; return d; });
    if (!animate) { rows.forEach((r) => tbl.appendChild(r)); return; }
    (async () => { for (const r of rows) { if (tok !== P.a.ihdr) return; tbl.appendChild(r); await sleep(450); } })();
  }
  function renderCrc(animate) {
    const b = P.built, bytes = Uint8Array.from([...ascii("IHDR"), ...b.ihdr]), box = $("crc-stream"), reg = $("crc-reg"), tok = ++P.a.crc; box.replaceChildren();
    const chips = Array.from(bytes, (v, i) => { const s = document.createElement("span"); s.innerHTML = `${h2(v)}<small>${i < 4 ? "type" : "data"}</small>`; if (i < 4) s.classList.add("t"); box.appendChild(s); return s; });
    const final = crc32(bytes), stored = (b.parts[1][21] << 24 | b.parts[1][22] << 16 | b.parts[1][23] << 8 | b.parts[1][24]) >>> 0;
    if (!animate) { reg.textContent = `crc = 0x${h8(final)}   stored in file: 0x${h8(stored)} ${final === stored ? "✓" : "✗"}`; return; }
    (async () => {
      let c = 0xffffffff; reg.textContent = `register = 0x${h8(c)}`;
      for (let i = 0; i < bytes.length; i++) { if (tok !== P.a.crc) return; chips[i].classList.add("on"); const idx = (c ^ bytes[i]) & 255; c = (CRC_T[idx] ^ (c >>> 8)) >>> 0; reg.textContent = `byte ${h2(bytes[i])}: table[${h2(idx)}] ^ (reg >> 8) → register = 0x${h8(c)}`; await sleep(300); }
      c = (c ^ 0xffffffff) >>> 0; reg.textContent = `final XOR 0xFFFFFFFF → crc = 0x${h8(c)}   stored in file: 0x${h8(stored)} ${c === stored ? "✓ match" : "✗"}`;
    })();
  }
  function renderChunks() {
    const b = P.built, list = $("chunk-list"); list.replaceChildren();
    const rows = [["IHDR", b.parts[1]], ["IDAT", b.parts[2]], ["IEND", b.parts[3]]];
    rows.forEach(([name, p]) => {
      const len = (p[0] << 24 | p[1] << 16 | p[2] << 8 | p[3]) >>> 0, data = p.subarray(8, 8 + len), crc = p.subarray(8 + len), d = document.createElement("div"); d.className = "chunk-row";
      const prev = Array.from(data.subarray(0, 10), h2).join(" ") + (len > 10 ? " …" : len === 0 ? "(empty)" : "");
      d.innerHTML = `<div class="ca len"><small>length</small><b class="mono">${Array.from(p.subarray(0, 4), h2).join(" ")}</b><span>${len} B</span></div><div class="ca typ"><small>type</small><b class="mono">${Array.from(p.subarray(4, 8), h2).join(" ")}</b><span>${name}</span></div><div class="ca dat"><small>data</small><b class="mono">${prev}</b><span>${fmt(len)}</span></div><div class="ca crc"><small>crc-32</small><b class="mono">${Array.from(crc, h2).join(" ")}</b><span>${name === "IEND" ? "always AE 42 60 82" : "of type + data"}</span></div>`;
      list.appendChild(d);
    });
  }

  // ---------- step 5 ----------
  function renderSig() {
    const info = ["non-ASCII: catches 7-bit transfers", "P", "N", "G", "CR: catches DOS→Unix newline changes", "LF", "Ctrl-Z: stops old DOS `type`", "LF: catches Unix→DOS changes"];
    $("sig-row").replaceChildren(...SIG.map((v, i) => { const d = document.createElement("div"); d.className = "sig-b"; d.innerHTML = `<b class="mono">${h2(v)}</b><small>${i > 0 && i < 4 ? String.fromCharCode(v) : ""}</small><span>${info[i]}</span>`; return d; }));
  }
  const REG = [["Signature", "sg"], ["IHDR", "ih"], ["IDAT", "id"], ["IEND", "ie"]];
  function renderFile(animate) {
    const b = P.built, lay = $("png-layout"), hex = $("hexdump"), tok = ++P.a.asm; lay.replaceChildren(); hex.replaceChildren();
    const sizes = b.parts.map((p) => p.length), total = b.png.length;
    const segs = REG.map(([n, cls], i) => { const d = document.createElement("div"); d.className = "file-seg " + cls; d.style.flex = `${Math.max(sizes[i] / total, 0.05)} 0 0`; d.innerHTML = `<span>${n}<small>${fmt(sizes[i])}</small></span>`; return d; });
    const N = Math.min(112, total), cells = [];
    for (let i = 0; i < N; i++) { const r = b.offs.findLastIndex((o) => i >= o), s = document.createElement("span"); s.className = "hx " + REG[r][1]; s.textContent = h2(b.png[i]); cells.push([s, r]); hex.appendChild(s); }
    const note = () => { $("png-file-note").textContent = `${total} bytes = 8 (signature) + ${sizes[1]} (IHDR) + ${sizes[2]} (IDAT = 12 + ${b.idat.length} zlib bytes) + ${sizes[3]} (IEND). Showing the first ${N} bytes.`; };
    if (!animate) { segs.forEach((s) => lay.appendChild(s)); note(); return; }
    $("png-file-note").textContent = "";
    cells.forEach(([s]) => (s.style.opacity = 0));
    (async () => { for (let r = 0; r < 4; r++) { if (tok !== P.a.asm) return; lay.appendChild(segs[r]); for (const [s, rr] of cells) if (rr === r) { s.style.opacity = 1; s.classList.add("pop"); await sleep(12); } await sleep(450); } note(); })();
  }
  async function verify() {
    const b = P.built, tok = P.tok; if (P.url) URL.revokeObjectURL(P.url);
    const blob = new Blob([b.png], { type: "image/png" }); P.url = URL.createObjectURL(blob);
    $("png-real").src = P.url; $("png-download").href = P.url; $("png-verify").textContent = "Decoding…";
    try {
      const bm = await createImageBitmap(blob); if (tok !== P.tok) return;
      const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height; const x = c.getContext("2d"); x.drawImage(bm, 0, 0);
      const d = x.getImageData(0, 0, bm.width, bm.height).data; let bad = 0;
      if (bm.width !== b.w || bm.height !== b.h) bad = -1; else for (let i = 0, j = 0; i < d.length; i += 4) for (let ch = 0; ch < 3; ch++) if (d[i + ch] !== b.rgb[j++]) bad++;
      $("png-verify").textContent = bad === 0 ? `✓ ${bm.width}×${bm.height} decoded by the browser. All ${b.w * b.h * 3} channel values identical to the input: lossless.` : bad < 0 ? "✗ size mismatch" : `✗ ${bad} values differ`;
      $("png-verify-tag").textContent = bad === 0 ? "LOSSLESS ✓" : "MISMATCH";
    } catch (e) { $("png-verify").textContent = "Browser could not decode the PNG: " + e; }
  }

  // ---------- binding ----------
  function bind() {
    const root = $("png-root"); if (!root || root.dataset.bound) return; root.dataset.bound = "1";
    P.mode = "auto"; P.comp = "deflate"; P.res = 128; P.bits = 8; P.cropSet = false; P.row = 0; P.k = 0; Object.keys(P.a).forEach((k) => P.a[k]++);
    const tog = (sel, attr, val) => root.querySelectorAll(sel).forEach((b) => b.classList.toggle("selected", b.dataset[attr] === val));
    root.querySelectorAll("[data-pfilter]").forEach((b) => b.addEventListener("click", () => { P.mode = b.dataset.pfilter; tog("[data-pfilter]", "pfilter", P.mode); schedule(); }));
    root.querySelectorAll("[data-pcomp]").forEach((b) => b.addEventListener("click", () => { P.comp = b.dataset.pcomp; tog("[data-pcomp]", "pcomp", P.comp); schedule(); }));
    root.querySelectorAll("[data-pres]").forEach((b) => b.addEventListener("click", () => { P.res = +b.dataset.pres; tog("[data-pres]", "pres", String(P.res)); P.cropSet = false; schedule(); }));
    $("p-bits").addEventListener("input", (e) => { P.bits = +e.target.value; $("p-bits-value").textContent = P.bits; schedule(); });
    $("png-src").addEventListener("click", (e) => {
      if (!P.built) return; const r = e.currentTarget.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * P.built.w), y = Math.floor((e.clientY - r.top) / r.height * P.built.h);
      P.crop = { x: clamp(x - 3, 0, P.built.w - CW), y: clamp(y - 2, 0, P.built.h - CH) }; P.cropSet = true; P.row = 0; P.k = 0;
      renderSrc(); renderScan(); renderFilter(); renderAdler(false); renderLz(false);
    });
    $("scan-play").addEventListener("click", playScan); $("filt-play").addEventListener("click", playFilter); $("filter-compare-run").addEventListener("click", compareFilters);
    $("adler-play").addEventListener("click", () => renderAdler(true)); $("lz-play").addEventListener("click", () => renderLz(true));
    $("lz-window").addEventListener("input", () => renderLz(false)); $("lz-len").addEventListener("input", () => renderLz(false));
    $("ihdr-play").addEventListener("click", () => renderIhdr(true)); $("crc-play").addEventListener("click", () => renderCrc(true)); $("asm-play").addEventListener("click", () => renderFile(true));
    window.addEventListener("lab-image", () => { P.cropSet = false; schedule(); });
    if (window.__labImage) schedule();
  }
  let tries = 0;
  window.initPngLab = () => { if ($("png-root")) bind(); else if (tries++ < 300) requestAnimationFrame(window.initPngLab); };
  window.initPngLab();
})();
