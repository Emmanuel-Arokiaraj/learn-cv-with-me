use dioxus::prelude::*;

#[component]
pub fn VideoFormatsPage() -> Element {
    use_effect(move || {
        document::eval("window.initH264Lab && window.initH264Lab();");
    });

    rsx! {
        document::Stylesheet { href: asset!("/assets/styles/jpeg_lab.css") }
        document::Stylesheet { href: asset!("/assets/styles/h264_lab.css") }
        script { src: asset!("/assets/js/h264_lab.js"), defer: true }

        main { class: "image-lab jpeg-lab h264-lab", id: "h264-root",
            header { class: "lab-header",
                div { class: "lab-eyebrow", span { class: "eyebrow-dot" } "VIDEO FORMATS / 01 · H.264 (AVC)" }
                h1 { "How H.264 shrinks video." }
                p { "Upload a short clip and watch a working, simplified H.264 encoder process it: color conversion, macroblocks, intra and inter prediction, residuals, integer transform, quantization, deblocking, entropy coding, and finally packaging into a file. Everything runs in your browser." }
            }

            // ---------- Upload ----------
            section { class: "upload-card jpeg-source",
                div { class: "upload-copy",
                    span { class: "section-kicker", "START WITH A CLIP" }
                    h2 { "Upload a short video" }
                    p { "Use a clip shorter than 10 seconds and smaller than 2 MB. Frames are sampled and shrunk to about 160 px wide so the encoder stays fast. Nothing leaves your browser." }
                    div { class: "jpeg-actions",
                        label { class: "upload-button", r#for: "vid-file", "Choose a video" }
                        button { class: "choice-button", id: "vid-sample", r#type: "button", "Use animated sample" }
                    }
                    input { id: "vid-file", r#type: "file", accept: "video/*", hidden: true }
                    span { class: "upload-hint", id: "vid-meta", "Max 10 s · max 2 MB" }
                    div { class: "vid-msg", id: "vid-msg", "" }
                    div { class: "vid-bar", i { id: "vid-bar" } }
                }
                div { class: "upload-preview jpeg-preview",
                    canvas { id: "vid-thumb", class: "jpeg-canvas" }
                }
            }

            // ---------- Sticky dials ----------
            section { class: "jpeg-dials h264-dials",
                div { class: "dial-group",
                    label { class: "dial", r#for: "h-qp",
                        span { class: "dial-label", "QP" }
                        input { id: "h-qp", r#type: "range", min: "0", max: "51", value: "28" }
                        output { id: "h-qp-value", "28" }
                    }
                    label { class: "dial", r#for: "h-gop",
                        span { class: "dial-label", "GOP length" }
                        input { id: "h-gop", r#type: "range", min: "1", max: "30", value: "10" }
                        output { id: "h-gop-value", "10" }
                    }
                    label { class: "dial", r#for: "h-range",
                        span { class: "dial-label", "Search range" }
                        input { id: "h-range", r#type: "range", min: "2", max: "16", value: "8" }
                        output { id: "h-range-value", "±8" }
                    }
                    label { class: "dial", r#for: "h-split",
                        span { class: "dial-label", "Split eagerness" }
                        input { id: "h-split", r#type: "range", min: "0", max: "100", value: "50" }
                        output { id: "h-split-value", "50" }
                    }
                    div { class: "dial",
                        span { class: "dial-label", "Chroma" }
                        div { class: "choice-row tight",
                            button { class: "choice-button", r#type: "button", "data-hsub": "444", "4:4:4" }
                            button { class: "choice-button", r#type: "button", "data-hsub": "422", "4:2:2" }
                            button { class: "choice-button selected", r#type: "button", "data-hsub": "420", "4:2:0" }
                        }
                    }
                    div { class: "dial",
                        span { class: "dial-label", "Entropy / Loop" }
                        div { class: "choice-row tight",
                            button { class: "choice-button", r#type: "button", "data-hent": "cavlc", "CAVLC" }
                            button { class: "choice-button selected", r#type: "button", "data-hent": "cabac", "CABAC" }
                            label { class: "toggle-row inline", input { id: "h-deblock", r#type: "checkbox", checked: true } span { "Deblock" } }
                        }
                    }
                    div { class: "dial",
                        span { class: "dial-label", "Frame" }
                        div { class: "frame-scrub",
                            button { class: "choice-button", id: "h-play", r#type: "button", "▶" }
                            input { id: "h-frame", r#type: "range", min: "0", max: "0", value: "0" }
                            output { id: "h-frame-value", "0" }
                        }
                    }
                }
                div { class: "stat-strip",
                    Stat { id: "hs-raw".to_string(), label: "RAW".to_string() }
                    Stat { id: "hs-h264".to_string(), label: "H.264 (EST.)".to_string() }
                    Stat { id: "hs-ratio".to_string(), label: "RATIO".to_string() }
                    Stat { id: "hs-psnr".to_string(), label: "PSNR".to_string() }
                    Stat { id: "hs-rate".to_string(), label: "BITRATE".to_string() }
                }
            }

            // ---------- Live ----------
            section { class: "section-block",
                SectionHead { kicker: "LIVE RESULT".to_string(), title: "Original vs decoded".to_string(),
                    text: "The center image is exactly what a decoder rebuilds from the compressed data. The error map is amplified ×6. Press play on the frame control to watch the whole clip.".to_string() }
                div { class: "compare-grid",
                    figure { class: "plate", canvas { id: "hc-orig", class: "jpeg-canvas" } figcaption { "Original" } }
                    figure { class: "plate", canvas { id: "hc-dec", class: "jpeg-canvas" } figcaption { id: "hc-info", "Decoded" } }
                    figure { class: "plate", canvas { id: "hc-err", class: "jpeg-canvas" } figcaption { "Error ×6 (luma)" } }
                }
                div { class: "gop-strip", id: "gop-strip" }
                div { class: "real-row",
                    button { class: "choice-button", id: "h-real", r#type: "button", "Compare with browser's real H.264 encoder (WebCodecs)" }
                    span { id: "h-real-out", class: "muted-note", "" }
                }
            }

            // ---------- Part 1: pre-processing ----------
            section { class: "section-block", id: "h-pre",
                SectionHead { kicker: "PART 1 / PRE-PROCESSING".to_string(), title: "RGB → YUV and chroma subsampling".to_string(),
                    text: "Before H.264 starts, RGB pixels become luma (Y, brightness, kept at full resolution) and chroma (Cb, Cr, color). Eyes are far more sensitive to brightness than color, so chroma is shrunk. 4:2:0 keeps one chroma sample per 2×2 pixels: 75% less color data and half the total bytes.".to_string() }
                div { class: "formula-grid",
                    div { class: "formula-card y", strong { "Luma  Y" } code { "Y = 0.299R + 0.587G + 0.114B" } span { "Weighted brightness (BT.601). Real video usually rescales to the 16–235 range; this lab keeps the full 0–255 range." } }
                    div { class: "formula-card cb", strong { "Chroma  Cb" } code { "Cb = 128 − 0.169R − 0.331G + 0.5B" } span { "Blue difference. Subsampled." } }
                    div { class: "formula-card cr", strong { "Chroma  Cr" } code { "Cr = 128 + 0.5R − 0.419G − 0.081B" } span { "Red difference. Subsampled." } }
                }
                div { class: "plane-grid",
                    figure { class: "plate", canvas { id: "hp-y", class: "jpeg-canvas pixelated" } figcaption { id: "hp-y-cap", "Y" } }
                    figure { class: "plate", canvas { id: "hp-cb", class: "jpeg-canvas pixelated" } figcaption { id: "hp-cb-cap", "Cb" } }
                    figure { class: "plate", canvas { id: "hp-cr", class: "jpeg-canvas pixelated" } figcaption { id: "hp-cr-cap", "Cr" } }
                }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "Sample grid" } span { class: "control-tag", id: "hp-tag", "" } }
                        div { class: "sample-grid", id: "hp-grid" }
                        div { class: "bytes-bars", id: "hp-bars" }
                        div { class: "formula-line", id: "hp-formula", "" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "What the eye keeps" } span { class: "control-tag", "VIEW" } }
                        div { class: "choice-row wrap",
                            button { class: "choice-button selected", r#type: "button", "data-hview": "orig", "Original" }
                            button { class: "choice-button", r#type: "button", "data-hview": "luma", "Luma only" }
                            button { class: "choice-button", r#type: "button", "data-hview": "chroma", "Chroma only" }
                            button { class: "choice-button", r#type: "button", "data-hview": "sub", "After subsampling" }
                        }
                        canvas { id: "hp-view", class: "jpeg-canvas pick", title: "Click to average a chroma block" }
                        div { class: "avg-demo", id: "hp-avg" }
                    }
                }
            }

            // ---------- Part 2 intro ----------
            section { class: "section-block", id: "h-loop",
                SectionHead { kicker: "PART 2 / THE COMPRESSION LOOP".to_string(), title: "Six steps, every frame".to_string(),
                    text: "Each frame runs through the same loop. The loop contains a decoder, because predictions must use the pictures the decoder will actually have, not the pristine originals. Click a macroblock on any picture below to follow it through every step.".to_string() }
                div { class: "loop-diagram", id: "loop-diagram",
                    div { class: "ld", "data-step": "1", strong { "1" } span { "Partition" } }
                    div { class: "ld-arrow", "→" }
                    div { class: "ld", "data-step": "2", strong { "2" } span { "Predict" } }
                    div { class: "ld-arrow", "→" }
                    div { class: "ld", "data-step": "3", strong { "3" } span { "Residual" } }
                    div { class: "ld-arrow", "→" }
                    div { class: "ld", "data-step": "4", strong { "4" } span { "Transform + Quantize" } }
                    div { class: "ld-arrow", "→" }
                    div { class: "ld", "data-step": "5", strong { "5" } span { "Deblock" } }
                    div { class: "ld-arrow", "→" }
                    div { class: "ld", "data-step": "6", strong { "6" } span { "Entropy code" } }
                }
                div { class: "loop-return", "decoded frame goes back as the reference for the next frame's prediction ↺" }
            }

            // ---------- Step 1 ----------
            section { class: "section-block", id: "h-s1",
                SectionHead { kicker: "STEP 1 / PARTITIONING".to_string(), title: "Macroblocks and adaptive splitting".to_string(),
                    text: "The frame is cut into 16×16 macroblocks. A block with a uniform, well-predicted area stays whole; a block with detail or complicated motion is split into 8×8 and then 4×4 pieces so each piece can be predicted separately. Raise Split eagerness above to split more.".to_string() }
                div { class: "two-col wide-left",
                    div { class: "panel",
                        div { class: "panel-head", strong { "Partition map" } span { class: "control-tag", id: "h1-tag", "" } }
                        canvas { id: "h1-canvas", class: "jpeg-canvas pick" }
                        div { class: "legend-row", span { class: "lg p16", "16×16" } span { class: "lg p8", "8×8" } span { class: "lg p4", "4×4" } span { class: "lg mbsel", "selected MB" } }
                        div { class: "muted-note", id: "h1-stats", "" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { id: "h1-title", "Macroblock" } button { class: "play-button inline", id: "h1-play", r#type: "button", "▶ Split" } }
                        canvas { id: "h1-zoom", class: "jpeg-canvas pick pixelated mbzoom", title: "Click a 4×4 block" }
                        div { class: "formula-line", id: "h1-note", "" }
                    }
                }
            }

            // ---------- Step 2 ----------
            section { class: "section-block", id: "h-s2",
                SectionHead { kicker: "STEP 2 / PREDICTION".to_string(), title: "Guess the block from what is already known".to_string(),
                    text: "Intra prediction (I-frames, new objects) extrapolates a block from the pixel edges of already-decoded neighbors in the same frame. Inter prediction (P/B frames) searches a previous frame for a similar block and stores only the displacement, a motion vector.".to_string() }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "Intra prediction · 4×4 modes" } span { class: "control-tag", id: "h2-intra-tag", "" } }
                    div { class: "intra-row",
                        div { class: "intra-ctx", canvas { id: "h2-ctx", class: "mini-canvas big pixelated" } span { class: "mini-cap", "neighbors (top row, left column) + block" } }
                        div { class: "intra-modes", id: "h2-modes" }
                    }
                    div { class: "formula-line", id: "h2-intra-note", "" }
                }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "Inter prediction · motion search" } button { class: "play-button inline", id: "h2-play", r#type: "button", "▶ Search" } }
                    div { class: "inter-row",
                        div { class: "inter-col", span { class: "mini-cap", "reference frame (search window)" } canvas { id: "h2-ref", class: "jpeg-canvas pixelated" } }
                        div { class: "inter-col", span { class: "mini-cap", "current frame" } canvas { id: "h2-cur", class: "jpeg-canvas pixelated" } }
                        div { class: "inter-col narrow", span { class: "mini-cap", "SAD at every candidate" } canvas { id: "h2-sad", class: "mini-canvas big pixelated sadmap" } div { class: "muted-note", id: "h2-sad-text", "" } }
                    }
                    div { class: "formula-line", "SAD(dx,dy) = Σx Σy | cur(x,y) − ref(x+dx, y+dy) |      best motion vector = argmin SAD      stored: MVD = MV − predicted MV" }
                    div { class: "two-col",
                        figure { class: "plate", canvas { id: "h2-field", class: "jpeg-canvas pick" } figcaption { "Motion vector field (all macroblocks)" } }
                        div { class: "muted-note", id: "h2-inter-note", "" }
                    }
                }
            }

            // ---------- Step 3 ----------
            section { class: "section-block", id: "h-s3",
                SectionHead { kicker: "STEP 3 / RESIDUAL".to_string(), title: "Subtract the prediction".to_string(),
                    text: "Only the leftover difference between the real block and the prediction is kept. A good prediction leaves a residual near zero, which needs far fewer bits than the original pixels.".to_string() }
                div { class: "formula-line big", "residual(x,y) = original(x,y) − prediction(x,y)        decoder:  reconstructed = prediction + decoded residual" }
                div { class: "resid-row",
                    figure { class: "plate", canvas { id: "h3-actual", class: "mini-canvas big pixelated mbc" } figcaption { "Original MB" } }
                    div { class: "op-sign", "−" }
                    figure { class: "plate", canvas { id: "h3-pred", class: "mini-canvas big pixelated mbc" } figcaption { "Prediction" } }
                    div { class: "op-sign", "=" }
                    figure { class: "plate", canvas { id: "h3-resid", class: "mini-canvas big pixelated mbc" } figcaption { "Residual (gray = 0)" } }
                    button { class: "play-button inline", id: "h3-play", r#type: "button", "▶ Subtract" }
                }
                div { class: "two-col",
                    figure { class: "plate", canvas { id: "h3-frame", class: "jpeg-canvas pick" } figcaption { "Residual of the whole frame (gray = nothing left to code)" } }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Selected 4×4 block" } span { class: "control-tag", id: "h3-tag", "" } }
                        div { class: "tri-mx",
                            div { span { class: "mini-cap", "original" } div { class: "mx four", id: "h3-mx-a" } }
                            div { span { class: "mini-cap", "prediction" } div { class: "mx four", id: "h3-mx-p" } }
                            div { span { class: "mini-cap", "residual" } div { class: "mx four", id: "h3-mx-r" } }
                        }
                        div { class: "muted-note", id: "h3-stats", "" }
                    }
                }
            }

            // ---------- Step 4 ----------
            section { class: "section-block", id: "h-s4",
                SectionHead { kicker: "STEP 4 / TRANSFORM + QUANTIZATION".to_string(), title: "Integer transform, then the QP knob".to_string(),
                    text: "H.264 uses a 4×4 integer approximation of the DCT: only additions, subtractions and shifts. Quantization then divides each coefficient by a step size set by QP. The step doubles every 6 QP, so every +6 roughly halves the bitrate. Rounding to zero here is where quality is lost.".to_string() }
                div { class: "formula-line big", "W = Cf · X · Cfᵀ,   Cf = [1 1 1 1 ; 2 1 −1 −2 ; 1 −1 −1 1 ; 1 −2 2 −1]        Z = round( W · MF / 2^(15 + ⌊QP/6⌋) )        Qstep(QP) = 0.625 · 2^(QP/6)" }
                div { class: "q-info", id: "h4-qinfo", "" }
                div { class: "pipe-mx",
                    div { span { class: "mini-cap", "residual X" } div { class: "mx four", id: "h4-x" } }
                    div { class: "op-sign sm", "→ Cf·X·Cfᵀ →" }
                    div { span { class: "mini-cap", "coefficients W" } div { class: "mx four", id: "h4-w" } }
                    div { class: "op-sign sm", "→ ÷ Qstep →" }
                    div { span { class: "mini-cap", "levels Z" } div { class: "mx four", id: "h4-z" } }
                    div { class: "op-sign sm", "→ × Qstep →" }
                    div { span { class: "mini-cap", "dequantized" } div { class: "mx four", id: "h4-d" } }
                    div { class: "op-sign sm", "→ inverse →" }
                    div { span { class: "mini-cap", "residual X′" } div { class: "mx four", id: "h4-r" } }
                }
                div { class: "real-row",
                    button { class: "play-button inline", id: "h4-play", r#type: "button", "▶ Run the block through" }
                    span { class: "muted-note", id: "h4-note", "" }
                }
                div { class: "compare-grid",
                    figure { class: "plate", canvas { id: "h4-recon", class: "jpeg-canvas" } figcaption { id: "h4-recon-cap", "Reconstruction (before deblocking)" } }
                    figure { class: "plate", div { class: "qs-chart", id: "h4-chart" } figcaption { "Qstep vs QP: doubles every 6" } }
                    figure { class: "plate", canvas { id: "h4-zmap", class: "jpeg-canvas pixelated" } figcaption { id: "h4-zmap-cap", "Non-zero levels per 4×4 block" } }
                }
            }

            // ---------- Step 5 ----------
            section { class: "section-block", id: "h-s5",
                SectionHead { kicker: "STEP 5 / IN-LOOP DEBLOCKING".to_string(), title: "Smooth the block seams".to_string(),
                    text: "Coarse quantization leaves visible steps along 4×4 and 8×8 block borders. The deblocking filter smooths an edge only when the step is small enough to be a compression artifact (below α) rather than a real edge. The filtered frame becomes the reference for future frames, so encoder and decoder must do it identically.".to_string() }
                div { class: "formula-line big", "filter only if  |p0 − q0| < α(QP)  and  |p1 − p0| < β(QP)  and  |q1 − q0| < β(QP)        Δ = clip( −tc, tc, ((q0 − p0)·4 + (p1 − q1) + 4) >> 3 )        p0′ = p0 + Δ,  q0′ = q0 − Δ" }
                label { class: "range-row wide db-ofs", r#for: "h-dbofs",
                    span { class: "range-label", "α/β offset" }
                    input { id: "h-dbofs", r#type: "range", min: "-6", max: "6", value: "0" }
                    output { id: "h-dbofs-value", "0" }
                }
                div { class: "compare-grid",
                    figure { class: "plate", canvas { id: "h5-before", class: "jpeg-canvas pick" } figcaption { "Before deblocking (click a vertical edge)" } }
                    figure { class: "plate", canvas { id: "h5-after", class: "jpeg-canvas" } figcaption { "After deblocking" } }
                    figure { class: "plate", canvas { id: "h5-diff", class: "jpeg-canvas" } figcaption { "What the filter changed ×8" } }
                }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "Pixels across one edge" } button { class: "play-button inline", id: "h5-play", r#type: "button", "▶ Filter" } }
                    canvas { id: "h5-profile", class: "profile-canvas", width: "760", height: "190" }
                    div { class: "formula-line", id: "h5-calc", "" }
                    div { class: "muted-note", id: "h5-stats", "" }
                }
            }

            // ---------- Step 6 ----------
            section { class: "section-block", id: "h-s6",
                SectionHead { kicker: "STEP 6 / ENTROPY CODING".to_string(), title: "Lossless packing: CAVLC vs CABAC".to_string(),
                    text: "Quantized levels, motion vector differences and block headers are written as bits. CAVLC uses variable-length code tables chosen by context. CABAC models each binary decision with an adaptive probability and encodes it by narrowing an arithmetic-coding interval, using fractions of a bit per decision, which is why it saves about 10–15%. Sizes here come from simplified models of both coders.".to_string() }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "Bits per frame" } span { class: "control-tag", id: "h6-tag", "" } }
                    canvas { id: "h6-bits", class: "bits-canvas", width: "900", height: "190" }
                    div { class: "legend-row", span { class: "lg bhdr", "headers" } span { class: "lg bmv", "motion vectors" } span { class: "lg bres", "residual levels" } }
                    div { class: "muted-note", id: "h6-cmp", "" }
                }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "CAVLC · selected 4×4 block" } button { class: "play-button inline", id: "h6-cavlc-play", r#type: "button", "▶ Encode" } }
                        div { class: "strip-label", "levels in zig-zag order" }
                        div { class: "strip", id: "h6-scan" }
                        div { class: "cavlc-list", id: "h6-cavlc" }
                        div { class: "bitstream", id: "h6-cavlc-bits" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "CABAC · same block" } button { class: "play-button inline", id: "h6-cabac-play", r#type: "button", "▶ Encode" } }
                        div { class: "cabac-bins", id: "h6-bins" }
                        canvas { id: "h6-interval", class: "interval-canvas", width: "520", height: "74" }
                        div { class: "muted-note", id: "h6-cabac-note", "" }
                    }
                }
            }

            // ---------- Part 3 ----------
            section { class: "section-block", id: "h-pack",
                SectionHead { kicker: "PART 3 / PACKAGING".to_string(), title: "NAL units and the container".to_string(),
                    text: "Step 6 outputs a raw stream of NAL units: small packets, each with a header byte. A muxer then wraps that stream, together with audio such as AAC, into a file (MP4, MKV, MOV) that adds timing, an index for seeking, and track descriptions.".to_string() }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "NAL units of this clip" } div { class: "choice-row tight",
                            button { class: "choice-button selected", r#type: "button", "data-nalfmt": "annexb", "Annex B" }
                            button { class: "choice-button", r#type: "button", "data-nalfmt": "avcc", "MP4 (length)" }
                        } }
                        div { class: "nal-list", id: "n-list" }
                        div { class: "formula-line", id: "n-hdr", "" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Real SPS bytes" } span { class: "control-tag", "sequence parameter set" } }
                        div { class: "hexdump mono", id: "n-sps" }
                        div { class: "muted-note", id: "n-sps-note", "" }
                    }
                }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "Muxer" }
                        div { class: "btn-pair",
                            div { class: "choice-row tight",
                                button { class: "choice-button selected", r#type: "button", "data-cont": "mp4", ".mp4" }
                                button { class: "choice-button", r#type: "button", "data-cont": "mkv", ".mkv" }
                                button { class: "choice-button", r#type: "button", "data-cont": "mov", ".mov" }
                            }
                            label { class: "toggle-row inline", input { id: "m-audio", r#type: "checkbox", checked: true } span { "AAC audio" } }
                            label { class: "toggle-row inline", input { id: "m-fast", r#type: "checkbox" } span { "faststart" } }
                            button { class: "play-button inline", id: "m-play", r#type: "button", "▶ Mux" }
                        }
                    }
                    div { class: "interleave", id: "m-inter" }
                    div { class: "file-layout", id: "m-layout" }
                    div { class: "box-tree mono", id: "m-tree" }
                    div { class: "muted-note", id: "m-note", "" }
                }
                div { class: "hw-card",
                    strong { "Hardware note" }
                    span { "Phones, laptops and cameras contain a dedicated encoder block that performs steps 1 and 2 (the expensive motion search and prediction) in real time at a fraction of the power a CPU would need. That is why recording 4K video does not flatten your battery as software encoding would." }
                }
            }

            footer { class: "lab-footer", "This is a teaching encoder: integer-pel motion vectors, I and P frames only, a simplified deblocking threshold table and estimated entropy-coder costs. The 4×4 integer transform, quantization math, intra modes, SAD motion search and NAL/SPS syntax follow the standard. The WebCodecs button gives a real encoder's size for comparison." }
        }
    }
}

#[component]
fn SectionHead(kicker: String, title: String, text: String) -> Element {
    rsx! {
        div { class: "section-heading",
            div { span { class: "section-kicker", "{kicker}" } h2 { "{title}" } }
            p { "{text}" }
        }
    }
}

#[component]
fn Stat(id: String, label: String) -> Element {
    rsx! {
        div { class: "stat",
            span { class: "stat-label", "{label}" }
            strong { id: "{id}", "—" }
        }
    }
}
