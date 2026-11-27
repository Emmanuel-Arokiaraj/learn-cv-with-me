(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const h2 = (v) => (v & 255).toString(16).padStart(2, "0").toUpperCase();
  const fmt = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : Math.round(n) + " B");
  const C16 = "#2f9e6b", C8 = "#3b6fd8", C4 = "#e0902a";

  // =====================================================================
  //  H.264 core: integer transform, quantization
  // =====================================================================
  const ZZ4 = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
  const MF = [[13107, 5243, 8066], [11916, 4660, 7490], [10082, 4194, 6554], [9362, 3647, 5825], [8192, 3355, 5243], [7282, 2893, 4559]];
  const VV = [[10, 16, 13], [11, 18, 14], [13, 20, 16], [14, 23, 18], [16, 25, 20], [18, 29, 23]];
  const CLS = Array.from({ length: 16 }, (_, k) => { const i = k >> 2, j = k & 3; return i % 2 === 0 && j % 2 === 0 ? 0 : i % 2 === 1 && j % 2 === 1 ? 1 : 2; });
  const qstep = (qp) => 0.625 * 2 ** (qp / 6);

  function fwd4(X) { // W = Cf X Cf^T
    const t = new Int32Array(16), w = new Int32Array(16);
    for (let r = 0; r < 4; r++) { const a = X[r * 4], b = X[r * 4 + 1], c = X[r * 4 + 2], d = X[r * 4 + 3]; t[r * 4] = a + b + c + d; t[r * 4 + 1] = 2 * a + b - c - 2 * d; t[r * 4 + 2] = a - b - c + d; t[r * 4 + 3] = a - 2 * b + 2 * c - d; }
    for (let c = 0; c < 4; c++) { const a = t[c], b = t[4 + c], cc = t[8 + c], d = t[12 + c]; w[c] = a + b + cc + d; w[4 + c] = 2 * a + b - cc - 2 * d; w[8 + c] = a - b - cc + d; w[12 + c] = a - 2 * b + 2 * cc - d; }
    return w;
  }
  function quant4(W, qp, intra) {
    const qb = 15 + ((qp / 6) | 0), f = ((1 << qb) / (intra ? 3 : 6)) | 0, Z = new Int32Array(16), mf = MF[qp % 6];
    for (let k = 0; k < 16; k++) { const a = Math.abs(W[k]); Z[k] = (W[k] < 0 ? -1 : 1) * ((a * mf[CLS[k]] + f) >> qb); }
    return Z;
  }
  function dequant4(Z, qp) { const D = new Int32Array(16), v = VV[qp % 6], s = 1 << ((qp / 6) | 0); for (let k = 0; k < 16; k++) D[k] = Z[k] * v[CLS[k]] * s; return D; }
  function inv4(D) {
    const t = new Int32Array(16), r = new Int32Array(16);
    for (let i = 0; i < 4; i++) { const d0 = D[i * 4], d1 = D[i * 4 + 1], d2 = D[i * 4 + 2], d3 = D[i * 4 + 3]; const e0 = d0 + d2, e1 = d0 - d2, e2 = (d1 >> 1) - d3, e3 = d1 + (d3 >> 1); t[i * 4] = e0 + e3; t[i * 4 + 1] = e1 + e2; t[i * 4 + 2] = e1 - e2; t[i * 4 + 3] = e0 - e3; }
    for (let c = 0; c < 4; c++) { const d0 = t[c], d1 = t[4 + c], d2 = t[8 + c], d3 = t[12 + c]; const e0 = d0 + d2, e1 = d0 - d2, e2 = (d1 >> 1) - d3, e3 = d1 + (d3 >> 1); r[c] = (e0 + e3 + 32) >> 6; r[4 + c] = (e1 + e2 + 32) >> 6; r[8 + c] = (e1 - e2 + 32) >> 6; r[12 + c] = (e0 - e3 + 32) >> 6; }
    return r;
  }
  function roundTrip4(X, qp, intra) { const W = fwd4(X), Z = quant4(W, qp, intra), D = dequant4(Z, qp), R = inv4(D); return { W, Z, D, R }; }

  // =====================================================================
  //  Entropy-coder cost models (CAVLC and CABAC, simplified)
  // =====================================================================
  const ueLen = (k) => 2 * Math.floor(Math.log2(k + 1)) + 1;
  const seLen = (v) => ueLen(v > 0 ? 2 * v - 1 : -2 * v);
  const egk = (v, k) => 2 * Math.floor(Math.log2((v >> k) + 1)) + 1 + k;
  const CT = [[1], [6, 2], [8, 6, 3], [9, 8, 7, 5], [10, 9, 8, 6], [11, 10, 9, 7], [13, 11, 10, 8], [13, 13, 11, 9], [13, 13, 13, 10], [14, 14, 13, 11], [14, 14, 14, 13], [15, 15, 14, 14], [15, 15, 15, 14], [16, 15, 15, 15], [16, 16, 16, 15], [16, 16, 16, 16], [16, 16, 16, 16]];

  function cavlcExplain(zz) { // returns {rows:[{label,detail,bits}], bits}
    const nz = []; for (let k = 0; k < 16; k++) if (zz[k]) nz.push(k);
    const T = nz.length; if (!T) return { rows: [{ label: "coeff_token", detail: "TotalCoeff = 0", bits: 1 }], bits: 1 };
    let t1 = 0; for (let i = T - 1; i >= 0 && t1 < 3; i--) { if (Math.abs(zz[nz[i]]) === 1) t1++; else break; }
    const rows = [{ label: "coeff_token", detail: `TotalCoeff ${T}, TrailingOnes ${t1}`, bits: CT[T][Math.min(t1, CT[T].length - 1)] }];
    if (t1) rows.push({ label: "trailing-one signs", detail: `${t1} sign bit${t1 > 1 ? "s" : ""}`, bits: t1 });
    let sl = T > 10 && t1 < 3 ? 1 : 0;
    for (let i = T - 1 - t1; i >= 0; i--) {
      const l = zz[nz[i]]; let code = l > 0 ? 2 * l - 2 : -2 * l - 1; if (i === T - 1 - t1 && t1 < 3) code = Math.max(0, code - 2);
      rows.push({ label: "level", detail: `${l > 0 ? "+" : ""}${l} (suffixLength ${sl})`, bits: (code >> sl) + 1 + sl });
      if (sl === 0) sl = 1; if (Math.abs(l) > (3 << (sl - 1)) && sl < 6) sl++;
    }
    const tz = nz[T - 1] + 1 - T;
    if (T < 16) rows.push({ label: "total_zeros", detail: `${tz} zero${tz === 1 ? "" : "s"} before last level`, bits: Math.min(9, 1 + Math.ceil(Math.log2(17 - T))) });
    let zl = tz;
    for (let i = T - 1; i > 0 && zl > 0; i--) {
      const run = nz[i] - nz[i - 1] - 1, b = zl <= 1 ? 1 : zl <= 2 ? (run === 0 ? 1 : 2) : zl <= 6 ? Math.ceil(Math.log2(zl + 1)) : run < 7 ? 3 : run - 3;
      rows.push({ label: "run_before", detail: `run ${run}, zerosLeft ${zl}`, bits: b }); zl -= run;
    }
    return { rows, bits: rows.reduce((a, r) => a + r.bits, 0) };
  }
  const cavlcBits = (zz) => cavlcExplain(zz).bits;

  const mkCtx = () => [1, 1];
  const mkSet = () => ({ cbf: mkCtx(), sig: Array.from({ length: 15 }, mkCtx), last: Array.from({ length: 15 }, mkCtx), g1: Array.from({ length: 5 }, mkCtx), g2: Array.from({ length: 5 }, mkCtx) });
  const mkCabac = () => ({ Y: mkSet(), C: mkSet(), skip: mkCtx(), intra: mkCtx(), pt0: mkCtx(), pt1: mkCtx(), itype: mkCtx(), im0: mkCtx(), im1: mkCtx(), cbp: mkCtx(), mvx: Array.from({ length: 6 }, mkCtx), mvy: Array.from({ length: 6 }, mkCtx) });
  function binCost(c, bit) { const p1 = c[1] / (c[0] + c[1]), b = -Math.log2(bit ? p1 : 1 - p1); c[bit]++; if (c[0] + c[1] > 128) { c[0] *= 0.5; c[1] *= 0.5; } return b; }
  function cabacBlock(cx, zz, rec) {
    let cost = 0;
    const B = (c, bit, name) => { const p1 = c[1] / (c[0] + c[1]), b = -Math.log2(bit ? p1 : 1 - p1); if (rec) rec.push({ name, bit, p1, bits: b }); c[bit]++; if (c[0] + c[1] > 128) { c[0] *= 0.5; c[1] *= 0.5; } cost += b; };
    const BY = (bits, name) => { cost += bits; if (rec) rec.push({ name, bit: "·", p1: 0.5, bits, bypass: true }); };
    const nz = zz.some((v) => v !== 0);
    B(cx.cbf, nz ? 1 : 0, "coded_block_flag"); if (!nz) return cost;
    let last = 15; while (zz[last] === 0) last--;
    for (let k = 0; k < 15; k++) { B(cx.sig[k], zz[k] !== 0 ? 1 : 0, `significant[${k}]`); if (zz[k] !== 0) { B(cx.last[k], k === last ? 1 : 0, `last[${k}]`); if (k === last) break; } }
    let eq1 = 0, gt1 = 0;
    for (let k = last; k >= 0; k--) {
      const v = zz[k]; if (!v) continue; const a = Math.abs(v) - 1;
      B(cx.g1[gt1 > 0 ? 0 : Math.min(4, 1 + eq1)], a > 0 ? 1 : 0, `level[${k}] > 1`);
      if (a > 0) { const c2 = cx.g2[Math.min(4, gt1)], pre = Math.min(a - 1, 13); for (let t = 0; t < pre; t++) B(c2, 1, `level[${k}] > ${t + 2}`); if (a - 1 < 14) B(c2, 0, `level[${k}] = ${a + 1}`); else BY(egk(a - 14, 0), "escape EG0"); gt1++; } else eq1++;
      BY(1, `sign[${k}]`);
    }
    return cost;
  }
  function mvdCostCabac(ctx, v) { const a = Math.abs(v); let c = 0; for (let k = 0; k < Math.min(a, 9); k++) c += binCost(ctx[Math.min(k, 5)], 1); if (a < 9) c += binCost(ctx[Math.min(a, 5)], 0); else c += egk(a - 9, 3); if (a) c += 1; return c; }

  // =====================================================================
  //  Intra prediction, motion search, deblocking
  // =====================================================================
  function intraPredict(n, mode, top, left, hasTop, hasLeft) {
    const p = new Int16Array(n * n);
    if (mode === 0) { if (!hasTop) return null; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) p[y * n + x] = top[x]; }
    else if (mode === 1) { if (!hasLeft) return null; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) p[y * n + x] = left[y]; }
    else if (mode === 2) { let s = 0, c = 0; if (hasTop) { for (let i = 0; i < n; i++) s += top[i]; c += n; } if (hasLeft) { for (let i = 0; i < n; i++) s += left[i]; c += n; } p.fill(c ? ((s + (c >> 1)) / c) | 0 : 128); }
    else { if (!hasTop || n !== 4) return null; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const i = x + y; p[y * 4 + x] = (top[Math.min(i, 7)] + 2 * top[Math.min(i + 1, 7)] + top[Math.min(i + 2, 7)] + 2) >> 2; } }
    return p;
  }
  const MODE_NAMES = ["Vertical", "Horizontal", "DC", "Diagonal ↙"];
  function neighbors(rec, W, x, y, n, aboveRight) {
    const top = new Int16Array(2 * n), left = new Int16Array(n);
    if (y > 0) for (let k = 0; k < 2 * n; k++) top[k] = k < n || aboveRight ? rec[(y - 1) * W + Math.min(x + k, W - 1)] : rec[(y - 1) * W + Math.min(x + n - 1, W - 1)];
    if (x > 0) for (let j = 0; j < n; j++) left[j] = rec[(y + j) * W + x - 1];
    return { top, left, hasTop: y > 0, hasLeft: x > 0 };
  }
  function sadAt(cur, W, H, x, y, ref, rx, ry, n, limit) {
    let s = 0;
    for (let j = 0; j < n; j++) { const yy = clamp(ry + j, 0, H - 1) * W, co = (y + j) * W + x; for (let i = 0; i < n; i++) { s += Math.abs(cur[co + i] - ref[yy + clamp(rx + i, 0, W - 1)]); } if (s > limit) return s; }
    return s;
  }
  function searchMV(cur, ref, W, H, x, y, n, cx, cy, R) {
    let best = { mvx: cx, mvy: cy, sad: Infinity, score: Infinity };
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const mx = cx + dx, my = cy + dy, pen = (Math.abs(mx) + Math.abs(my)) * 2, s = sadAt(cur, W, H, x, y, ref, x + mx, y + my, n, best.score - pen);
      if (s + pen < best.score) best = { mvx: mx, mvy: my, sad: s, score: s + pen };
    }
    return best;
  }
  function motionComp(ref, W, H, x, y, n, mvx, mvy) {
    const p = new Int16Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) p[j * n + i] = ref[clamp(y + mvy + j, 0, H - 1) * W + clamp(x + mvx + i, 0, W - 1)];
    return p;
  }
  const activity = (pl, W, x, y, n) => { let s = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) s += pl[(y + j) * W + x + i]; const m = s / (n * n); let a = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a += Math.abs(pl[(y + j) * W + x + i] - m); return a / (n * n); };

  function interParts(cur, ref, W, H, x0, y0, R, split) {
    const s = split / 100, g16 = (1 - s) * 400, g8 = (1 - s) * 150;
    const m16 = searchMV(cur, ref, W, H, x0, y0, 16, 0, 0, R), q = [];
    let sum8 = 0;
    for (let k = 0; k < 4; k++) { const bx = x0 + (k & 1) * 8, by = y0 + (k >> 1) * 8, m = searchMV(cur, ref, W, H, bx, by, 8, m16.mvx, m16.mvy, 3); q.push({ ...m, x: bx, y: by, n: 8 }); sum8 += m.sad; }
    if (m16.sad - sum8 <= g16) return { parts: [{ x: x0, y: y0, n: 16, mvx: m16.mvx, mvy: m16.mvy }], sad: m16.sad };
    const parts = []; let total = 0;
    for (const p of q) {
      const sub = []; let s4 = 0;
      for (let k = 0; k < 4; k++) { const bx = p.x + (k & 1) * 4, by = p.y + (k >> 1) * 4, m = searchMV(cur, ref, W, H, bx, by, 4, p.mvx, p.mvy, 2); sub.push({ x: bx, y: by, n: 4, mvx: m.mvx, mvy: m.mvy }); s4 += m.sad; }
      if (p.sad - s4 > g8) { parts.push(...sub); total += s4; } else { parts.push({ x: p.x, y: p.y, n: 8, mvx: p.mvx, mvy: p.mvy }); total += p.sad; }
    }
    return { parts, sad: total };
  }
  function intraParts(cur, W, x0, y0, split) {
    const t = (1 - split / 100) * 12 + 2;
    if (activity(cur, W, x0, y0, 16) <= t) return [{ x: x0, y: y0, n: 16, mvx: 0, mvy: 0 }];
    const parts = [];
    for (let k = 0; k < 4; k++) {
      const bx = x0 + (k & 1) * 8, by = y0 + (k >> 1) * 8;
      if (activity(cur, W, bx, by, 8) <= t * 0.9) parts.push({ x: bx, y: by, n: 8, mvx: 0, mvy: 0 });
      else for (let j = 0; j < 4; j++) parts.push({ x: bx + (j & 1) * 4, y: by + (j >> 1) * 4, n: 4, mvx: 0, mvy: 0 });
    }
    return parts;
  }

  const ALPHA = [...Array(16).fill(0), 4, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 17, 20, 22, 25, 28, 32, 36, 40, 45, 50, 56, 63, 71, 80, 90, 101, 113, 127, 144, 162, 182, 203, 226, 255, 255];
  const BETA = [...Array(16).fill(0), 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18];
  const TC_BASE = [0, 13, 17, 25];
  const tc0Of = (bS, idx) => (idx < 17 ? 0 : Math.round(TC_BASE[bS] * 2 ** ((idx - 51) / 6)));
  const clip3 = (lo, hi, v) => (v < lo ? lo : v > hi ? hi : v);
  function filterLine(px, bS, qp, ofs) {
    const idx = clamp(qp + ofs, 0, 51), alpha = ALPHA[idx], beta = BETA[idx], [p3, p2, p1, p0, q0, q1, q2, q3] = px; void p3; void q3;
    const info = { px: px.slice(), on: false, alpha, beta, tc: 0, tc0: 0, delta: 0, bS, idx };
    if (!(bS > 0 && Math.abs(p0 - q0) < alpha && Math.abs(p1 - p0) < beta && Math.abs(q1 - q0) < beta)) return info;
    const tc0 = tc0Of(bS, idx), ap = Math.abs(p2 - p0), aq = Math.abs(q2 - q0), tc = tc0 + (ap < beta ? 1 : 0) + (aq < beta ? 1 : 0), delta = clip3(-tc, tc, (((q0 - p0) << 2) + (p1 - q1) + 4) >> 3);
    info.on = true; info.tc = tc; info.tc0 = tc0; info.delta = delta; info.px[3] = clamp(p0 + delta, 0, 255); info.px[4] = clamp(q0 - delta, 0, 255);
    if (ap < beta) info.px[2] = p1 + clip3(-tc0, tc0, (p2 + ((p0 + q0 + 1) >> 1) - (p1 << 1)) >> 1);
    if (aq < beta) info.px[5] = q1 + clip3(-tc0, tc0, (q2 + ((p0 + q0 + 1) >> 1) - (q1 << 1)) >> 1);
    return info;
  }
  const bsOf = (F, a, b) => (F.bIntra[a] || F.bIntra[b] ? 3 : F.bNz[a] || F.bNz[b] ? 2 : Math.abs(F.bMvx[a] - F.bMvx[b]) >= 1 || Math.abs(F.bMvy[a] - F.bMvy[b]) >= 1 ? 1 : 0);
  function deblockLuma(F, Ypre, W, H, qp, ofs) {
    const Y = Uint8ClampedArray.from(Ypre), bw = W / 4; let lines = 0, filtered = 0;
    const px = new Array(8);
    for (let y = 0; y < H; y++) for (let x = 4; x < W; x += 4) {
      const bS = bsOf(F, (y >> 2) * bw + ((x - 1) >> 2), (y >> 2) * bw + (x >> 2)); if (!bS) continue; lines++;
      for (let k = 0; k < 8; k++) px[k] = Y[y * W + x - 4 + k];
      const r = filterLine(px, bS, qp, ofs); if (r.on) { filtered++; for (let k = 1; k < 7; k++) Y[y * W + x - 4 + k] = r.px[k]; }
    }
    for (let x = 0; x < W; x++) for (let y = 4; y < H; y += 4) {
      const bS = bsOf(F, ((y - 1) >> 2) * bw + (x >> 2), (y >> 2) * bw + (x >> 2)); if (!bS) continue; lines++;
      for (let k = 0; k < 8; k++) px[k] = Y[(y - 4 + k) * W + x];
      const r = filterLine(px, bS, qp, ofs); if (r.on) { filtered++; for (let k = 1; k < 7; k++) Y[(y - 4 + k) * W + x] = r.px[k]; }
    }
    return { Y, lines, filtered };
  }

  // =====================================================================
  //  Encoder
  // =====================================================================
  function planesOf(rgba, W, H, sx, sy) {
    const n = W * H, Y = new Uint8ClampedArray(n), fcb = new Float32Array(n), fcr = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]; Y[i] = 0.299 * r + 0.587 * g + 0.114 * b; fcb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b; fcr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b; }
    const cw = W / sx, ch = H / sy, Cb = new Uint8ClampedArray(cw * ch), Cr = new Uint8ClampedArray(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { let a = 0, b = 0; for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) { const k = (y * sy + j) * W + x * sx + i; a += fcb[k]; b += fcr[k]; } Cb[y * cw + x] = a / (sx * sy); Cr[y * cw + x] = b / (sx * sy); }
    return { Y, Cb, Cr, fcb, fcr };
  }

  function createEncoder(cfg) {
    const { W, H, sx, sy, qp, gop, range, split, deblock, dbofs } = cfg, MBW = W / 16, MBH = H / 16, bw = W / 4, NB4 = bw * (H / 4), cw = W / sx, ch = H / sy;
    let ref = null;
    function code4(origP, recP, PW, x, y, pred16, intra) {
      const X = new Int32Array(16); for (let k = 0; k < 16; k++) X[k] = origP[(y + (k >> 2)) * PW + x + (k & 3)] - pred16[k];
      const r = roundTrip4(X, qp, intra);
      for (let k = 0; k < 16; k++) recP[(y + (k >> 2)) * PW + x + (k & 3)] = pred16[k] + r.R[k];
      return r.Z;
    }
    function encodeFrame(fi, orig) {
      const type = fi % gop === 0 || !ref ? "I" : "P", bwY = W;
      const rec = { Y: new Uint8ClampedArray(W * H), Cb: new Uint8ClampedArray(cw * ch), Cr: new Uint8ClampedArray(cw * ch) };
      const pred = new Uint8ClampedArray(W * H), resid = new Int16Array(W * H), Zs = new Int16Array(NB4 * 16);
      const bIntra = new Uint8Array(NB4), bNz = new Uint8Array(NB4), bMvx = new Int16Array(NB4), bMvy = new Int16Array(NB4), order = [], mbs = [];
      const bits = { cavlc: { hdr: 40, mv: 0, res: 0 }, cabac: { hdr: 40, mv: 0, res: 0 } }, cab = mkCabac();
      let lastMv = [0, 0];
      for (let mby = 0; mby < MBH; mby++) for (let mbx = 0; mbx < MBW; mbx++) {
        const x0 = mbx * 16, y0 = mby * 16; let intra = type === "I", parts, interSad = 0;
        if (!intra) { const r = interParts(orig.Y, ref.Y, W, H, x0, y0, range, split); parts = r.parts; interSad = r.sad; if (interSad > activity(orig.Y, W, x0, y0, 16) * 180 + 150) intra = true; }
        if (intra) parts = intraParts(orig.Y, W, x0, y0, split);
        let mbNz = false, modeBits = 0; const lumaList = [], chromaList = [];
        for (const p of parts) {
          let pb;
          if (intra) {
            const aboveRight = p.n === 4 && p.y % 16 === 0, nb = neighbors(rec.Y, W, p.x, p.y, p.n, aboveRight); let best = null;
            for (const mode of [2, 0, 1, 3]) {
              const pr = intraPredict(p.n, mode, nb.top, nb.left, nb.hasTop, nb.hasLeft); if (!pr) continue;
              let s = 0; for (let j = 0; j < p.n; j++) for (let i = 0; i < p.n; i++) s += Math.abs(orig.Y[(p.y + j) * W + p.x + i] - pr[j * p.n + i]);
              if (!best || s < best.s) best = { s, pr, mode };
            }
            pb = best.pr; p.mode = best.mode; modeBits += p.n === 4 ? 3 : 2;
          } else pb = motionComp(ref.Y, W, H, p.x, p.y, p.n, p.mvx, p.mvy);
          for (let by = 0; by < p.n; by += 4) for (let bx = 0; bx < p.n; bx += 4) {
            const p16 = new Int16Array(16); for (let k = 0; k < 16; k++) p16[k] = pb[(by + (k >> 2)) * p.n + bx + (k & 3)];
            const x = p.x + bx, y = p.y + by, Z = code4(orig.Y, rec.Y, W, x, y, p16, intra), bi = (y >> 2) * bw + (x >> 2);
            for (let k = 0; k < 16; k++) { Zs[bi * 16 + k] = Z[k]; pred[(y + (k >> 2)) * bwY + x + (k & 3)] = p16[k]; resid[(y + (k >> 2)) * bwY + x + (k & 3)] = orig.Y[(y + (k >> 2)) * W + x + (k & 3)] - p16[k]; }
            const nz = Z.some((v) => v), zz = ZZ4.map((k) => Z[k]); bIntra[bi] = intra ? 1 : 0; bNz[bi] = nz ? 1 : 0; bMvx[bi] = p.mvx; bMvy[bi] = p.mvy; if (nz) mbNz = true;
            lumaList.push({ bi, zz, grp: (((y - y0) >> 3) << 1) | ((x - x0) >> 3) });
          }
        }
        // chroma
        const cmb = [16 / sx, 16 / sy];
        for (const [name, op] of [["Cb", orig.Cb], ["Cr", orig.Cr]]) for (let by = 0; by < cmb[1]; by += 4) for (let bx = 0; bx < cmb[0]; bx += 4) {
          const cx = mbx * cmb[0] + bx, cy = mby * cmb[1] + by; let p16 = new Int16Array(16);
          if (intra) { const nb = neighbors(rec[name], cw, cx, cy, 4, false), pr = intraPredict(4, 2, nb.top, nb.left, nb.hasTop, nb.hasLeft); p16 = pr; }
          else { const bi = (((cy * sy) >> 2) * bw) + ((cx * sx) >> 2), mx = Math.trunc(bMvx[bi] / sx), my = Math.trunc(bMvy[bi] / sy); p16 = motionComp(ref[name], cw, ch, cx, cy, 4, mx, my); }
          const Z = code4(op, rec[name], cw, cx, cy, p16, intra); if (Z.some((v) => v)) mbNz = true;
          chromaList.push(ZZ4.map((k) => Z[k]));
        }
        // residual bits: coded_block_pattern gates whole 8x8 luma groups and the chroma set
        const gnz = [0, 0, 0, 0]; lumaList.forEach((b) => { if (b.zz.some((v) => v)) gnz[b.grp] = 1; });
        for (let g = 0; g < 4; g++) bits.cabac.res += binCost(cab.cbp, gnz[g]);
        for (const b of lumaList) if (gnz[b.grp]) { bits.cavlc.res += cavlcBits(b.zz); bits.cabac.res += cabacBlock(cab.Y, b.zz); order.push(b.bi); }
        const cnz = chromaList.some((zz) => zz.some((v) => v)); bits.cabac.res += binCost(cab.cbp, cnz ? 1 : 0);
        if (cnz) for (const zz of chromaList) { bits.cavlc.res += cavlcBits(zz); bits.cabac.res += cabacBlock(cab.C, zz); }
        // header + MV bits
        const small = parts.some((p) => p.n < 16), quarter = parts.some((p) => p.n === 4), skip = !intra && parts.length === 1 && parts[0].mvx === lastMv[0] && parts[0].mvy === lastMv[1] && !mbNz;
        if (type === "P") { bits.cabac.hdr += binCost(cab.skip, skip ? 1 : 0); if (skip) bits.cavlc.hdr += 1; }
        if (!skip) {
          let cv = 0; if (intra) cv = (parts.length === 1 ? 3 : 1) + modeBits + (type === "P" ? 5 : 0); else cv = ueLen(parts.length === 1 ? 0 : 3) + (small ? 4 * (quarter ? 3 : 1) : 0);
          cv += mbNz ? 5 + 1 : 1; bits.cavlc.hdr += cv;
          let cc = 0; if (type === "P") cc += binCost(cab.intra, intra ? 1 : 0);
          if (intra) { cc += binCost(cab.itype, parts.length === 1 ? 1 : 0); cc += modeBits * 0.6; } else { cc += binCost(cab.pt0, small ? 1 : 0); if (small) cc += binCost(cab.pt1, quarter ? 1 : 0); }
          cc += binCost(cab.cbp, mbNz ? 1 : 0) + (mbNz ? 1.2 : 0); bits.cabac.hdr += cc;
        }
        if (!intra && !skip) for (const p of parts) { const dx = p.mvx - lastMv[0], dy = p.mvy - lastMv[1]; bits.cavlc.mv += seLen(dx) + seLen(dy); bits.cabac.mv += mvdCostCabac(cab.mvx, dx) + mvdCostCabac(cab.mvy, dy); lastMv = [p.mvx, p.mvy]; }
        mbs.push({ x: mbx, y: mby, intra, parts, skip, nz: mbNz });
      }
      const fr = { type, qp, orig, pre: rec, pred, resid, Zs, bIntra, bNz, bMvx, bMvy, order, mbs, bits };
      const db = deblock ? deblockLuma(fr, rec.Y, W, H, qp, dbofs) : { Y: Uint8ClampedArray.from(rec.Y), lines: 0, filtered: 0 };
      fr.rec = { Y: db.Y, Cb: rec.Cb, Cr: rec.Cr }; fr.db = { lines: db.lines, filtered: db.filtered };
      let se = 0, sep = 0; for (let i = 0; i < W * H; i++) { const d = orig.Y[i] - fr.rec.Y[i], e = orig.Y[i] - rec.Y[i]; se += d * d; sep += e * e; }
      fr.psnr = se ? 10 * Math.log10((255 * 255 * W * H) / se) : 99; fr.psnrPre = sep ? 10 * Math.log10((255 * 255 * W * H) / sep) : 99;
      ref = fr.rec; return fr;
    }
    return { encodeFrame };
  }
  const frameBits = (fr, mode) => { const b = fr.bits[mode]; return b.hdr + b.mv + b.res; };
  const frameBytes = (fr, mode) => Math.ceil(frameBits(fr, mode) / 8) + 6;

  window.__h264 = { fwd4, quant4, dequant4, inv4, roundTrip4, createEncoder, planesOf, cavlcBits, cabacBlock, mkSet, filterLine, qstep };
  if (typeof document === "undefined" || !document.getElementById) return;

  // =====================================================================
  //  UI state
  // =====================================================================
  const S = { raw: [], W: 0, H: 0, N: 0, fps: 10, sub: "420", qp: 28, gop: 10, range: 8, split: 50, deblock: true, dbofs: 0, ent: "cabac", F: 0, mb: { x: 0, y: 0 }, blk: 0, enc: null, planes: [], token: 0, view: "orig", playing: false, timer: 0, edge: null, avg: null, nalfmt: "annexb", cont: "mp4", a: {}, busy: false, bound: false, raf: 0 };
  const sx = () => (S.sub === "444" ? 1 : 2), sy = () => (S.sub === "420" ? 2 : 1);
  const bump = (k) => (S.a[k] = (S.a[k] || 0) + 1);
  const FR = () => S.enc && S.enc.frames[S.F];

  function blit(canvas, rgba, w, h) { canvas.width = w; canvas.height = h; canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0); }
  function yccRgba(Y, Cb, Cr, W, H) {
    const out = new Uint8ClampedArray(W * H * 4), cw = W / sx(), a = sx(), b = sy();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, ci = ((y / b) | 0) * cw + ((x / a) | 0), yy = Y[i], cb = Cb[ci] - 128, cr = Cr[ci] - 128; out[i * 4] = yy + 1.402 * cr; out[i * 4 + 1] = yy - 0.344136 * cb - 0.714136 * cr; out[i * 4 + 2] = yy + 1.772 * cb; out[i * 4 + 3] = 255; }
    return out;
  }
  const grayRgba = (pl, W, H, f = (v) => v) => { const o = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { const v = f(pl[i]); o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = 255; } return o; };
  function zoomDraw(canvas, rgba, W, x0, y0, size, scale) {
    const t = document.createElement("canvas"); t.width = t.height = size; const tx = t.getContext("2d"), img = tx.createImageData(size, size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const s = ((y0 + j) * W + x0 + i) * 4, d = (j * size + i) * 4; img.data[d] = rgba[s]; img.data[d + 1] = rgba[s + 1]; img.data[d + 2] = rgba[s + 2]; img.data[d + 3] = 255; }
    tx.putImageData(img, 0, 0); canvas.width = canvas.height = size * scale; const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(t, 0, 0, size * scale, size * scale);
  }
  const msg = (t, bad) => { const m = $("vid-msg"); m.textContent = t; m.className = "vid-msg" + (bad ? " bad" : t ? " ok" : ""); };
  const setBar = (f) => { $("vid-bar").style.width = `${clamp(f, 0, 1) * 100}%`; };
  const heat = (v, max) => { const t = clamp(v / (max || 1), -1, 1), a = Math.abs(t) ** 0.6; return t >= 0 ? `color-mix(in oklab, var(--cb-col) ${Math.round(a * 60)}%, var(--secondary))` : `color-mix(in oklab, var(--cr-col) ${Math.round(a * 60)}%, var(--secondary))`; };
  const mxFill = (el, vals, bg, fmtv = (v) => v) => { el.replaceChildren(...Array.from(vals, (v, i) => { const s = document.createElement("span"); s.textContent = fmtv(v); if (bg) s.style.background = bg(v, i); return s; })); return Array.from(el.children); };

  // =====================================================================
  //  Loading video / sample
  // =====================================================================
  function setFrames(frames, W, H, fps, label) {
    S.raw = frames; S.W = W; S.H = H; S.N = frames.length; S.fps = fps; S.F = Math.min(1, S.N - 1);
    S.mb = { x: Math.floor(W / 32), y: Math.floor(H / 32) }; S.blk = 5; S.edge = null; S.avg = null;
    $("h-gop").max = String(Math.max(1, S.N)); if (S.gop > S.N) { S.gop = Math.max(1, Math.min(10, S.N)); $("h-gop").value = S.gop; $("h-gop-value").textContent = S.gop; }
    $("h-frame").max = String(S.N - 1); $("h-frame").value = S.F;
    blit($("vid-thumb"), frames[0], W, H); $("vid-meta").textContent = `${label} · ${S.N} frames sampled · ${W}×${H} working size`;
    runEncode();
  }
  function sampleFrames() {
    const W = 160, H = 96, N = 24, out = [];
    for (let f = 0; f < N; f++) {
      const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"), t = f / N;
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#1c3f94"); g.addColorStop(1, "#e8a23b"); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = "#16a06b"; x.fillRect(0, 70, W, 26);
      for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? "#fff" : "#111"; x.fillRect(8 + i * 4, 76, 2, 14); }
      x.fillStyle = "#f4f1de"; x.beginPath(); x.arc(20 + t * 120, 30 + Math.sin(t * 6.28) * 14, 14, 0, 7); x.fill();
      x.fillStyle = "#d4474c"; x.fillRect(120 - t * 90, 44, 26, 18); x.strokeStyle = "#111"; x.lineWidth = 2; x.strokeRect(120 - t * 90, 44, 26, 18);
      x.fillStyle = "#111"; x.font = "bold 14px sans-serif"; x.fillText("H.264", 10, 18);
      out.push(x.getImageData(0, 0, W, H).data);
    }
    return { frames: out, W, H };
  }
  function saveVideoToIndexedDb(file) {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(false);
      const open = indexedDB.open("pixel-foundations", 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
        if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
      };
      open.onerror = () => resolve(false);
      open.onblocked = () => resolve(false);
      open.onsuccess = () => {
        const db = open.result;
        db.onversionchange = () => db.close();
        if (!db.objectStoreNames.contains("videos")) { db.close(); return resolve(false); }
        let tx;
        try {
          tx = db.transaction("videos", "readwrite");
          tx.objectStore("videos").put({ id: "latest", blob: file, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, savedAt: Date.now() });
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = tx.onabort = () => { db.close(); resolve(false); };
        } catch (_) {
          db.close();
          resolve(false);
        }
      };
    });
  }

  async function loadVideo(file) {
    if (!file) return;
    msg(""); if (!file.type.startsWith("video/")) return msg("That file is not a video.", true);
    if (file.size > 2 * 1024 * 1024) return msg(`Too large: ${(file.size / 1048576).toFixed(2)} MB. Please upload a video under 2 MB.`, true);
    const url = URL.createObjectURL(file), v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    try { await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("The browser could not read this video.")); }); } catch (e) { return msg(e.message, true); }
    if (!isFinite(v.duration) || v.duration > 10.05) return msg(`Too long: ${isFinite(v.duration) ? v.duration.toFixed(1) : "?"} s. Please upload a video shorter than 10 seconds.`, true);
    const savedLocally = await saveVideoToIndexedDb(file);
    const N = clamp(Math.ceil(v.duration * 10), 2, 30), W = 160, H = clamp(Math.round(((W * v.videoHeight) / v.videoWidth) / 16) * 16, 16, 112), frames = [];
    const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    msg("Sampling frames…"); setBar(0);
    for (let i = 0; i < N; i++) {
      await new Promise((r) => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; v.onseeked = fin; v.currentTime = Math.min(v.duration - 0.01, ((i + 0.5) * v.duration) / N); setTimeout(fin, 2500); });
      x.drawImage(v, 0, 0, W, H); frames.push(new Uint8ClampedArray(x.getImageData(0, 0, W, H).data)); setBar((i + 1) / N);
    }
    URL.revokeObjectURL(url); msg(`Loaded ${v.duration.toFixed(1)} s, ${(file.size / 1048576).toFixed(2)} MB.${savedLocally ? " Saved in this browser." : " Could not save in this browser."}`);
    setFrames(frames, W, H, N / v.duration, file.name);
  }

  // =====================================================================
  //  Encode driver
  // =====================================================================
  function schedule() { cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(() => setTimeout(runEncode, 60)); }
  async function runEncode() {
    if (!S.N) return; const tok = ++S.token, W = S.W, H = S.H;
    const cfg = { W, H, sx: sx(), sy: sy(), qp: S.qp, gop: S.gop, range: S.range, split: S.split, deblock: S.deblock, dbofs: S.dbofs };
    const enc = createEncoder(cfg), frames = [], planes = [];
    S.busy = true; msg(S.enc ? "Re-encoding…" : "Encoding…");
    for (let i = 0; i < S.N; i++) {
      const pl = planesOf(S.raw[i], W, H, cfg.sx, cfg.sy); planes.push(pl); frames.push(enc.encodeFrame(i, pl));
      setBar((i + 1) / S.N); await sleep(0); if (tok !== S.token) return;
    }
    S.enc = { frames, cfg }; S.planes = planes; S.busy = false; S.F = Math.min(S.F, S.N - 1); msg(`Encoded ${S.N} frames.`); setTimeout(() => setBar(0), 600); renderAll();
  }

  // =====================================================================
  //  Rendering
  // =====================================================================
  function renderAll() {
    if (!S.enc) return; renderStats(); renderLive(); renderPre(); renderStep1(); renderStep2(); renderStep3(); renderStep4(); renderStep5(); renderStep6(); renderPack();
  }
  function renderSteps() { renderStep1(); renderStep2(); renderStep3(); renderStep4(); renderStep5(); renderStep6(); renderPack(); }
  function totalBytes() { return S.enc.frames.reduce((a, f) => a + frameBytes(f, S.ent), 0) + 40; }
  function renderStats() {
    const E = S.enc, raw = S.W * S.H * 3 * S.N, tot = totalBytes(), dur = S.N / S.fps, psnr = E.frames.reduce((a, f) => a + f.psnr, 0) / S.N;
    $("hs-raw").textContent = fmt(raw); $("hs-h264").textContent = fmt(tot); $("hs-ratio").textContent = (raw / tot).toFixed(0) + " : 1"; $("hs-psnr").textContent = psnr.toFixed(1) + " dB"; $("hs-rate").textContent = ((tot * 8) / dur / 1000).toFixed(0) + " kbps";
    $("h-frame-value").textContent = `${S.F} · ${FR().type}`;
  }
  function renderLive() {
    const fr = FR(), { W, H } = S;
    blit($("hc-orig"), S.raw[S.F], W, H); blit($("hc-dec"), yccRgba(fr.rec.Y, fr.rec.Cb, fr.rec.Cr, W, H), W, H);
    blit($("hc-err"), grayRgba(fr.orig.Y, W, H, (v) => v).map((v, i) => { if (i % 4 === 3) return 255; const p = (i / 4) | 0; return clamp(255 - Math.abs(fr.orig.Y[p] - fr.rec.Y[p]) * 6, 0, 255); }), W, H);
    $("hc-info").textContent = `Decoded · ${fr.type}-frame · ${fmt(frameBytes(fr, S.ent))} · ${fr.psnr.toFixed(1)} dB`;
    const strip = $("gop-strip"), max = Math.max(...S.enc.frames.map((f) => frameBytes(f, S.ent)));
    strip.replaceChildren(...S.enc.frames.map((f, i) => { const d = document.createElement("button"); d.type = "button"; d.className = "gop-f " + f.type + (i === S.F ? " sel" : ""); d.title = `frame ${i} · ${f.type} · ${fmt(frameBytes(f, S.ent))}`; d.innerHTML = `<i style="height:${Math.max(6, (frameBytes(f, S.ent) / max) * 54)}px"></i><b>${f.type}</b>`; d.addEventListener("click", () => setFrame(i)); return d; }));
  }

  // ---- part 1 ----
  function renderPre() {
    const pl = S.planes[S.F], { W, H } = S, cw = W / sx(), ch = H / sy();
    blit($("hp-y"), grayRgba(pl.Y, W, H), W, H);
    const tint = (P, kind) => { const o = new Uint8ClampedArray(cw * ch * 4); for (let i = 0; i < cw * ch; i++) { const v = P[i], r = kind === "cb" ? 128 + (128 - v) * 0 : v, g = 128, b = 128; void r; const rgb = kind === "cb" ? [128 + (128 - v) * 0.0, 128 - (v - 128) * 0.35, v] : [v, 128 - (v - 128) * 0.45, 128]; o[i * 4] = clamp(rgb[0], 0, 255); o[i * 4 + 1] = clamp(rgb[1], 0, 255); o[i * 4 + 2] = clamp(rgb[2], 0, 255); o[i * 4 + 3] = 255; void g; void b; } return o; };
    blit($("hp-cb"), tint(pl.Cb, "cb"), cw, ch); blit($("hp-cr"), tint(pl.Cr, "cr"), cw, ch);
    $("hp-y-cap").textContent = `Y · ${W}×${H} = ${W * H} samples`; $("hp-cb-cap").textContent = `Cb · ${cw}×${ch} = ${cw * ch} samples`; $("hp-cr-cap").textContent = `Cr · ${cw}×${ch} = ${cw * ch} samples`;
    // sample grid diagram
    const cell = 46, a = sx(), b = sy(); let svg = `<svg viewBox="0 0 ${cell * 4 + 4} ${cell * 4 + 4}" class="sg-svg">`;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) svg += `<rect x="${2 + i * cell}" y="${2 + j * cell}" width="${cell}" height="${cell}" class="sg-cell"/><circle cx="${2 + i * cell + cell / 2}" cy="${2 + j * cell + cell / 2}" r="5" class="sg-y"/>`;
    for (let j = 0; j < 4; j += b) for (let i = 0; i < 4; i += a) svg += `<rect x="${2 + (i + a / 2) * cell - 8}" y="${2 + (j + b / 2) * cell - 8}" width="16" height="16" rx="3" class="sg-c"/>`;
    $("hp-grid").innerHTML = svg + "</svg><div class='legend-row'><span class='lg sgy'>● luma sample (every pixel)</span><span class='lg sgc'>■ chroma sample (Cb + Cr)</span></div>";
    $("hp-tag").textContent = S.sub === "444" ? "4:4:4" : S.sub === "422" ? "4:2:2" : "4:2:0";
    const full = W * H * 3, rows = [["4:4:4", 3], ["4:2:2", 2], ["4:2:0", 1.5]], tot = (W * H * (1 + 2 / (a * b)));
    $("hp-bars").replaceChildren(...rows.map(([n, k]) => { const d = document.createElement("div"); d.className = "sb" + (n.replace(/:/g, "") === S.sub ? " best" : ""); d.innerHTML = `<span>${n}</span><i style="width:${(k / 3) * 100}%;background:var(--primary)"></i><b class="mono">${fmt(W * H * k)}</b>`; return d; }));
    $("hp-formula").textContent = `bytes per frame = W·H + 2 · (W/${a})·(H/${b}) = ${W * H} + 2×${cw * ch} = ${Math.round(tot)}  → ${(tot / full * 100).toFixed(0)}% of 4:4:4 (${fmt(full)})`;
    renderPreView(); renderAvg(false);
  }
  function renderPreView() {
    const pl = S.planes[S.F], { W, H } = S, raw = S.raw[S.F], out = new Uint8ClampedArray(W * H * 4), v = S.view, a = sx(), b = sy(), cw = W / a;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let Y = pl.Y[i], cb = pl.fcb[i], cr = pl.fcr[i];
      if (v === "luma") { cb = 128; cr = 128; } else if (v === "chroma") Y = 128; else if (v === "sub") { const ci = ((y / b) | 0) * cw + ((x / a) | 0); cb = pl.Cb[ci]; cr = pl.Cr[ci]; }
      if (v === "orig") { out[i * 4] = raw[i * 4]; out[i * 4 + 1] = raw[i * 4 + 1]; out[i * 4 + 2] = raw[i * 4 + 2]; } else { out[i * 4] = Y + 1.402 * (cr - 128); out[i * 4 + 1] = Y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128); out[i * 4 + 2] = Y + 1.772 * (cb - 128); }
      out[i * 4 + 3] = 255;
    }
    blit($("hp-view"), out, W, H);
  }
  async function renderAvg(animate) {
    const pl = S.planes[S.F], { W, H } = S, a = sx(), b = sy(), box = $("hp-avg"), tok = bump("avg");
    const p = S.avg || { x: Math.floor(W / 2), y: Math.floor(H / 2) }, bx = Math.floor(p.x / a) * a, by = Math.floor(p.y / b) * b;
    const row = (name, F) => { const vals = []; for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) vals.push(Math.round(F[(by + j) * W + bx + i])); return { name, vals, avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) }; };
    const rows = [row("Cb", pl.fcb), row("Cr", pl.fcr)];
    box.innerHTML = `<div class="muted-note">Pixels (${bx}…${bx + a - 1}, ${by}…${by + b - 1}): ${a * b === 1 ? "4:4:4 keeps every chroma value." : `${a * b} chroma values collapse into one.`}</div>` + rows.map((r) => `<div class="avg-row"><b>${r.name}</b>${r.vals.map((v) => `<span class="avg-c">${v}</span>`).join("")}<em class="avg-eq">${r.vals.length > 1 ? "→ (" + r.vals.join(" + ") + ") / " + r.vals.length + " =" : "→"}</em><span class="avg-out">${r.avg}</span></div>`).join("");
    if (!animate) return; const cells = [...box.querySelectorAll(".avg-c, .avg-eq, .avg-out")]; cells.forEach((c) => (c.style.opacity = 0));
    for (const c of cells) { if (tok !== S.a.avg) return; c.style.opacity = 1; await sleep(c.classList.contains("avg-c") ? 160 : 300); }
  }

  // ---- step 1 ----
  const partColor = (n) => (n === 16 ? C16 : n === 8 ? C8 : C4);
  function renderStep1() {
    const fr = FR(), { W, H } = S, c = $("h1-canvas"), ctx = c.getContext("2d");
    blit(c, yccRgba(fr.orig.Y, S.planes[S.F].Cb, S.planes[S.F].Cr, W, H), W, H);
    ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(255,255,255,.22)"; for (let x = 0; x <= W; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y <= H; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const cnt = { 16: 0, 8: 0, 4: 0 }; let intraN = 0;
    for (const mb of fr.mbs) { if (mb.intra) intraN++; for (const p of mb.parts) { cnt[p.n]++; ctx.strokeStyle = partColor(p.n); ctx.lineWidth = p.n === 16 ? 1.2 : 0.8; ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.n - 1, p.n - 1); } }
    ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 1.8; ctx.strokeRect(S.mb.x * 16 + 1, S.mb.y * 16 + 1, 14, 14);
    $("h1-tag").textContent = `frame ${S.F} · ${fr.type}`;
    $("h1-stats").textContent = `${fr.mbs.length} macroblocks → ${cnt[16]} × 16×16, ${cnt[8]} × 8×8, ${cnt[4]} × 4×4 partitions · ${intraN} intra MBs${fr.type === "P" ? " (the rest are inter-predicted)" : ""}.`;
    drawZoom(3);
  }
  function selMb() { return FR().mbs[S.mb.y * (S.W / 16) + S.mb.x]; }
  function drawZoom(level) {
    const fr = FR(), mb = selMb(), z = $("h1-zoom"), { W } = S, sc = 16;
    zoomDraw(z, yccRgba(fr.orig.Y, S.planes[S.F].Cb, S.planes[S.F].Cr, W, S.H), W, mb.x * 16, mb.y * 16, 16, sc);
    const ctx = z.getContext("2d"); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.18)"; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke(); }
    ctx.lineWidth = 3; for (const p of mb.parts) { const lv = p.n === 16 ? 1 : p.n === 8 ? 2 : 3; if (lv > level) continue; ctx.strokeStyle = partColor(p.n); ctx.strokeRect((p.x - mb.x * 16) * sc + 1.5, (p.y - mb.y * 16) * sc + 1.5, p.n * sc - 3, p.n * sc - 3); }
    // coarser lines for hidden levels: show parent boundary
    if (level < 3) { ctx.strokeStyle = C16; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, 253, 253); }
    const bx = (S.blk & 3) * 4, by = (S.blk >> 2) * 4; ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(bx * sc + 3, by * sc + 3, 4 * sc - 6, 4 * sc - 6); ctx.setLineDash([]);
    $("h1-title").textContent = `Macroblock (${mb.x}, ${mb.y}) · ${mb.intra ? "intra" : mb.skip ? "skipped" : "inter"}`;
    const c = { 16: 0, 8: 0, 4: 0 }; mb.parts.forEach((p) => c[p.n]++);
    $("h1-note").textContent = `${[c[16] && `${c[16]}×16×16`, c[8] && `${c[8]}×8×8`, c[4] && `${c[4]}×4×4`].filter(Boolean).join(" + ")}${mb.intra ? " · each part predicted from edge pixels" : " · each part gets its own motion vector"}. Dashed box = 4×4 block #${S.blk} used in later steps.`;
  }
  async function playSplit() { const tok = bump("split"); for (let lv = 1; lv <= 3; lv++) { if (tok !== S.a.split) return; drawZoom(lv); await sleep(750); } }

  // ---- step 2 ----
  function blkOrigin() { return { x: S.mb.x * 16 + (S.blk & 3) * 4, y: S.mb.y * 16 + (S.blk >> 2) * 4 }; }
  function renderStep2() {
    const fr = FR(), { W, H } = S, o = blkOrigin(), nb = neighbors(fr.pre.Y, W, o.x, o.y, 4, o.y % 16 === 0);
    // context canvas
    const c = $("h2-ctx"); c.width = c.height = 5; const ctx = c.getContext("2d"), img = ctx.createImageData(5, 5);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { let v = 40; if (j === 0 && i > 0) v = nb.hasTop ? nb.top[i - 1] : 40; else if (i === 0 && j > 0) v = nb.hasLeft ? nb.left[j - 1] : 40; else if (i > 0 && j > 0) v = fr.orig.Y[(o.y + j - 1) * W + o.x + i - 1]; const k = (j * 5 + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const box = $("h2-modes"); box.replaceChildren(); let best = null; const res = [];
    for (let m = 0; m < 4; m++) {
      const pr = intraPredict(4, m, nb.top, nb.left, nb.hasTop, nb.hasLeft); let sad = null;
      if (pr) { sad = 0; for (let k = 0; k < 16; k++) sad += Math.abs(fr.orig.Y[(o.y + (k >> 2)) * W + o.x + (k & 3)] - pr[k]); if (!best || sad < best.sad) best = { sad, m }; }
      res.push({ pr, sad });
    }
    res.forEach((r, m) => {
      const card = document.createElement("div"); card.className = "mode-card" + (best && best.m === m ? " best" : "") + (r.pr ? "" : " off");
      const cv = document.createElement("canvas"); cv.width = cv.height = 4; if (r.pr) { const cx = cv.getContext("2d"), im = cx.createImageData(4, 4); for (let k = 0; k < 16; k++) { im.data[k * 4] = im.data[k * 4 + 1] = im.data[k * 4 + 2] = r.pr[k]; im.data[k * 4 + 3] = 255; } cx.putImageData(im, 0, 0); }
      card.appendChild(cv); const arrow = ["↓ copy top row down", "→ copy left column right", "● average of edges", "↙ diagonal from top row"][m];
      const l = document.createElement("div"); l.innerHTML = `<b>${MODE_NAMES[m]}</b><small>${r.pr ? arrow : "needs missing neighbors"}</small><span class="mono">${r.sad === null ? "n/a" : "SAD " + r.sad}</span>`; card.appendChild(l); box.appendChild(card);
    });
    $("h2-intra-tag").textContent = `block (${o.x}, ${o.y})`;
    $("h2-intra-note").textContent = best ? `Best: ${MODE_NAMES[best.m]} with SAD ${best.sad}. Only the mode number and the (small) leftover residual are stored.${selMb().intra ? "" : " (This MB was coded inter by the encoder; intra shown for illustration.)"}` : "No neighbors available at the frame corner, so DC = 128.";
    renderInter(null);
  }
  function renderInter(candidate) {
    const { W, H } = S, mb = S.mb, x0 = mb.x * 16, y0 = mb.y * 16, R = S.range, rc = $("h2-ref"), cc = $("h2-cur"), note = $("h2-inter-note");
    const cur = FR().orig.Y; blit(cc, grayRgba(cur, W, H), W, H); const cx2 = cc.getContext("2d"); cx2.strokeStyle = "#ffcc00"; cx2.lineWidth = 1.5; cx2.strokeRect(x0 + 0.5, y0 + 0.5, 15, 15);
    // MV field
    const fc = $("h2-field"), fr = FR(); blit(fc, grayRgba(cur, W, H, (v) => v * 0.55 + 40), W, H); const fx = fc.getContext("2d");
    for (const m of fr.mbs) { if (m.intra) { fx.fillStyle = "#d4474c"; fx.fillRect(m.x * 16 + 6, m.y * 16 + 6, 4, 4); continue; } for (const p of m.parts) { const px = p.x + p.n / 2, py = p.y + p.n / 2, len = Math.hypot(p.mvx, p.mvy); if (!len) { fx.fillStyle = "rgba(255,255,255,.55)"; fx.fillRect(px - 0.7, py - 0.7, 1.4, 1.4); continue; } fx.strokeStyle = C16; fx.fillStyle = C16; fx.lineWidth = 1; fx.beginPath(); fx.moveTo(px, py); fx.lineTo(px + p.mvx, py + p.mvy); fx.stroke(); fx.fillRect(px + p.mvx - 1, py + p.mvy - 1, 2, 2); } }
    fx.strokeStyle = "#ffcc00"; fx.lineWidth = 1.5; fx.strokeRect(x0 + 0.5, y0 + 0.5, 15, 15);
    if (S.F === 0) { blit(rc, grayRgba(cur, W, H, (v) => v * 0.3), W, H); $("h2-sad-text").textContent = "Frame 0 has no earlier frame. Pick frame 1 or later."; note.textContent = "The first frame is always intra-coded. Move the Frame slider to a later frame to see motion search."; const sc = $("h2-sad"); sc.width = sc.height = 1; return; }
    const ref = S.enc.frames[S.F - 1].rec.Y, side = 2 * R + 1, sad = new Int32Array(side * side); let best = { s: Infinity, dx: 0, dy: 0 }, mx = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const s = sadAt(cur, W, H, x0, y0, ref, x0 + dx, y0 + dy, 16, 1e9); sad[(dy + R) * side + dx + R] = s; mx = Math.max(mx, s); const pen = (Math.abs(dx) + Math.abs(dy)) * 2; if (s + pen < best.s + 0) { if (s + pen < best.s) best = { s: s + pen, sad: s, dx, dy }; } }
    S.search = { sad, side, R, best, mx, x0, y0, ref };
    drawSearch(candidate, sad);
    const s0 = sad[R * side + R]; note.textContent = `MB (${mb.x}, ${mb.y}): the best match is ${best.dx},${best.dy} px away with SAD ${best.sad}, versus SAD ${s0} with no motion. ${best.dx || best.dy ? "The encoder stores the vector and a small residual instead of 256 raw pixels." : "No motion here: the block is copied from the same place."}`;
  }
  function drawSearch(candidate, sadArr) {
    const { W, H } = S, { side, R, best, mx, x0, y0, ref } = S.search, rc = $("h2-ref"); blit(rc, grayRgba(ref, W, H), W, H);
    const ctx = rc.getContext("2d"); ctx.strokeStyle = "rgba(255,204,0,.9)"; ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeRect(x0 - R + 0.5, y0 - R + 0.5, 16 + 2 * R - 1, 16 + 2 * R - 1); ctx.setLineDash([]);
    const shown = candidate ? candidate.best : best; ctx.strokeStyle = candidate ? "#7ee7ff" : C16; ctx.lineWidth = 1.6; ctx.strokeRect(x0 + (candidate ? candidate.dx : best.dx) + 0.5, y0 + (candidate ? candidate.dy : best.dy) + 0.5, 15, 15);
    if (candidate) { ctx.strokeStyle = C16; ctx.strokeRect(x0 + candidate.best.dx + 0.5, y0 + candidate.best.dy + 0.5, 15, 15); }
    const sc = $("h2-sad"); sc.width = sc.height = side; const sx2 = sc.getContext("2d"), img = sx2.createImageData(side, side);
    for (let k = 0; k < side * side; k++) { const known = !candidate || candidate.done[k], t = sadArr[k] / (mx || 1), v = known ? Math.round(255 * (1 - Math.sqrt(t))) : 30; img.data[k * 4] = known ? 30 + (255 - v) * 0.3 : 30; img.data[k * 4 + 1] = known ? 60 + v * 0.75 : 30; img.data[k * 4 + 2] = known ? 90 : 40; img.data[k * 4 + 3] = 255; }
    sx2.putImageData(img, 0, 0); sx2.strokeStyle = "#fff"; sx2.lineWidth = 0.6; sx2.strokeRect(shown.dx + R + 0.3, shown.dy + R + 0.3, 0.4, 0.4); sx2.strokeStyle = "#fff"; sx2.strokeRect(best.dx + R, best.dy + R, 1, 1);
    $("h2-sad-text").textContent = `${side}×${side} candidates (search range ±${R}). Brighter = more similar.` + (candidate ? ` Best so far: (${candidate.best.dx}, ${candidate.best.dy}) SAD ${candidate.best.sad}` : "");
  }
  async function playSearch() {
    if (!S.search || S.F === 0) return; const tok = bump("search"), { side, R, sad } = S.search, list = [];
    for (let r = 0; r <= R; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) list.push([dx, dy]);
    const done = new Uint8Array(side * side), chunk = Math.max(1, Math.ceil(list.length / 140)); let b = { s: Infinity, sad: 0, dx: 0, dy: 0 };
    for (let i = 0; i < list.length; i += chunk) {
      if (tok !== S.a.search) return;
      for (let j = i; j < Math.min(list.length, i + chunk); j++) { const [dx, dy] = list[j], k = (dy + R) * side + dx + R; done[k] = 1; const pen = (Math.abs(dx) + Math.abs(dy)) * 2; if (sad[k] + pen < b.s) b = { s: sad[k] + pen, sad: sad[k], dx, dy }; }
      const [cx, cy] = list[Math.min(list.length - 1, i + chunk - 1)]; drawSearch({ dx: cx, dy: cy, best: b, done }, sad); await sleep(18);
    }
    drawSearch(null, sad);
  }

  // ---- step 3 ----
  function renderStep3(t = 1) {
    const fr = FR(), { W, H } = S, x0 = S.mb.x * 16, y0 = S.mb.y * 16;
    const draw = (id, f) => { const c = $(id); c.width = c.height = 16; const cx = c.getContext("2d"), im = cx.createImageData(16, 16); for (let k = 0; k < 256; k++) { const v = f(k, (y0 + (k >> 4)) * W + x0 + (k & 15)); im.data[k * 4] = im.data[k * 4 + 1] = im.data[k * 4 + 2] = v; im.data[k * 4 + 3] = 255; } cx.putImageData(im, 0, 0); };
    draw("h3-actual", (k, i) => fr.orig.Y[i]); draw("h3-pred", (k, i) => fr.pred[i]); draw("h3-resid", (k, i) => (k >> 4) < t * 16 ? clamp(128 + fr.resid[i] * 2, 0, 255) : 128);
    const fc = $("h3-frame"); blit(fc, grayRgba(fr.resid, W, H, (v) => clamp(128 + v * 2, 0, 255)).map((v, i) => v), W, H); const fx = fc.getContext("2d"); fx.strokeStyle = "#ffcc00"; fx.lineWidth = 1.5; fx.strokeRect(x0 + 0.5, y0 + 0.5, 15, 15);
    const o = blkOrigin(), a = [], p = [], r = []; for (let k = 0; k < 16; k++) { const i = (o.y + (k >> 2)) * W + o.x + (k & 3); a.push(fr.orig.Y[i]); p.push(fr.pred[i]); r.push(fr.resid[i]); }
    mxFill($("h3-mx-a"), a, (v) => `rgb(${v},${v},${v})`).forEach((c, i) => (c.style.color = a[i] > 128 ? "#111" : "#eee")); mxFill($("h3-mx-p"), p, (v) => `rgb(${v},${v},${v})`).forEach((c, i) => (c.style.color = p[i] > 128 ? "#111" : "#eee")); mxFill($("h3-mx-r"), r, (v) => heat(v, 40));
    let eo = 0, er = 0, fo = 0, fe = 0; for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const k = (y0 + j) * W + x0 + i; eo += fr.orig.Y[k] ** 2; er += fr.resid[k] ** 2; }
    for (let k = 0; k < W * H; k++) { fo += fr.orig.Y[k] ** 2; fe += fr.resid[k] ** 2; }
    $("h3-tag").textContent = `block #${S.blk}`;
    $("h3-stats").textContent = `Selected MB: residual energy is ${(er / eo * 100).toFixed(2)}% of the original's. Whole frame: ${(fe / fo * 100).toFixed(2)}%. Lower means fewer bits to code.`;
  }
  async function playResidual() { const tok = bump("res"); for (let s = 0; s <= 16; s++) { if (tok !== S.a.res) return; renderStep3(s / 16); await sleep(70); } }

  // ---- step 4 ----
  function blockXs() { const fr = FR(), o = blkOrigin(), X = new Int32Array(16); for (let k = 0; k < 16; k++) X[k] = fr.resid[(o.y + (k >> 2)) * S.W + o.x + (k & 3)]; return X; }
  function renderStep4(stage = 5) {
    const X = blockXs(), fr = FR(), r = roundTrip4(X, S.qp, fr.bIntra[((S.mb.y * 4 + (S.blk >> 2)) * (S.W / 4)) + S.mb.x * 4 + (S.blk & 3)] === 1);
    const stages = [["h4-x", X], ["h4-w", r.W], ["h4-z", r.Z], ["h4-d", r.D], ["h4-r", r.R]];
    stages.forEach(([id, arr], i) => { const m = Math.max(...Array.from(arr, Math.abs), 1); const cells = mxFill($(id), arr, (v) => (i <= stage - 1 ? heat(v, i === 2 ? 6 : m) : ""), (v) => (i <= stage - 1 ? v : "·")); cells.forEach((c, k) => { if (i === 2 && arr[k] === 0 && i <= stage - 1) c.classList.add("zero"); }); });
    const qs = qstep(S.qp), qb = 15 + ((S.qp / 6) | 0);
    $("h4-qinfo").innerHTML = `QP <b>${S.qp}</b> → Qstep = 0.625 × 2<sup>${S.qp}/6</sup> = <b>${qs.toFixed(2)}</b> · qbits = 15 + ⌊${S.qp}/6⌋ = ${qb} · MF row (QP mod 6 = ${S.qp % 6}) = ${MF[S.qp % 6].join(", ")} · +6 QP doubles the step`;
    const zeros = r.Z.filter((v) => v === 0).length; $("h4-note").textContent = `This block: ${16 - zeros} of 16 levels survive, ${zeros} became zero. Max error after round trip: ${Math.max(...Array.from(X, (v, k) => Math.abs(v - r.R[k])))} gray levels.`;
    const ch = $("h4-chart"); if (!ch.children.length) ch.replaceChildren(...Array.from({ length: 52 }, (_, q) => { const i = document.createElement("i"); i.style.height = `${6 + (Math.log2(qstep(q) / 0.625) / Math.log2(qstep(51) / 0.625)) * 94}%`; i.title = `QP ${q}: ${qstep(q).toFixed(2)}`; return i; }));
    [...ch.children].forEach((i, q) => i.classList.toggle("cur", q === S.qp));
    const { W, H } = S; blit($("h4-recon"), yccRgba(fr.pre.Y, fr.pre.Cb, fr.pre.Cr, W, H), W, H); $("h4-recon-cap").textContent = `Reconstruction before deblocking · ${fr.psnrPre.toFixed(1)} dB`;
    const bw = W / 4, bh = H / 4, zi = new Uint8ClampedArray(bw * bh * 4); let withNz = 0, zeroLv = 0;
    for (let b = 0; b < bw * bh; b++) { let n = 0; for (let k = 0; k < 16; k++) if (fr.Zs[b * 16 + k]) n++; zeroLv += 16 - n; if (n) withNz++; const v = Math.round((n / 16) * 255); zi[b * 4] = 20 + v * 0.35; zi[b * 4 + 1] = 40 + v * 0.8; zi[b * 4 + 2] = 70 + v * 0.4; zi[b * 4 + 3] = 255; }
    blit($("h4-zmap"), zi, bw, bh); $("h4-zmap-cap").textContent = `${(withNz / (bw * bh) * 100).toFixed(0)}% of 4×4 blocks carry data · ${(zeroLv / (bw * bh * 16) * 100).toFixed(0)}% of levels are zero`;
  }
  async function playTransform() { const tok = bump("tf"); for (let st = 0; st <= 5; st++) { if (tok !== S.a.tf) return; renderStep4(st); if (st > 0 && st < 5) { const id = ["h4-x", "h4-w", "h4-z", "h4-d", "h4-r"][st - 1]; [...$(id).children].forEach((c) => c.classList.add("pop")); } await sleep(900); } }

  // ---- step 5 ----
  function renderStep5() {
    const fr = FR(), { W, H } = S, pl = S.planes[S.F];
    blit($("h5-before"), yccRgba(fr.pre.Y, fr.pre.Cb, fr.pre.Cr, W, H), W, H); blit($("h5-after"), yccRgba(fr.rec.Y, fr.rec.Cb, fr.rec.Cr, W, H), W, H);
    blit($("h5-diff"), grayRgba(fr.rec.Y, W, H).map((v, i) => (i % 4 === 3 ? 255 : clamp(255 - Math.abs(fr.rec.Y[(i / 4) | 0] - fr.pre.Y[(i / 4) | 0]) * 8, 0, 255))), W, H);
    const bc = $("h5-before").getContext("2d"); bc.strokeStyle = "rgba(255,255,255,.25)"; bc.lineWidth = 0.5; for (let x = 4; x < W; x += 4) { bc.beginPath(); bc.moveTo(x + 0.5, 0); bc.lineTo(x + 0.5, H); bc.stroke(); }
    if (!S.edge) { const o = blkOrigin(); S.edge = { x: o.x > 0 ? o.x : o.x + 4, y: o.y + 1 }; }
    const e = S.edge; bc.strokeStyle = "#ffcc00"; bc.lineWidth = 1.5; bc.strokeRect(e.x - 4, e.y - 0.5, 8, 1.5);
    $("h5-stats").textContent = S.deblock ? `${fr.db.filtered} of ${fr.db.lines} candidate edge lines were smoothed (the rest are real detail or have bS = 0). PSNR ${fr.psnrPre.toFixed(2)} → ${fr.psnr.toFixed(2)} dB.` : "Deblocking is off: enable it in the dials to compare.";
    drawProfile(1, 0);
    void pl;
  }
  function edgeData() {
    const fr = FR(), e = S.edge, { W } = S, bw = W / 4, px = []; for (let k = 0; k < 8; k++) px.push(fr.pre.Y[e.y * W + e.x - 4 + k]);
    const bS = bsOf(fr, (e.y >> 2) * bw + ((e.x - 1) >> 2), (e.y >> 2) * bw + (e.x >> 2)); return { px, ...filterLine(px, bS, S.qp, S.dbofs), before: px };
  }
  function drawProfile(t) {
    const c = $("h5-profile"), ctx = c.getContext("2d"), W = c.width, H = c.height, d = edgeData(), names = ["p3", "p2", "p1", "p0", "q0", "q1", "q2", "q3"];
    ctx.clearRect(0, 0, W, H); const fg = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim() || "#222", mut = getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground").trim() || "#888";
    const vals = [...d.before, ...d.px], lo = Math.min(...vals) - 8, hi = Math.max(...vals) + 8, Y = (v) => H - 26 - ((v - lo) / (hi - lo)) * (H - 46), bwid = W / 8;
    ctx.font = "11px ui-monospace,monospace"; ctx.textAlign = "center";
    for (let k = 0; k < 8; k++) { const x = k * bwid + bwid / 2, v0 = d.before[k], v1 = d.before[k] + (d.px[k] - d.before[k]) * t; ctx.fillStyle = "rgba(120,130,150,.28)"; ctx.fillRect(x - 28, Y(v0), 56, H - 26 - Y(v0)); ctx.fillStyle = d.px[k] !== d.before[k] ? C16 : "rgba(60,140,200,.7)"; ctx.fillRect(x - 18, Y(v1), 36, H - 26 - Y(v1)); ctx.fillStyle = fg; ctx.fillText(Math.round(v1), x, Y(v1) - 4); ctx.fillStyle = mut; ctx.fillText(names[k], x, H - 8); }
    ctx.strokeStyle = "#ffcc00"; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(W / 2, 6); ctx.lineTo(W / 2, H - 22); ctx.stroke(); ctx.setLineDash([]);
    const b = d.before; $("h5-calc").textContent = `edge x=${S.edge.x}, row ${S.edge.y} · bS ${d.bS} · QP ${S.qp}${S.dbofs ? ` (+${S.dbofs} offset)` : ""} → α ${d.alpha}, β ${d.beta}:   |p0−q0| = ${Math.abs(b[3] - b[4])} ${Math.abs(b[3] - b[4]) < d.alpha ? "<" : "≥"} α,  |p1−p0| = ${Math.abs(b[2] - b[3])} ${Math.abs(b[2] - b[3]) < d.beta ? "<" : "≥"} β,  |q1−q0| = ${Math.abs(b[5] - b[4])} ${Math.abs(b[5] - b[4]) < d.beta ? "<" : "≥"} β   ${d.on ? `→ filter: tc = ${d.tc}, Δ = ${d.delta}, p0 ${b[3]}→${d.px[3]}, q0 ${b[4]}→${d.px[4]}` : d.bS === 0 ? "→ bS = 0, no filtering" : "→ condition fails: treated as a real edge, left untouched"}`;
  }
  async function playDeblock() { const tok = bump("db"); for (let s = 0; s <= 20; s++) { if (tok !== S.a.db) return; drawProfile(s / 20); await sleep(45); } }

  // ---- step 6 ----
  function renderStep6() {
    const E = S.enc, c = $("h6-bits"), ctx = c.getContext("2d"), W = c.width, H = c.height, n = E.frames.length, bwd = W / n, max = Math.max(...E.frames.map((f) => frameBits(f, S.ent)));
    ctx.clearRect(0, 0, W, H); const fg = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim() || "#222";
    E.frames.forEach((f, i) => { const b = f.bits[S.ent]; let y = H - 18; for (const [k, col] of [["hdr", "#8a7bd8"], ["mv", C8], ["res", C16]]) { const h = (b[k] / max) * (H - 34); ctx.fillStyle = col; ctx.fillRect(i * bwd + 2, y - h, bwd - 4, h); y -= h; } ctx.fillStyle = f.type === "I" ? "#d4474c" : "rgba(120,130,150,.8)"; ctx.fillText(f.type, i * bwd + bwd / 2 - 3, H - 5); if (i === S.F) { ctx.strokeStyle = fg; ctx.lineWidth = 1.5; ctx.strokeRect(i * bwd + 1, 2, bwd - 2, H - 16); } });
    const tc = E.frames.reduce((a, f) => a + frameBits(f, "cavlc"), 0), tb = E.frames.reduce((a, f) => a + frameBits(f, "cabac"), 0);
    $("h6-tag").textContent = `${S.ent.toUpperCase()} · frame ${S.F}: ${fmt(frameBytes(FR(), S.ent))}`;
    $("h6-cmp").textContent = `Whole clip: CAVLC ${fmt(tc / 8)} vs CABAC ${fmt(tb / 8)} → CABAC is ${((1 - tb / tc) * 100).toFixed(1)}% smaller in this toy model. Real encoders measure about 10–15%; the gap here is exaggerated because the CAVLC tables are approximated. Tall red-labelled bars are I-frames: they carry every block's data and cost far more than P-frames.`;
    renderBlockCoding(false);
  }
  const zzOfSelected = () => { const fr = FR(), o = blkOrigin(), bi = (o.y >> 2) * (S.W / 4) + (o.x >> 2); return { zz: ZZ4.map((k) => fr.Zs[bi * 16 + k]), bi }; };
  function renderBlockCoding(animate) {
    const { zz, bi } = zzOfSelected(), skipped = !FR().order.includes(bi), ex = skipped ? { rows: [{ label: "coded_block_pattern", detail: "this 8×8 group is all zero: its bit in the pattern covers every block", bits: 0 }], bits: 0 } : cavlcExplain(zz), tok = bump("cav");
    $("h6-scan").replaceChildren(...zz.map((v) => { const s = document.createElement("span"); s.textContent = v; if (!v) s.className = "z"; return s; }));
    const list = $("h6-cavlc"), bs = $("h6-cavlc-bits"); list.replaceChildren(); bs.replaceChildren();
    const add = (r) => { const d = document.createElement("div"); d.className = "cv-row"; d.innerHTML = `<b>${r.label}</b><span>${r.detail}</span><em>${r.bits} bit${r.bits === 1 ? "" : "s"}</em>`; list.appendChild(d); const seg = document.createElement("span"); seg.className = "bitseg " + (r.label === "level" ? "amp" : r.label.startsWith("coeff") ? "dc" : "ac"); seg.style.minWidth = `${Math.max(14, r.bits * 6)}px`; seg.textContent = r.bits; seg.title = `${r.label}: ${r.bits} bits`; bs.appendChild(seg); };
    if (!animate) { ex.rows.forEach(add); const t = document.createElement("div"); t.className = "cv-row total"; t.innerHTML = `<b>block total</b><span>vs ${16 * 8} bits as raw bytes</span><em>${ex.bits} bits</em>`; list.appendChild(t); renderCabac(false); return; }
    (async () => { for (const r of ex.rows) { if (tok !== S.a.cav) return; add(r); await sleep(420); } const t = document.createElement("div"); t.className = "cv-row total"; t.innerHTML = `<b>block total</b><span>vs ${16 * 8} bits as raw bytes</span><em>${ex.bits} bits</em>`; list.appendChild(t); })();
    renderCabac(false);
  }
  function cabacBins() {
    const fr = FR(), { bi } = zzOfSelected(), set = mkSet();
    if (!fr.order.includes(bi)) return [{ name: "coded_block_pattern bit for this 8×8 group = 0", bit: 0, p1: 0.2, bits: 0.3 }];
    for (const b of fr.order) { if (b === bi) break; cabacBlock(set, ZZ4.map((k) => fr.Zs[b * 16 + k]), null); }
    const rec = []; cabacBlock(set, zzOfSelected().zz, rec); return rec;
  }
  function renderCabac(animate, upto) {
    const bins = cabacBins(), box = $("h6-bins"), tok = bump("cab"), total = bins.reduce((a, b) => a + b.bits, 0); box.replaceChildren();
    const show = upto === undefined ? bins.length : upto;
    bins.slice(0, show).forEach((b, i) => { const d = document.createElement("div"); d.className = "bin-row" + (b.bypass ? " by" : "") + (i === show - 1 && animate ? " cur" : ""); d.innerHTML = `<b>${b.name}</b><span class="mono">bin = ${b.bit}</span><span class="mono">P(1) = ${b.p1.toFixed(2)}</span><em>${b.bits.toFixed(2)} bit</em>`; box.appendChild(d); });
    drawInterval(bins, show); box.scrollTop = box.scrollHeight;
    $("h6-cabac-note").textContent = `${bins.length} binary decisions cost ${total.toFixed(1)} bits in total (fractions of a bit each). A highly probable decision such as significant = 0 costs almost nothing.`;
    void tok;
  }
  function drawInterval(bins, upto) {
    const c = $("h6-interval"), ctx = c.getContext("2d"), W = c.width, H = c.height; ctx.clearRect(0, 0, W, H);
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground").trim() || "#888"; let log = 0;
    bins.slice(0, upto).forEach((b) => (log += b.bits));
    const frac = 2 ** -log; ctx.fillStyle = "rgba(120,130,150,.25)"; ctx.fillRect(10, 18, W - 20, 22);
    const w = Math.max(2, (W - 20) * Math.min(1, frac)); ctx.fillStyle = C16; ctx.fillRect(10 + (W - 20) / 2 - w / 2, 18, w, 22);
    ctx.fillStyle = fg; ctx.font = "11px ui-monospace,monospace"; ctx.fillText(`interval after ${upto} bins: 2^−${log.toFixed(1)} = ${frac < 0.001 ? frac.toExponential(1) : frac.toFixed(4)} of [0,1)  ≈ ${Math.ceil(log)} bits to name a number inside it`, 10, 12);
    if (upto > 0) { const b = bins[upto - 1], p = b.bit === 1 ? b.p1 : 1 - b.p1; ctx.fillText(`last bin: P(${b.bit === "·" ? "bypass" : b.bit}) = ${p.toFixed(2)} → interval × ${p.toFixed(2)}`, 10, 60); }
  }
  async function playCabac() { const bins = cabacBins(), tok = bump("cab2"); for (let i = 0; i <= bins.length; i++) { if (tok !== S.a.cab2) return; renderCabac(true, i); await sleep(230); } renderCabac(false); }

  // ---- part 3 ----
  function bitWriter() { const bits = []; return { u: (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); }, ue: (v) => { const x = v + 1, l = Math.floor(Math.log2(x)); for (let i = 0; i < l; i++) bits.push(0); for (let i = l; i >= 0; i--) bits.push((x >> i) & 1); }, se: function (v) { this.ue(v > 0 ? 2 * v - 1 : -2 * v); }, done() { bits.push(1); while (bits.length % 8) bits.push(0); const out = []; for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2)); return out; } }; }
  function epb(bytes) { const out = []; let z = 0; for (const b of bytes) { if (z >= 2 && b <= 3) { out.push(3); z = 0; } out.push(b); z = b === 0 ? z + 1 : 0; } return out; }
  function buildSps() {
    const w = bitWriter(), prof = S.sub === "444" ? 244 : S.sub === "422" ? 122 : S.ent === "cabac" ? 77 : 66, hi = prof >= 100;
    w.u(prof, 8); w.u(prof === 66 ? 0xc0 : 0, 8); w.u(30, 8); w.ue(0);
    if (hi) { w.ue(S.sub === "444" ? 3 : S.sub === "422" ? 2 : 1); if (S.sub === "444") w.u(0, 1); w.ue(0); w.ue(0); w.u(0, 1); w.u(0, 1); }
    w.ue(0); w.ue(2); w.ue(1); w.u(0, 1); w.ue(S.W / 16 - 1); w.ue(S.H / 16 - 1); w.u(1, 1); w.u(1, 1); w.u(0, 1); w.u(0, 1);
    return { bytes: [0x67, ...epb(w.done())], prof };
  }
  function buildPps() { const w = bitWriter(); w.ue(0); w.ue(0); w.u(S.ent === "cabac" ? 1 : 0, 1); w.u(0, 1); w.ue(0); w.ue(0); w.ue(0); w.u(0, 1); w.u(0, 2); w.se(S.qp - 26); w.se(0); w.se(0); w.u(1, 1); w.u(0, 1); w.u(0, 1); return [0x68, ...epb(w.done())]; }
  function nalPlan() {
    const sps = buildSps(), pps = buildPps(), list = [{ name: "SPS", type: 7, ref: 3, size: sps.bytes.length }, { name: "PPS", type: 8, ref: 3, size: pps.length }];
    S.enc.frames.forEach((f, i) => list.push({ name: f.type === "I" ? "IDR slice" : "P slice", type: f.type === "I" ? 5 : 1, ref: f.type === "I" ? 3 : 2, size: frameBytes(f, S.ent), frame: i }));
    return { list, sps, pps };
  }
  function renderPack() {
    const { list, sps, pps } = nalPlan(), box = $("n-list"), pre = S.nalfmt === "annexb" ? 4 : 4, shown = list.slice(0, 9), max = Math.max(...list.map((n) => n.size));
    box.replaceChildren(...shown.map((n) => { const d = document.createElement("div"); d.className = "nal-row" + (n.frame === S.F ? " sel" : ""); const hdr = (n.ref << 5) | n.type; d.innerHTML = `<span class="nal-pre">${S.nalfmt === "annexb" ? "00 00 00 01" : h2(n.size >> 24) + " " + h2(n.size >> 16) + " " + h2(n.size >> 8) + " " + h2(n.size)}</span><span class="nal-hdr">${h2(hdr)}</span><span class="nal-name">${n.name}</span><i style="width:${Math.max(4, (n.size / max) * 100)}%"></i><b class="mono">${fmt(n.size)}</b>`; return d; }));
    if (list.length > shown.length) { const m = document.createElement("div"); m.className = "muted-note"; m.textContent = `… and ${list.length - shown.length} more slice NAL units`; box.appendChild(m); }
    const fr = FR(), t = fr.type === "I" ? 5 : 1, rf = fr.type === "I" ? 3 : 2, hb = (rf << 5) | t;
    $("n-hdr").textContent = `Frame ${S.F} NAL header byte 0x${h2(hb)} = ${hb.toString(2).padStart(8, "0")}:  forbidden_zero_bit ${hb >> 7}  ·  nal_ref_idc ${rf} (${rf ? "used as reference" : "disposable"})  ·  nal_unit_type ${t} (${t === 5 ? "IDR slice: decoder can start here" : "non-IDR slice"}).  ${S.nalfmt === "annexb" ? "Annex B marks boundaries with a 00 00 00 01 start code; emulation prevention inserts 03 after 00 00 inside payloads." : "MP4 stores a 4-byte length instead of start codes, so players can jump from NAL to NAL without scanning."}`;
    void pre;
    const hexOf = (arr, cls) => arr.map((b) => `<span class="hx ${cls}">${h2(b)}</span>`).join("");
    $("n-sps").innerHTML = `<div class="hex-label">SPS</div>${hexOf(sps.bytes, "ih")}<div class="hex-label">PPS</div>${hexOf(pps, "id")}`;
    $("n-sps-note").textContent = `SPS: 0x67 header, profile_idc ${sps.prof} (${{ 66: "Baseline", 77: "Main", 122: "High 4:2:2", 244: "High 4:4:4" }[sps.prof]}), level 3.0, ${S.W / 16}×${S.H / 16} macroblocks = ${S.W}×${S.H}, zero B-frames. PPS carries the entropy mode (${S.ent.toUpperCase()}) and the initial QP ${S.qp}. These bytes are generated with real Exp-Golomb syntax.`;
    renderMux(false);
  }
  function muxModel() {
    const E = S.enc, N = S.N, sizes = E.frames.map((f) => frameBytes(f, S.ent) + 4), vid = sizes.reduce((a, b) => a + b, 0), dur = N / S.fps, audio = $("m-audio").checked ? Math.round((128000 / 8) * dur) : 0, sps = nalPlan().sps.bytes.length, pps = nalPlan().pps.length, keys = E.frames.filter((f) => f.type === "I").length;
    const avcc = 8 + 7 + 2 + sps + 1 + 2 + pps, stbl = 8 + (16 + 16 + avcc + 70) + 24 + (16 + 4 * keys) + (20 + 4 * N) + 28 + (16 + 4 * Math.ceil(N / 4)), vtrak = 8 + 92 + 8 + 32 + 33 + 8 + 20 + 36 + stbl, atrak = audio ? 8 + 92 + 8 + 32 + 33 + 8 + 16 + 36 + 160 + 4 * 40 : 0, moov = 8 + 108 + vtrak + atrak, ftyp = 28, mdat = 8 + vid + audio;
    return { sizes, vid, audio, moov, ftyp, mdat, avcc, keys, N, dur, vtrak, atrak, stbl, sps, pps };
  }
  function renderMux(animate) {
    const m = muxModel(), mkv = S.cont === "mkv", fast = $("m-fast").checked, tok = bump("mux");
    const segs = mkv
      ? [["EBML header", 40, "ih"], ["Segment + SeekHead + Info", 120, "sg"], ["Tracks (avcC)", 60 + m.avcc, "sg"], ["Clusters (frames + audio)", m.vid + m.audio + 12 * m.N, "id"], ["Cues (index)", 12 + 12 * m.keys, "ie"]]
      : fast ? [["ftyp", m.ftyp, "sg"], ["moov (index)", m.moov, "ih"], ["mdat (frames + audio)", m.mdat, "id"]] : [["ftyp", m.ftyp, "sg"], ["mdat (frames + audio)", m.mdat, "id"], ["moov (index)", m.moov, "ih"]];
    if (mkv && fast) { const cues = segs.pop(); segs.splice(2, 0, cues); }
    const total = segs.reduce((a, s) => a + s[1], 0), lay = $("m-layout"); lay.replaceChildren(...segs.map(([n, b, cls]) => { const d = document.createElement("div"); d.className = "file-seg " + cls; d.style.flex = `${Math.max(b / total, 0.08)} 0 0`; d.innerHTML = `<span>${n}<small>${fmt(b)}</small></span>`; return d; }));
    const t = (ind, n, s) => `${"  ".repeat(ind)}${n.padEnd(24 - ind * 2)} ${s ? fmt(s) : ""}\n`;
    $("m-tree").textContent = mkv
      ? t(0, "EBML header", 40) + t(0, "Segment", total) + t(1, "SeekHead", 40) + t(1, "Info (duration, timescale)", 50) + t(1, "Tracks", 60 + m.avcc) + t(2, "TrackEntry video  V_MPEG4/ISO/AVC", 30) + t(3, "CodecPrivate = avcC", m.avcc) + (m.audio ? t(2, "TrackEntry audio  A_AAC", 40) : "") + t(1, `Cluster × ${Math.ceil(m.dur)}`, m.vid + m.audio) + t(2, "SimpleBlock = one video frame / audio packet", 0) + t(1, "Cues (keyframe index)", 12 + 12 * m.keys)
      : t(0, "ftyp  " + (S.cont === "mov" ? "'qt  '" : "'isom' 'avc1'"), m.ftyp) + t(0, "moov", m.moov) + t(1, "mvhd (timescale, duration)", 108) + t(1, "trak  video", m.vtrak) + t(2, "mdia → minf → stbl", m.stbl) + t(3, "stsd → avc1 → avcC (SPS + PPS)", m.avcc + 86) + t(3, `stts (frame durations)`, 24) + t(3, `stss (${m.keys} keyframes → seeking)`, 16 + 4 * m.keys) + t(3, `stsz (${m.N} frame sizes)`, 20 + 4 * m.N) + t(3, "stsc / stco (chunk offsets)", 28 + 4 * Math.ceil(m.N / 4)) + (m.audio ? t(1, "trak  audio  (mp4a / esds)", m.atrak) : "") + t(0, "mdat  (raw NAL units, length-prefixed)", m.mdat);
    $("m-note").textContent = `${S.cont.toUpperCase()} file ≈ ${fmt(total)}: video ${fmt(m.vid)}${m.audio ? ` + AAC audio ${fmt(m.audio)} (128 kbps)` : ""} + ${fmt(total - m.vid - m.audio)} of headers/index. ${mkv ? "Cues placement decides how fast seeking can start." : fast ? "faststart: moov sits before mdat, so a web player can begin playback and seek without downloading the whole file." : "moov is written last (the encoder only knows frame sizes at the end), so players must read the tail of the file first."}`;
    const inter = $("m-inter"); inter.replaceChildren(); const items = []; const per = Math.min(m.N, 10);
    for (let i = 0; i < per; i++) { items.push({ k: "v", t: `V${i}`, size: m.sizes[i], key: S.enc.frames[i].type === "I" }); if (m.audio) items.push({ k: "a", t: `A${i}`, size: Math.round(m.audio / m.N) }); }
    const lane = (name, cls) => { const d = document.createElement("div"); d.className = "lane"; d.innerHTML = `<small>${name}</small><div class="lane-in"></div>`; inter.appendChild(d); return d.querySelector(".lane-in"); };
    const vL = lane("video NALs"), aL = m.audio ? lane("AAC audio") : null, oL = lane(mkv ? "Cluster" : "mdat");
    const mkc = (it) => { const s = document.createElement("span"); s.className = `ib ${it.k}${it.key ? " key" : ""}`; s.textContent = it.t; s.title = `${fmt(it.size)}`; s.style.minWidth = `${clamp(it.size / 8, 22, 70)}px`; return s; };
    if (!animate) { items.forEach((it) => { (it.k === "v" ? vL : aL).appendChild(mkc(it)); oL.appendChild(mkc(it)); }); return; }
    (async () => { for (const it of items) { if (tok !== S.a.mux) return; const el = mkc(it); (it.k === "v" ? vL : aL).appendChild(el); await sleep(160); oL.appendChild(mkc(it)); el.classList.add("sent"); await sleep(110); } })();
  }

  // =====================================================================
  //  Real encoder comparison (WebCodecs)
  // =====================================================================
  async function realEncode() {
    const out = $("h-real-out"); if (!("VideoEncoder" in window) || !("VideoFrame" in window)) { out.textContent = "WebCodecs is not available in this browser."; return; }
    try {
      out.textContent = "Encoding with the browser's encoder…"; let bytes = 0, mode = "quantizer";
      const base = { codec: "avc1.42001f", width: S.W, height: S.H, framerate: S.fps };
      let cfg = { ...base, bitrateMode: "quantizer", avc: { format: "annexb" } }, sup = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
      if (!sup.supported) { mode = "bitrate"; cfg = { ...base, bitrate: Math.max(50000, (totalBytes() * 8) / (S.N / S.fps)), avc: { format: "annexb" } }; sup = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false })); if (!sup.supported) { out.textContent = "This browser has no H.264 encoder available."; return; } }
      const enc = new VideoEncoder({ output: (ch) => { bytes += ch.byteLength; }, error: (e) => { out.textContent = "Encoder error: " + e.message; } }); enc.configure(cfg);
      const c = document.createElement("canvas"); c.width = S.W; c.height = S.H; const x = c.getContext("2d");
      for (let i = 0; i < S.N; i++) { x.putImageData(new ImageData(new Uint8ClampedArray(S.raw[i]), S.W, S.H), 0, 0); const vf = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / S.fps) }); enc.encode(vf, mode === "quantizer" ? { keyFrame: i % S.gop === 0, avc: { quantizer: S.qp } } : { keyFrame: i % S.gop === 0 }); vf.close(); }
      await enc.flush(); enc.close();
      out.textContent = `Browser H.264 (${mode === "quantizer" ? `QP ${S.qp}` : "matched bitrate"}): ${fmt(bytes)} · this lab's estimate: ${fmt(totalBytes())}. A production encoder adds quarter-pel motion, B-frames and rate-distortion search, so it usually wins at equal quality.`;
    } catch (e) { out.textContent = "Could not run the real encoder: " + e.message; }
  }

  // =====================================================================
  //  Interaction
  // =====================================================================
  function setFrame(i) { S.F = clamp(i, 0, S.N - 1); $("h-frame").value = S.F; S.edge = null; if (S.enc) renderAll(); }
  function setMb(x, y, b) { S.mb = { x: clamp(x, 0, S.W / 16 - 1), y: clamp(y, 0, S.H / 16 - 1) }; if (b !== undefined) S.blk = b; S.edge = null; renderSteps(); }
  const pt = (canvas, e, w, h) => { const r = canvas.getBoundingClientRect(); return [clamp(Math.floor(((e.clientX - r.left) / r.width) * w), 0, w - 1), clamp(Math.floor(((e.clientY - r.top) / r.height) * h), 0, h - 1)]; };
  function togglePlay() {
    if (!S.enc) return; S.playing = !S.playing; $("h-play").textContent = S.playing ? "❚❚" : "▶";
    clearInterval(S.timer); if (!S.playing) { renderAll(); return; }
    S.timer = setInterval(() => { S.F = (S.F + 1) % S.N; $("h-frame").value = S.F; renderStats(); renderLive(); }, 1000 / Math.min(12, S.fps));
  }
  function bind() {
    const root = $("h264-root"); if (!root || root.dataset.bound) return; root.dataset.bound = "1"; Object.assign(S, { raw: [], N: 0, enc: null, F: 0, qp: 28, gop: 10, range: 8, split: 50, deblock: true, dbofs: 0, ent: "cabac", sub: "420", view: "orig", playing: false });
    $("vid-file").addEventListener("change", (e) => loadVideo(e.target.files[0]));
    $("vid-sample").addEventListener("click", () => { const s = sampleFrames(); msg("Using the animated sample (24 frames)."); setFrames(s.frames, s.W, s.H, 12, "Animated sample"); });
    const slider = (id, key, fmtv, enc) => $(id).addEventListener("input", (e) => { S[key] = +e.target.value; $(id + "-value").textContent = fmtv(S[key]); if (enc) { S.edge = null; schedule(); } });
    slider("h-qp", "qp", (v) => v, true); slider("h-gop", "gop", (v) => v, true); slider("h-range", "range", (v) => "±" + v, true); slider("h-split", "split", (v) => v, true);
    $("h-dbofs").addEventListener("input", (e) => { S.dbofs = +e.target.value; $("h-dbofs-value").textContent = S.dbofs; schedule(); });
    $("h-deblock").addEventListener("change", (e) => { S.deblock = e.target.checked; schedule(); });
    root.querySelectorAll("[data-hsub]").forEach((b) => b.addEventListener("click", () => { S.sub = b.dataset.hsub; root.querySelectorAll("[data-hsub]").forEach((x) => x.classList.toggle("selected", x === b)); schedule(); }));
    root.querySelectorAll("[data-hent]").forEach((b) => b.addEventListener("click", () => { S.ent = b.dataset.hent; root.querySelectorAll("[data-hent]").forEach((x) => x.classList.toggle("selected", x === b)); if (S.enc) renderAll(); }));
    root.querySelectorAll("[data-hview]").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.hview; root.querySelectorAll("[data-hview]").forEach((x) => x.classList.toggle("selected", x === b)); if (S.enc) renderPreView(); }));
    root.querySelectorAll("[data-nalfmt]").forEach((b) => b.addEventListener("click", () => { S.nalfmt = b.dataset.nalfmt; root.querySelectorAll("[data-nalfmt]").forEach((x) => x.classList.toggle("selected", x === b)); if (S.enc) renderPack(); }));
    root.querySelectorAll("[data-cont]").forEach((b) => b.addEventListener("click", () => { S.cont = b.dataset.cont; root.querySelectorAll("[data-cont]").forEach((x) => x.classList.toggle("selected", x === b)); if (S.enc) renderMux(false); }));
    $("m-audio").addEventListener("change", () => S.enc && renderMux(false)); $("m-fast").addEventListener("change", () => S.enc && renderMux(false));
    $("h-frame").addEventListener("input", (e) => setFrame(+e.target.value)); $("h-play").addEventListener("click", togglePlay);
    $("gop-strip"); $("hp-view").addEventListener("click", (e) => { if (!S.enc) return; const [x, y] = pt($("hp-view"), e, S.W, S.H); S.avg = { x, y }; renderAvg(true); });
    const mbPick = (id) => $(id).addEventListener("click", (e) => { if (!S.enc) return; const [x, y] = pt($(id), e, S.W, S.H); setMb(Math.floor(x / 16), Math.floor(y / 16)); });
    ["h1-canvas", "h2-field", "h3-frame"].forEach(mbPick);
    $("h1-zoom").addEventListener("click", (e) => { if (!S.enc) return; const [x, y] = pt($("h1-zoom"), e, 16, 16); S.blk = (y >> 2) * 4 + (x >> 2); S.edge = null; renderSteps(); });
    $("h5-before").addEventListener("click", (e) => { if (!S.enc) return; const [x, y] = pt($("h5-before"), e, S.W, S.H); S.edge = { x: clamp(Math.round(x / 4) * 4, 4, S.W - 4), y }; renderStep5(); });
    $("h6-bits").addEventListener("click", (e) => { if (!S.enc) return; const [x] = pt($("h6-bits"), e, S.N, 1); setFrame(x); });
    $("h1-play").addEventListener("click", playSplit); $("h2-play").addEventListener("click", playSearch); $("h3-play").addEventListener("click", playResidual); $("h4-play").addEventListener("click", playTransform); $("h5-play").addEventListener("click", playDeblock);
    $("h6-cavlc-play").addEventListener("click", () => S.enc && renderBlockCoding(true)); $("h6-cabac-play").addEventListener("click", () => S.enc && playCabac()); $("m-play").addEventListener("click", () => S.enc && renderMux(true)); $("h-real").addEventListener("click", () => S.enc && realEncode());
  }
  let tries = 0;
  window.initH264Lab = () => { if ($("h264-root")) bind(); else if (tries++ < 300) requestAnimationFrame(window.initH264Lab); };
  window.initH264Lab();
})();
