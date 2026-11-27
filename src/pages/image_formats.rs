use dioxus::prelude::*;

#[component]
pub fn ImageFormatsPage() -> Element {
    // Script is deferred and may already be loaded when we navigate back here,
    // so ask it to (re)bind to the freshly rendered DOM.
    use_effect(move || {
        document::eval("window.initJpegLab && window.initJpegLab(); window.initPngLab && window.initPngLab();");
    });

    rsx! {
        document::Stylesheet { href: asset!("/assets/styles/jpeg_lab.css") }
        script { src: asset!("/assets/js/jpeg_lab.js"), defer: true }
        document::Stylesheet { href: asset!("/assets/styles/png_lab.css") }
        script { src: asset!("/assets/js/png_lab.js"), defer: true }

        main { class: "image-lab jpeg-lab", id: "jpeg-root",
            header { class: "lab-header",
                div { class: "lab-eyebrow", span { class: "eyebrow-dot" } "IMAGE FORMATS / 01 · JPEG" }
                h1 { "How a JPEG is made." }
                p { "Follow one image through the whole baseline JPEG encoder: color transform, 8×8 blocks, DCT, quantization, zig-zag scan and entropy coding. Every number below is computed live from your pixels." }
                a { class: "jump-link", href: "#png-root", "Jump to PNG ↓" }
            }

            // ---------- Source ----------
            section { class: "upload-card jpeg-source",
                div { class: "upload-copy",
                    span { class: "section-kicker", "START WITH AN IMAGE" }
                    h2 { "Pick pixels to compress" }
                    p { "Upload a photo or use the built-in sample. A 256 px working copy is encoded in your browser, nothing is uploaded." }
                    div { class: "jpeg-actions",
                        label { class: "upload-button", r#for: "jpeg-upload", "Choose an image" }
                        button { class: "choice-button", id: "jpeg-sample", r#type: "button", "Use sample" }
                    }
                    input { id: "jpeg-upload", r#type: "file", accept: "image/*", hidden: true }
                    span { class: "upload-hint", id: "jpeg-meta", "Sample image loaded" }
                }
                div { class: "upload-preview jpeg-preview",
                    canvas { id: "src-canvas", class: "jpeg-canvas" }
                }
            }

            // ---------- Sticky dials ----------
            section { class: "jpeg-dials",
                div { class: "dial-group",
                    label { class: "dial", r#for: "q-quality",
                        span { class: "dial-label", "Quality" }
                        input { id: "q-quality", r#type: "range", min: "1", max: "100", value: "50" }
                        output { id: "q-quality-value", "50" }
                    }
                    label { class: "dial", r#for: "q-chroma",
                        span { class: "dial-label", "Chroma squeeze" }
                        input { id: "q-chroma", r#type: "range", min: "1", max: "6", step: "0.5", value: "1" }
                        output { id: "q-chroma-value", "1×" }
                    }
                    div { class: "dial",
                        span { class: "dial-label", "Subsampling" }
                        div { class: "choice-row tight",
                            button { class: "choice-button", r#type: "button", "data-sub": "444", "4:4:4" }
                            button { class: "choice-button", r#type: "button", "data-sub": "422", "4:2:2" }
                            button { class: "choice-button selected", r#type: "button", "data-sub": "420", "4:2:0" }
                        }
                    }
                }
                div { class: "stat-strip",
                    Stat { id: "stat-raw".to_string(), label: "RAW RGB".to_string() }
                    Stat { id: "stat-jpeg".to_string(), label: "JPEG (EST.)".to_string() }
                    Stat { id: "stat-ratio".to_string(), label: "RATIO".to_string() }
                    Stat { id: "stat-bpp".to_string(), label: "BITS / PIXEL".to_string() }
                    Stat { id: "stat-psnr".to_string(), label: "PSNR".to_string() }
                }
            }

            // ---------- Live result ----------
            section { class: "section-block",
                SectionHead { kicker: "LIVE RESULT".to_string(), title: "Original vs decoded".to_string(),
                    text: "Move the dials above. The right image is what a decoder reproduces from the compressed data. The error map shows where information was thrown away (amplified ×6).".to_string() }
                div { class: "compare-grid",
                    figure { class: "plate", canvas { id: "cmp-orig", class: "jpeg-canvas" } figcaption { "Original" } }
                    figure { class: "plate", canvas { id: "cmp-out", class: "jpeg-canvas" } figcaption { "Decoded JPEG" } }
                    figure { class: "plate", canvas { id: "cmp-err", class: "jpeg-canvas" } figcaption { "Error ×6" } }
                }
                div { class: "real-row",
                    button { class: "choice-button", id: "real-jpeg", r#type: "button", "Compare with browser JPEG encoder" }
                    span { id: "real-jpeg-out", class: "muted-note", "" }
                }
            }

            // ---------- Step 1: color ----------
            section { class: "section-block", id: "s-color",
                SectionHead { kicker: "STEP 1 / COLOR SPACE".to_string(), title: "RGB → YCbCr".to_string(),
                    text: "Eyes resolve brightness far better than color. JPEG splits each pixel into luminance (Y, how bright) and two chrominance channels (Cb, Cr, how far from gray toward blue and red) so color can be stored coarsely.".to_string() }
                div { class: "formula-grid",
                    div { class: "formula-card y",
                        strong { "Luminance  Y" }
                        code { "Y  =  0.299 R + 0.587 G + 0.114 B" }
                        span { "Weighted brightness. Green counts most because the eye is most sensitive to it." }
                    }
                    div { class: "formula-card cb",
                        strong { "Chrominance  Cb" }
                        code { "Cb = 128 − 0.1687 R − 0.3313 G + 0.5 B" }
                        span { "Blue minus luminance. 128 means no blue tint." }
                    }
                    div { class: "formula-card cr",
                        strong { "Chrominance  Cr" }
                        code { "Cr = 128 + 0.5 R − 0.4187 G − 0.0813 B" }
                        span { "Red minus luminance. 128 means no red tint." }
                    }
                }
                div { class: "plane-grid",
                    figure { class: "plate", canvas { id: "pl-y", class: "jpeg-canvas" } figcaption { "Y · detail lives here" } }
                    figure { class: "plate", canvas { id: "pl-cb", class: "jpeg-canvas" } figcaption { "Cb · smooth, blurry" } }
                    figure { class: "plate", canvas { id: "pl-cr", class: "jpeg-canvas" } figcaption { "Cr · smooth, blurry" } }
                }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "What does the eye keep?" } span { class: "control-tag", "VIEW" } }
                        div { class: "choice-row wrap",
                            button { class: "choice-button selected", r#type: "button", "data-view": "orig", "Original" }
                            button { class: "choice-button", r#type: "button", "data-view": "luma", "Luma only" }
                            button { class: "choice-button", r#type: "button", "data-view": "chroma", "Chroma only" }
                            button { class: "choice-button", r#type: "button", "data-view": "sub", "Subsampled chroma" }
                        }
                        canvas { id: "color-view", class: "jpeg-canvas pick", title: "Click a pixel" }
                        p { class: "muted-note", id: "view-note", "Click a pixel to run the conversion on it. Try “Subsampled chroma”: the picture still looks sharp because Y is untouched." }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "One pixel, step by step" } button { class: "choice-button", id: "px-replay", r#type: "button", "↻ Replay" } }
                        div { class: "px-swatch-row", div { class: "px-swatch", id: "px-swatch" } span { id: "px-pos", class: "mono", "" } }
                        div { class: "px-calc", id: "px-calc" }
                    }
                }
            }

            // ---------- Step 2: blocks ----------
            section { class: "section-block", id: "s-blocks",
                SectionHead { kicker: "STEP 2 / BLOCKS".to_string(), title: "Split into 8×8 and level shift".to_string(),
                    text: "Each channel is cut into 8×8 tiles (edges are padded by repeating the border pixel). Then 128 is subtracted from every value so samples are centered on zero, which is what the cosine transform expects.".to_string() }
                div { class: "two-col wide-left",
                    div { class: "panel",
                        div { class: "panel-head", strong { "Pick a block" } span { class: "control-tag", id: "blk-info", "" } }
                        div { class: "choice-row",
                            button { class: "choice-button selected", r#type: "button", "data-chan": "Y", "Y" }
                            button { class: "choice-button", r#type: "button", "data-chan": "Cb", "Cb" }
                            button { class: "choice-button", r#type: "button", "data-chan": "Cr", "Cr" }
                        }
                        div { class: "blk-stage", canvas { id: "blk-canvas", class: "jpeg-canvas pick" } }
                        p { class: "muted-note", id: "blk-pad-note", "" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Level shift:  f(x,y) − 128" } button { class: "play-button inline", id: "blk-play", r#type: "button", "▶ Play" } }
                        div { class: "matrix-wrap", div { class: "mx", id: "blk-matrix" } }
                        div { class: "formula-line", id: "blk-status", "Values 0…255 become −128…127." }
                        div { class: "hist-box",
                            canvas { id: "hist-canvas", width: "480", height: "110" }
                            div { class: "hist-axis", span { id: "hist-l", "0" } span { id: "hist-m", "128" } span { id: "hist-r", "255" } }
                        }
                        div { class: "vector-line mono", id: "blk-vector", "" }
                    }
                }
            }

            // ---------- Step 3: DCT ----------
            section { class: "section-block", id: "s-dct",
                SectionHead { kicker: "STEP 3 / DCT".to_string(), title: "Pixels become frequencies".to_string(),
                    text: "Any 8×8 block is a weighted sum of 64 fixed cosine patterns. The DCT finds the weights. Smooth areas need only a few low-frequency patterns; the many high-frequency weights are tiny. That sparsity is what makes compression possible.".to_string() }
                div { class: "formula-line big", "F(u,v) = ¼ · C(u) · C(v) · Σx Σy  f(x,y) · cos[(2x+1)uπ / 16] · cos[(2y+1)vπ / 16]      C(0)=1/√2, otherwise 1" }
                div { class: "three-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "Shifted block f(x,y)" } span { class: "control-tag", "SPACE" } }
                        div { class: "matrix-wrap", div { class: "mx small", id: "dct-in" } }
                        canvas { id: "dct-block-img", class: "mini-canvas" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Coefficients F(u,v)" } span { class: "control-tag", "FREQUENCY" } }
                        div { class: "matrix-wrap", div { class: "mx small", id: "dct-out" } }
                        p { class: "muted-note", "Top-left is DC: 8 × the block average. Moving right = more horizontal detail, down = more vertical detail." }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "64 cosine patterns" } span { class: "control-tag", "BASIS" } }
                        div { class: "basis-grid", id: "basis-grid" }
                        p { class: "muted-note", "Click a pattern to compute its coefficient." }
                    }
                }
                div { class: "panel calc-panel",
                    div { class: "panel-head",
                        strong { id: "dct-title", "Computing F(0,0)" }
                        button { class: "play-button inline", id: "dct-play", r#type: "button", "▶ Animate sum" }
                    }
                    div { class: "calc-row",
                        div { class: "calc-col", span { class: "mini-cap", "basis(u,v)" } canvas { id: "basis-large", class: "mini-canvas big" } }
                        div { class: "calc-col", span { class: "mini-cap", "f(x,y) × basis(x,y)" } div { class: "mx small", id: "dct-products" } }
                        div { class: "calc-col sum", span { class: "mini-cap", "running sum" } div { class: "sum-num mono", id: "dct-sum", "0" } div { class: "muted-note", id: "dct-final", "" } }
                    }
                }
                div { class: "panel calc-panel",
                    div { class: "panel-head",
                        strong { "Rebuild from the first N coefficients (zig-zag order)" }
                        span { class: "control-tag", id: "keep-label", "N = 64" }
                    }
                    label { class: "range-row wide", r#for: "dct-keep",
                        span { class: "range-label", "Keep" }
                        input { id: "dct-keep", r#type: "range", min: "1", max: "64", value: "64" }
                        output { id: "dct-keep-value", "64" }
                    }
                    div { class: "compare-grid four",
                        figure { class: "plate", canvas { id: "rb-block-orig", class: "mini-canvas big" } figcaption { "Block original" } }
                        figure { class: "plate", canvas { id: "rb-block-new", class: "mini-canvas big" } figcaption { "Block from N" } }
                        figure { class: "plate", canvas { id: "rb-image", class: "jpeg-canvas" } figcaption { "Whole image, no quantization" } }
                    }
                }
            }

            // ---------- Step 4: quantization ----------
            section { class: "section-block", id: "s-quant",
                SectionHead { kicker: "STEP 4 / QUANTIZATION".to_string(), title: "The lossy step".to_string(),
                    text: "Each coefficient is divided by an entry of a quantization table and rounded to an integer. Table entries grow toward the bottom-right, so high frequencies (which the eye barely notices) round to zero. Rounding cannot be undone.".to_string() }
                div { class: "formula-line big", "Q(u,v) = round( F(u,v) / T(u,v) )          decode:  F′(u,v) = Q(u,v) × T(u,v)          scale s = 5000/quality (q<50), 200 − 2·quality (q≥50),  T = ⌊(T₅₀·s + 50)/100⌋" }
                div { class: "three-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "F(u,v)" } span { class: "control-tag", "INPUT" } }
                        div { class: "matrix-wrap", div { class: "mx small", id: "q-in" } }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "T(u,v)" } span { class: "control-tag", id: "q-table-tag", "LUMA TABLE" } }
                        div { class: "matrix-wrap", div { class: "mx small", id: "q-table" } }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Q(u,v)" } button { class: "play-button inline", id: "q-play", r#type: "button", "▶ Divide" } }
                        div { class: "matrix-wrap", div { class: "mx small", id: "q-out" } }
                        p { class: "muted-note", id: "q-zero-note", "" }
                    }
                }
                div { class: "compare-grid",
                    figure { class: "plate", canvas { id: "q-img", class: "jpeg-canvas" } figcaption { "Decoded after quantization" } }
                    figure { class: "plate", canvas { id: "q-survive", class: "jpeg-canvas pixelated" } figcaption { id: "q-survive-cap", "How often each coefficient survives" } }
                    figure { class: "plate", canvas { id: "q-tablemap", class: "jpeg-canvas pixelated" } figcaption { "Table strength (brighter = coarser)" } }
                }
            }

            // ---------- Step 5: zigzag ----------
            section { class: "section-block", id: "s-zigzag",
                SectionHead { kicker: "STEP 5 / ZIG-ZAG".to_string(), title: "Flatten, low frequency first".to_string(),
                    text: "Reading row by row mixes low and high frequencies. Walking diagonally from the top-left visits coefficients in roughly decreasing importance, so the zeros pile up in one long tail that costs almost nothing to store.".to_string() }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head",
                            strong { "Quantized block" }
                            div { class: "btn-pair",
                                button { class: "play-button inline", id: "zz-play", r#type: "button", "▶ Play" }
                                button { class: "choice-button", id: "zz-reset", r#type: "button", "Reset" }
                            }
                        }
                        div { class: "zz-stage",
                            div { class: "mx zz", id: "zz-matrix" }
                            svg { id: "zz-svg", class: "zz-svg", view_box: "0 0 400 400",
                                path { id: "zz-path", fill: "none" }
                                circle { id: "zz-dot", r: "9" }
                            }
                        }
                        label { class: "range-row wide", r#for: "zz-speed",
                            span { class: "range-label", "Speed" }
                            input { id: "zz-speed", r#type: "range", min: "1", max: "10", value: "5" }
                            output { id: "zz-speed-value", "5" }
                        }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Output vector" } span { class: "control-tag", id: "zz-tag", "" } }
                        div { class: "strip-label", "zig-zag order" }
                        div { class: "strip", id: "zz-strip" }
                        div { class: "strip-label", "plain row-by-row order" }
                        div { class: "strip faint", id: "zz-raster" }
                        p { class: "muted-note", id: "zz-note", "" }
                    }
                }
            }

            // ---------- Step 6: entropy ----------
            section { class: "section-block", id: "s-entropy",
                SectionHead { kicker: "STEP 6 / ENTROPY CODING".to_string(), title: "Lossless packing into bits".to_string(),
                    text: "Three tricks squeeze the integers losslessly: DPCM stores the DC value as a difference from the previous block, run-length coding replaces zero runs with (run, size) pairs, and Huffman coding gives frequent symbols short bit codes.".to_string() }

                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "A · DPCM on DC values" } button { class: "play-button inline", id: "dpcm-play", r#type: "button", "▶ Animate" } }
                    div { class: "formula-line", "DIFF(k) = DC(k) − DC(k−1)      neighboring blocks have similar averages, so differences are small and cheap" }
                    div { class: "dpcm-grid", id: "dpcm-grid" }
                    div { class: "muted-note", id: "dpcm-note", "" }
                }

                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "B · Run-length coding of AC values" } button { class: "play-button inline", id: "rle-play", r#type: "button", "▶ Animate" } }
                    div { class: "formula-line", "each non-zero AC → (RUN of zeros before it, SIZE = bits of |value|) + amplitude bits      16 zeros = ZRL (15,0)      all remaining zeros = EOB (0,0)" }
                    div { class: "rle-list", id: "rle-list" }
                }

                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "C · Huffman coding" } button { class: "play-button inline", id: "huff-play", r#type: "button", "▶ Build bitstream" } }
                    div { class: "formula-line", "symbols that appear often get short codes, rare ones get long codes      code table built from this image's own symbol statistics" }
                    div { class: "two-col wide-left",
                        div { class: "huff-table", id: "huff-table" }
                        div {
                            div { class: "strip-label", "bitstream for this block" }
                            div { class: "bitstream", id: "bitstream" }
                            div { class: "bit-total mono", id: "bit-total", "" }
                        }
                    }
                }

                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "D · Resulting file layout" } span { class: "control-tag", "JFIF" } }
                    div { class: "file-layout", id: "file-layout" }
                    p { class: "muted-note", id: "file-note", "" }
                }
            }

            footer { class: "lab-footer", "Sizes are computed from real quantized coefficients and an image-specific Huffman table, so they track what a baseline encoder produces within a few percent. Decoding uses an exact inverse DCT." }
        }

        main { class: "image-lab png-lab", id: "png-root",
            header { class: "lab-header",
                div { class: "lab-eyebrow", span { class: "eyebrow-dot" } "IMAGE FORMATS / 02 · PNG" }
                h1 { "How a PNG is made." }
                p { "PNG is lossless: every pixel comes back exactly. The encoder only rearranges bytes so they compress better, squeezes them with zlib, and wraps the result in checksummed chunks. Same image as above, real bytes, real file." }
            }

            // ---------- dials ----------
            section { class: "jpeg-dials png-dials",
                div { class: "dial-group",
                    div { class: "dial",
                        span { class: "dial-label", "Row filter" }
                        div { class: "choice-row tight wrap",
                            button { class: "choice-button", r#type: "button", "data-pfilter": "0", "None" }
                            button { class: "choice-button", r#type: "button", "data-pfilter": "1", "Sub" }
                            button { class: "choice-button", r#type: "button", "data-pfilter": "2", "Up" }
                            button { class: "choice-button", r#type: "button", "data-pfilter": "3", "Avg" }
                            button { class: "choice-button", r#type: "button", "data-pfilter": "4", "Paeth" }
                            button { class: "choice-button selected", r#type: "button", "data-pfilter": "auto", "Adaptive" }
                        }
                    }
                    div { class: "dial",
                        span { class: "dial-label", "Compression" }
                        div { class: "choice-row tight",
                            button { class: "choice-button selected", r#type: "button", "data-pcomp": "deflate", "DEFLATE" }
                            button { class: "choice-button", r#type: "button", "data-pcomp": "stored", "Stored (none)" }
                        }
                    }
                    div { class: "dial",
                        span { class: "dial-label", "Resolution" }
                        div { class: "choice-row tight",
                            button { class: "choice-button", r#type: "button", "data-pres": "32", "32" }
                            button { class: "choice-button", r#type: "button", "data-pres": "64", "64" }
                            button { class: "choice-button selected", r#type: "button", "data-pres": "128", "128" }
                            button { class: "choice-button", r#type: "button", "data-pres": "256", "256" }
                        }
                    }
                    label { class: "dial", r#for: "p-bits",
                        span { class: "dial-label", "Bits / channel" }
                        input { id: "p-bits", r#type: "range", min: "1", max: "8", step: "1", value: "8" }
                        output { id: "p-bits-value", "8" }
                    }
                }
                div { class: "stat-strip",
                    Stat { id: "pstat-raw".to_string(), label: "RAW RGB".to_string() }
                    Stat { id: "pstat-filt".to_string(), label: "FILTERED".to_string() }
                    Stat { id: "pstat-idat".to_string(), label: "IDAT".to_string() }
                    Stat { id: "pstat-file".to_string(), label: "PNG FILE".to_string() }
                    Stat { id: "pstat-ratio".to_string(), label: "RATIO".to_string() }
                }
            }

            // ---------- Step 1: scanlines ----------
            section { class: "section-block", id: "p-scan",
                SectionHead { kicker: "STEP 1 / SCANLINES".to_string(), title: "Flatten rows, prepend a filter byte".to_string(),
                    text: "Each row of W pixels becomes W × 3 bytes: R, G, B, R, G, B … A single filter-type byte (0–4) is put in front of every row, so each row grows to W × 3 + 1 bytes. Click the picture to choose which 6×5 pixel window to inspect.".to_string() }
                div { class: "two-col wide-left",
                    div { class: "panel",
                        div { class: "panel-head", strong { "Working image" } span { class: "control-tag", id: "png-dims", "" } }
                        canvas { id: "png-src", class: "jpeg-canvas pick pixelated" }
                        p { class: "muted-note", "The yellow box is the 6×5 pixel window shown on the right." }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Rows as bytes" } button { class: "play-button inline", id: "scan-play", r#type: "button", "▶ Flatten" } }
                        div { class: "png-scan", id: "png-scan" }
                        div { class: "formula-line", id: "scan-formula", "" }
                    }
                }
            }

            // ---------- Step 2: filtering ----------
            section { class: "section-block", id: "p-filter",
                SectionHead { kicker: "STEP 2 / FILTERING".to_string(), title: "Predict each byte, store the error".to_string(),
                    text: "A filter predicts every byte from bytes already seen and stores only the difference, modulo 256. In smooth areas the difference is near 0, and long runs of near-identical bytes compress far better. Neighbors are taken channel by channel: a = left pixel's same channel (3 bytes back), b = pixel above, c = above-left. Outside the image they count as 0.".to_string() }
                div { class: "filter-cards",
                    div { class: "formula-card y", strong { "0 · None" } code { "Filt(x) = Raw(x)" } span { "Bytes stored unchanged." } }
                    div { class: "formula-card cb", strong { "1 · Sub" } code { "Filt(x) = Raw(x) − a" } span { "Good for horizontal gradients." } }
                    div { class: "formula-card cr", strong { "2 · Up" } code { "Filt(x) = Raw(x) − b" } span { "Good for vertical structure and repeated rows." } }
                    div { class: "formula-card y", strong { "3 · Average" } code { "Filt(x) = Raw(x) − ⌊(a + b) / 2⌋" } span { "Blend of left and up." } }
                    div { class: "formula-card cb", strong { "4 · Paeth" } code { "p = a + b − c ; pick nearest of a, b, c to p" } span { "Best general predictor on photos." } }
                }
                div { class: "formula-line big", "stored byte = (Raw(x) − Predictor) & 0xFF      decoder reverses it:  Raw(x) = (Filt(x) + Predictor) & 0xFF" }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "One byte, five predictions" } button { class: "play-button inline", id: "filt-play", r#type: "button", "▶ Walk the row" } }
                        div { class: "neigh-grid", id: "neigh-grid" }
                        div { class: "filter-table", id: "filter-table" }
                        div { class: "formula-line", id: "paeth-calc", "" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Row result" } span { class: "control-tag", id: "filt-row-tag", "" } }
                        div { class: "strip-label", "raw bytes" }
                        div { class: "strip", id: "filt-raw-strip" }
                        div { class: "strip-label", "filtered bytes" }
                        div { class: "strip", id: "filt-out-strip" }
                        div { class: "strip-label", "sum of |signed residual| for this whole row (lower = better)" }
                        div { class: "score-bars", id: "score-bars" }
                        p { class: "muted-note", "Adaptive mode applies the minimum-sum heuristic recommended by the PNG spec: try all five on each row and keep the smallest sum." }
                    }
                }
                div { class: "compare-grid",
                    figure { class: "plate", canvas { id: "png-filtered-view", class: "jpeg-canvas pixelated" } figcaption { "Filtered bytes drawn as an image (gray = 0 error)" } }
                    figure { class: "plate", canvas { id: "png-filter-map", class: "jpeg-canvas pixelated" } figcaption { "Filter chosen per row" } }
                    figure { class: "plate",
                        div { class: "cmp-box", id: "filter-compare" }
                        button { class: "choice-button", id: "filter-compare-run", r#type: "button", "Compress with every filter" }
                        figcaption { "Final IDAT size by filter" }
                    }
                }
            }

            // ---------- Step 3: deflate ----------
            section { class: "section-block", id: "p-deflate",
                SectionHead { kicker: "STEP 3 / ZLIB + DEFLATE".to_string(), title: "LZ77, Huffman, Adler-32".to_string(),
                    text: "The filtered stream goes through zlib: a 2-byte header, a DEFLATE body, and a 4-byte Adler-32 checksum. DEFLATE first replaces repeats with back-references (LZ77), then gives frequent symbols short codes (Huffman).".to_string() }
                div { class: "three-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "zlib header" } span { class: "control-tag", "2 BYTES" } }
                        div { class: "hdr-bytes mono", id: "zlib-hdr" }
                        div { class: "formula-line", id: "zlib-formula", "" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Adler-32" } button { class: "play-button inline", id: "adler-play", r#type: "button", "▶ Compute" } }
                        div { class: "formula-line", "A = 1 + Σ byte  (mod 65521)      B = Σ A  (mod 65521)      Adler = B · 65536 + A" }
                        div { class: "adler-table", id: "adler-table" }
                        div { class: "muted-note", id: "adler-note", "" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Stored vs DEFLATE" } span { class: "control-tag", "THIS IMAGE" } }
                        div { class: "cmp-box", id: "deflate-compare" }
                    }
                }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "LZ77 sliding window" } button { class: "play-button inline", id: "lz-play", r#type: "button", "▶ Compress sample" } }
                    div { class: "formula-line", "at each position find the longest earlier match inside the window:  emit literal(byte)  or  match(length 3–258, distance 1–32768)" }
                    label { class: "range-row wide", r#for: "lz-window",
                        span { class: "range-label", "Window" }
                        input { id: "lz-window", r#type: "range", min: "4", max: "256", step: "4", value: "128" }
                        output { id: "lz-window-value", "128 B" }
                    }
                    label { class: "range-row wide", r#for: "lz-len",
                        span { class: "range-label", "Sample" }
                        input { id: "lz-len", r#type: "range", min: "40", max: "240", step: "10", value: "120" }
                        output { id: "lz-len-value", "120 B" }
                    }
                    div { class: "lz-bytes", id: "lz-bytes" }
                    div { class: "lz-tokens", id: "lz-tokens" }
                    div { class: "muted-note", id: "lz-note", "" }
                }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "Huffman coding of the tokens" } span { class: "control-tag", id: "hf-tag", "" } }
                    div { class: "formula-line", "frequent symbols get short bit codes, rare ones long codes (prefix-free).  Real DEFLATE sends the code lengths in the block header; this view builds the codes for the sample above." }
                    div { class: "huff-table", id: "png-huff" }
                    div { class: "muted-note", id: "hf-note", "" }
                }
            }

            // ---------- Step 4: chunks ----------
            section { class: "section-block", id: "p-chunks",
                SectionHead { kicker: "STEP 4 / CHUNKS".to_string(), title: "Wrap the data in chunks".to_string(),
                    text: "Every chunk is: 4-byte length (big-endian) · 4-byte ASCII type · data · 4-byte CRC-32 over type + data. A PNG needs IHDR first, one or more IDAT, and IEND last.".to_string() }
                div { class: "chunk-anatomy",
                    div { class: "ca len", strong { "LENGTH" } span { "4 bytes · data size only" } }
                    div { class: "ca typ", strong { "TYPE" } span { "4 ASCII letters" } }
                    div { class: "ca dat", strong { "DATA" } span { "length bytes" } }
                    div { class: "ca crc", strong { "CRC-32" } span { "covers TYPE + DATA" } }
                }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "IHDR · 13 data bytes" } button { class: "play-button inline", id: "ihdr-play", r#type: "button", "▶ Fill fields" } }
                        div { class: "ihdr-table", id: "ihdr-table" }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "CRC-32 of IHDR" } button { class: "play-button inline", id: "crc-play", r#type: "button", "▶ Compute" } }
                        div { class: "formula-line", "crc = 0xFFFFFFFF;  for each byte:  crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8);   result = crc ^ 0xFFFFFFFF      polynomial 0xEDB88320 (reflected)" }
                        div { class: "crc-stream", id: "crc-stream" }
                        div { class: "crc-reg mono", id: "crc-reg", "" }
                    }
                }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "All three chunks of this file" } span { class: "control-tag", "IHDR · IDAT · IEND" } }
                    div { class: "chunk-list", id: "chunk-list" }
                }
            }

            // ---------- Step 5: assemble ----------
            section { class: "section-block", id: "p-file",
                SectionHead { kicker: "STEP 5 / FILE".to_string(), title: "Signature, then chunks, then done".to_string(),
                    text: "The file starts with an 8-byte signature chosen to catch common transfer corruption, followed by IHDR, IDAT and IEND. Nothing else is required.".to_string() }
                div { class: "sig-row", id: "sig-row" }
                div { class: "panel entropy-panel",
                    div { class: "panel-head", strong { "Assemble the file" } button { class: "play-button inline", id: "asm-play", r#type: "button", "▶ Assemble" } }
                    div { class: "file-layout", id: "png-layout" }
                    div { class: "hexdump mono", id: "hexdump" }
                    div { class: "muted-note", id: "png-file-note", "" }
                }
                div { class: "two-col",
                    div { class: "panel",
                        div { class: "panel-head", strong { "Decoded by your browser" } span { class: "control-tag", id: "png-verify-tag", "" } }
                        img { id: "png-real", class: "png-real", alt: "Encoded PNG" }
                        div { class: "real-row",
                            a { id: "png-download", class: "play-button inline", download: "learn-cv.png", "Download this PNG" }
                        }
                    }
                    div { class: "panel",
                        div { class: "panel-head", strong { "Lossless check" } span { class: "control-tag", "ROUND TRIP" } }
                        div { class: "formula-line big", id: "png-verify", "Decoding…" }
                        p { class: "muted-note", "The file is decoded by the browser's own PNG decoder and every pixel is compared with the bytes this lab started from. Try lowering Bits / channel: that changes the input pixels first (fewer colors), the PNG still reproduces them exactly." }
                    }
                }
            }

            footer { class: "lab-footer", "The PNG above is a real, valid file produced by this page: filters and chunks are written byte by byte in JavaScript, and DEFLATE uses your browser's zlib. LZ77 and Huffman views on the sample are simplified explanations of what that compressor does." }
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
