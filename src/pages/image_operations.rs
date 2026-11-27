use dioxus::prelude::*;

#[component]
pub fn ImageOperationsPage() -> Element {
    rsx! {
        script { src: asset!("/assets/js/image_lab.js"), defer: true }

        main { class: "image-lab bg-background text-foreground",
            header { class: "lab-header",
                div { class: "lab-eyebrow", span { class: "eyebrow-dot" } "IMAGE FOUNDATIONS / 01" }
                h1 { "See what pixels can do." }
                p { "Upload an image, inspect its RGB values, then experiment with the operations behind computer vision." }
            }

            section { class: "upload-card", id: "upload-card",
                div { class: "upload-copy",
                    span { class: "section-kicker", "START WITH AN IMAGE" }
                    h2 { "Your image, as numbers" }
                    p { "We decode each pixel into red, green, blue, and alpha values. Your image stays in this browser." }
                    label { class: "upload-button", r#for: "image-upload", "Choose an image" }
                    input { id: "image-upload", r#type: "file", accept: "image/*", hidden: true }
                    span { class: "upload-hint", "PNG, JPEG, WebP · 512 px working copy · saved in IndexedDB" }
                }
                div { class: "upload-preview", id: "upload-preview",
                    div { class: "empty-preview", id: "empty-preview",
                        div { class: "upload-icon", "↑" }
                        strong { "Drop an image here" }
                        span { "or choose a file to begin" }
                    }
                    img { id: "source-image", alt: "Uploaded image preview", class: "source-image hidden" }
                    div { class: "image-meta hidden", id: "image-meta" }
                }
            }

            section { class: "workbench section-block",
                div { class: "section-heading",
                    div { span { class: "section-kicker", "01 / PIXEL CHANNELS" } h2 { "Meet the RGB channels" } }
                p { "Each pixel stores red, green, and blue values from 0 to 255. Toggle channels to zero them in the combined image." }
                }
                div { class: "channel-showcase-layout",
                    div { class: "channel-controls-column",
                        div { class: "channel-grid",
                            ChannelCard { id: "channel-red".to_string(), label: "Red".to_string(), letter: "R".to_string(), color: "red".to_string(), value_id: "red-value".to_string() }
                            ChannelCard { id: "channel-green".to_string(), label: "Green".to_string(), letter: "G".to_string(), color: "green".to_string(), value_id: "green-value".to_string() }
                            ChannelCard { id: "channel-blue".to_string(), label: "Blue".to_string(), letter: "B".to_string(), color: "blue".to_string(), value_id: "blue-value".to_string() }
                        }
                        div { class: "pixel-inspector",
                            div { class: "inspector-title", span { class: "pixel-dot" } "PIXEL INSPECTOR" span { class: "inspector-help", "Hover source or composite · values follow active channels" } }
                            div { class: "pixel-readout", id: "pixel-readout", "R —  G —  B —" }
                            div { class: "pixel-swatch", id: "pixel-swatch" }
                            div { class: "pixel-matrix-wrap",
                                span { class: "pixel-matrix-label", "3 × 3 RGB tensor · disabled channels = 0" }
                                div { class: "pixel-matrix", id: "pixel-matrix" }
                            }
                        }
                    }
                    div { class: "channel-composite-card",
                        div { class: "composite-heading",
                            div { span { class: "section-kicker", "LIVE COMPOSITE" } strong { "Enabled RGB channels" } }
                            span { class: "composite-status", id: "rgb-channel-status", "Waiting for image" }
                        }
                        div { class: "composite-image-wrap",
                            div { class: "composite-empty", id: "rgb-composite-empty", "Upload image to preview channel vectors." }
                            canvas { id: "rgb-composite-canvas", class: "rgb-composite-canvas hidden" }
                        }
                        p { class: "composite-caption", "Turn a channel off to set that color value to 0 for every pixel." }
                    }
                }
            }

            section { class: "section-block operations-block",
                div { class: "section-heading",
                    div { span { class: "section-kicker", "02 / TONE & DETAIL" } h2 { "Grayscale, contrast and sharpness" } }
                    p { "Three operations, chained in this order. Change a control and watch the formula, the curve and the image react together. Hover the image to probe one pixel." }
                }
                div { class: "tone-layout",
                    div { class: "tone-preview",
                        div { class: "result-topline", span { "LIVE RESULT" } span { id: "result-dimensions", "Waiting for image" } }
                        div { class: "tone-pair",
                            canvas { id: "operation-canvas", class: "tone-canvas" }
                        }
                        div { class: "probe-line", id: "tone-probe", "Hover the image to probe a pixel." }
                        button { class: "reset-button", id: "reset-operations", r#type: "button", "Reset operations" }
                    }
                    div { class: "tone-controls",
                        div { class: "control-card",
                            div { class: "control-heading", strong { "1 · Grayscale" } span { class: "control-tag", "WEIGHTED SUM" } }
                            label { class: "toggle-row", input { id: "grayscale-toggle", r#type: "checkbox" } span { "Apply grayscale" } }
                            p { "Each pixel becomes one brightness number: a weighted average of its R, G and B. The weights are normalized so the result never leaves 0–255." }
                            div { class: "choice-row wrap",
                                button { class: "choice-button", r#type: "button", "data-gray": "33,33,33", "Plain average" }
                                button { class: "choice-button", r#type: "button", "data-gray": "30,59,11", "Rec.601" }
                                button { class: "choice-button", r#type: "button", "data-gray": "21,72,7", "Rec.709" }
                                button { class: "choice-button selected", r#type: "button", "data-gray": "28,52,16", "Default" }
                            }
                            Coefficient { label: "Red".to_string(), id: "gray-r".to_string(), value: "28".to_string(), color: "red".to_string() }
                            Coefficient { label: "Green".to_string(), id: "gray-g".to_string(), value: "52".to_string(), color: "green".to_string() }
                            Coefficient { label: "Blue".to_string(), id: "gray-b".to_string(), value: "16".to_string(), color: "blue".to_string() }
                            div { class: "weight-bar", id: "gray-weights" }
                            div { class: "formula-line big", "gray = (wR·R + wG·G + wB·B) / (wR + wG + wB)" }
                            div { class: "formula-line live", id: "gray-live", "" }
                        }
                        div { class: "control-card",
                            div { class: "control-heading", strong { "2 · Contrast" } span { class: "control-tag", "POINT OPERATION" } }
                            p { "Stretch every value away from (or toward) middle gray 128. Values pushed past 0 or 255 are clipped, which destroys detail." }
                            Slider { label: "Contrast".to_string(), id: "contrast".to_string(), min: "50".to_string(), max: "200".to_string(), step: "1".to_string(), value: "100".to_string(), suffix: "%".to_string() }
                            div { class: "formula-line big", "out = clamp( (in − 128) × c + 128 ),   c = slider / 100" }
                            canvas { id: "contrast-curve", class: "curve-canvas", width: "440", height: "220" }
                            div { class: "formula-line live", id: "contrast-live", "" }
                        }
                        div { class: "control-card",
                            div { class: "control-heading", strong { "3 · Sharpness" } span { class: "control-tag", "NEIGHBORS" } }
                            p { "Compare each pixel with its 4 neighbors. A pixel that already differs from its surroundings is pushed further apart, which makes edges look crisper." }
                            Slider { label: "Strength k".to_string(), id: "sharpen".to_string(), min: "0".to_string(), max: "3".to_string(), step: "0.1".to_string(), value: "0".to_string(), suffix: "".to_string() }
                            div { class: "formula-line big", "out = in + k · (4·in − up − down − left − right)" }
                            div { class: "sharp-row",
                                div { class: "sharp-kernel", id: "sharp-kernel" }
                                canvas { id: "sharp-profile", class: "curve-canvas", width: "340", height: "170" }
                            }
                            p { class: "mini-note", "Left: the 3×3 kernel this strength produces (weights sum to 1). Right: a soft edge before and after. The overshoot on both sides is the bright and dark halo of over-sharpened photos." }
                            div { class: "formula-line live", id: "sharpen-live", "" }
                        }
                    }
                }
            }

            section { class: "section-block blur-block",
                div { class: "section-heading",
                    div { span { class: "section-kicker", "03 / BLUR" } h2 { "Five ways to blur" } }
                    p { "Blurring replaces a pixel with a summary of its neighborhood. The summary rule changes everything: what gets smoothed, what survives, what it costs. Hover the image to inspect the neighborhood of one pixel." }
                }
                div { class: "blur-layout",
                    div { class: "blur-image-card",
                        div { class: "result-topline", span { id: "blur-title", "BOX BLUR" } span { id: "blur-dims", "" } }
                        canvas { id: "blur-canvas", class: "blur-canvas" }
                        div { class: "blur-toggles",
                            label { class: "toggle-row", input { id: "blur-compare", r#type: "checkbox" } span { "Show original" } }
                            label { class: "toggle-row", input { id: "blur-noise", r#type: "checkbox" } span { "Add salt-and-pepper noise" } }
                        }
                        div { class: "probe-line", id: "blur-probe", "Hover the image to probe a pixel." }
                    }
                    div { class: "blur-controls",
                        div { class: "choice-row wrap blur-tabs",
                            button { class: "choice-button selected", r#type: "button", "data-blurtype": "box", "Box" }
                            button { class: "choice-button", r#type: "button", "data-blurtype": "gaussian", "Gaussian" }
                            button { class: "choice-button", r#type: "button", "data-blurtype": "median", "Median" }
                            button { class: "choice-button", r#type: "button", "data-blurtype": "bilateral", "Bilateral" }
                            button { class: "choice-button", r#type: "button", "data-blurtype": "motion", "Motion" }
                        }
                        div { class: "control-card",
                            p { class: "blur-desc", id: "blur-desc", "" }
                            div { class: "formula-line big", id: "blur-formula", "" }
                            div { "data-for": "box gaussian median bilateral",
                                Slider { label: "Radius r".to_string(), id: "b-radius".to_string(), min: "1".to_string(), max: "6".to_string(), step: "1".to_string(), value: "2".to_string(), suffix: " px".to_string() }
                            }
                            div { "data-for": "gaussian",
                                Slider { label: "Sigma σ".to_string(), id: "b-sigma".to_string(), min: "0.3".to_string(), max: "6".to_string(), step: "0.1".to_string(), value: "1.5".to_string(), suffix: "".to_string() }
                            }
                            div { "data-for": "bilateral",
                                Slider { label: "Space σs".to_string(), id: "b-sigs".to_string(), min: "0.5".to_string(), max: "6".to_string(), step: "0.1".to_string(), value: "2".to_string(), suffix: "".to_string() }
                                Slider { label: "Color σr".to_string(), id: "b-sigr".to_string(), min: "5".to_string(), max: "120".to_string(), step: "1".to_string(), value: "30".to_string(), suffix: "".to_string() }
                            }
                            div { "data-for": "motion",
                                Slider { label: "Length L".to_string(), id: "b-len".to_string(), min: "3".to_string(), max: "21".to_string(), step: "1".to_string(), value: "11".to_string(), suffix: " px".to_string() }
                                Slider { label: "Angle θ".to_string(), id: "b-angle".to_string(), min: "0".to_string(), max: "180".to_string(), step: "1".to_string(), value: "0".to_string(), suffix: "°".to_string() }
                            }
                        }
                        div { class: "control-card",
                            div { class: "control-heading", strong { id: "blur-viz-title", "Kernel weights" } span { class: "control-tag", id: "blur-viz-tag", "" } }
                            div { class: "blur-viz", id: "blur-viz" }
                            p { class: "mini-note", id: "blur-viz-note", "" }
                        }
                        div { class: "tip-card", id: "blur-tip", "" }
                    }
                }
            }

            section { class: "section-block hsv-block",
                div { class: "section-heading",
                    div { span { class: "section-kicker", "03 / HSV COLOR MODEL" } h2 { "Explore hue, saturation & value" } }
                    p { "HSV describes a color by its hue, vividness, and brightness. Adjust the image and see where those settings sit on the color cone." }
                }
                div { class: "hsv-layout",
                    div { class: "hsv-cone-card",
                        div { class: "hsv-card-heading", strong { "HSV COLOR CONE" } span { class: "control-tag", "H · S · V" } }
                        canvas { id: "hsv-cone", class: "hsv-cone-canvas", width: "420", height: "330" }
                        div { class: "cone-axis-notes",
                            span { "H · angle around cone" }
                            span { "S · center to surface" }
                            span { "V · black tip to top" }
                        }
                        p { class: "cone-caption", "Marker shows current adjustment. Hue wraps around; saturation moves outward; value moves up the cone." }
                    }
                    div { class: "hsv-lab-panel",
                        div { class: "hsv-controls",
                            div { class: "hsv-card-heading", strong { "Adjust the image" } span { id: "hsv-setting-readout", class: "hsv-setting-readout", "ΔH 0° · S 100% · V 100%" } }
                            RangeControl { label: "Hue shift".to_string(), id: "hsv-hue".to_string(), min: "0".to_string(), max: "360".to_string(), value: "0".to_string(), output: "hsv-hue-value".to_string(), suffix: "°".to_string() }
                            RangeControl { label: "Saturation".to_string(), id: "hsv-saturation".to_string(), min: "0".to_string(), max: "200".to_string(), value: "100".to_string(), output: "hsv-saturation-value".to_string(), suffix: "%".to_string() }
                            RangeControl { label: "Value".to_string(), id: "hsv-value".to_string(), min: "0".to_string(), max: "200".to_string(), value: "100".to_string(), output: "hsv-value-value".to_string(), suffix: "%".to_string() }
                        }
                        div { class: "hsv-formulas",
                            div { class: "hsv-formula", strong { "Hue" } code { "H′ = (H + ΔH) mod 360°" } span { "Color angle" } }
                            div { class: "hsv-formula", strong { "Saturation" } code { "S′ = min(1, S × s)" } span { "Color intensity" } }
                            div { class: "hsv-formula", strong { "Value" } code { "V′ = min(1, V × v)" } span { "Brightness" } }
                        }
                        div { class: "hsv-conversion",
                            strong { "RGB → HSV conversion" }
                            code { "Δ = max(R,G,B) − min(R,G,B) · V = max(R,G,B) / 255 · S = Δ / max(R,G,B) (or 0)" }
                            code { "H = 60° × case: R max → ((G−B)/Δ) mod 6 · G max → (B−R)/Δ + 2 · B max → (R−G)/Δ + 4" }
                        }
                        div { class: "hsv-preview-heading", span { "HSV-ADJUSTED IMAGE" } span { "Independent preview" } }
                        canvas { id: "hsv-image-canvas", class: "hsv-image-canvas" }
                        button { class: "reset-button hsv-reset", id: "reset-hsv", r#type: "button", "Reset HSV controls" }
                    }
                }
            }

            section { class: "section-block pooling-block",
                div { class: "section-heading",
                    div { span { class: "section-kicker", "04 / POOLING & STRIDE" } h2 { "See pooling shrink feature maps" } }
                    p { "Move a window across the input. Stride controls each jump; pooling summarizes values inside each window." }
                }
                div { class: "pool-controls",
                    div { class: "pool-mode-control",
                        div { class: "control-heading", strong { "Pooling operation" } span { class: "control-tag", "NO LEARNED WEIGHTS" } }
                        div { class: "choice-row wrap",
                            button { class: "choice-button selected", r#type: "button", "data-pool-kind": "max", "Max pooling" }
                            button { class: "choice-button", r#type: "button", "data-pool-kind": "average", "Average pooling" }
                        }
                    }
                    Slider { label: "Window k".to_string(), id: "pool-k".to_string(), min: "2".to_string(), max: "5".to_string(), step: "1".to_string(), value: "2".to_string(), suffix: " × ".to_string() }
                    Slider { label: "Stride s".to_string(), id: "pool-stride".to_string(), min: "1".to_string(), max: "4".to_string(), step: "1".to_string(), value: "2".to_string(), suffix: " px".to_string() }
                    Slider { label: "Padding p".to_string(), id: "pool-padding".to_string(), min: "0".to_string(), max: "2".to_string(), step: "1".to_string(), value: "0".to_string(), suffix: " px".to_string() }
                    Slider { label: "Animation delay".to_string(), id: "pool-delay".to_string(), min: "0".to_string(), max: "250".to_string(), step: "5".to_string(), value: "20".to_string(), suffix: " ms".to_string() }
                    div { class: "formula-line pool-formula-line", id: "pool-formula", "Y[x,y] = max(X in k × k window)" }
                    button { class: "play-button", id: "play-pooling", r#type: "button", "▶  Build pooled output" }
                }
                div { class: "pool-visuals",
                    div { class: "pool-animation-panel",
                        div { class: "scan-heading", span { id: "pool-input-title", "INPUT + ZERO PADDING" } span { id: "pool-status", "Upload an image" } }
                        div { class: "scan-stage pool-scan-stage",
                            div { class: "pool-matrix-grid", id: "pool-matrix-grid" }
                            div { class: "scan-kernel-overlay pool-window-overlay", id: "pool-window-overlay" }
                        }
                        div { class: "scan-equation", id: "pool-equation", "Select pool type to see its formula." }
                    }
                    div { class: "pool-output-panel",
                        div { class: "output-construction-heading", span { "POOLED OUTPUT · BUILT WINDOW BY WINDOW" } span { id: "pool-progress", "0 / 0" } }
                        div { class: "output-canvas-stage pool-canvas-stage",
                            canvas { id: "pool-output-canvas", class: "pool-output-canvas" }
                            span { class: "output-focus", id: "pool-output-focus" }
                        }
                        div { class: "formula-line dimension-line", id: "pool-dimensions", "Input → output" }
                    }
                }
            }

            section { class: "section-block convolution-block",
                div { class: "section-heading",
                    div { span { class: "section-kicker", "05 / CONVOLUTION METHODS" } h2 { "Watch a filter scan the image" } }
                    p { "Select filter and convolution type. Set kernel geometry, then follow each output window across the input." }
                }
                div { class: "conv-controls-top",
                    div { class: "conv-widget-group",
                        div { class: "control-heading", strong { "Filter" } span { class: "control-tag", id: "kernel-size-tag", "3 × 3" } }
                        div { class: "filter-choices",
                            button { class: "filter-choice active", r#type: "button", "data-kernel": "edge", "Edge detect" }
                            button { class: "filter-choice", r#type: "button", "data-kernel": "sharpen", "Sharpen" }
                            button { class: "filter-choice", r#type: "button", "data-kernel": "blur", "Box blur" }
                            button { class: "filter-choice", r#type: "button", "data-kernel": "emboss", "Emboss" }
                        }
                    }
                    div { class: "conv-widget-group",
                        div { class: "control-heading", strong { "Convolution method" } }
                        div { class: "choice-row wrap conv-type-choices",
                            button { class: "choice-button selected", r#type: "button", "data-conv-type": "normal", "Normal" }
                            button { class: "choice-button", r#type: "button", "data-conv-type": "dilated", "Dilated" }
                            button { class: "choice-button", r#type: "button", "data-conv-type": "transposed", "Transposed" }
                            button { class: "choice-button", r#type: "button", "data-conv-type": "deformable", "Deformable" }
                        }
                    }
                    div { class: "conv-widget-group conv-parameter-grid",
                        Slider { label: "Kernel size k".to_string(), id: "cv-k".to_string(), min: "3".to_string(), max: "7".to_string(), step: "2".to_string(), value: "3".to_string(), suffix: " × ".to_string() }
                        Slider { label: "Stride s".to_string(), id: "cv-stride".to_string(), min: "1".to_string(), max: "4".to_string(), step: "1".to_string(), value: "1".to_string(), suffix: " px".to_string() }
                        Slider { label: "Padding p".to_string(), id: "cv-padding".to_string(), min: "0".to_string(), max: "3".to_string(), step: "1".to_string(), value: "1".to_string(), suffix: " px".to_string() }
                        div { id: "dilation-control",
                            Slider { label: "Dilation d".to_string(), id: "cv-dilation".to_string(), min: "1".to_string(), max: "4".to_string(), step: "1".to_string(), value: "2".to_string(), suffix: " × ".to_string() }
                        }
                        div { id: "deform-control", class: "hidden",
                            Slider { label: "Offset strength".to_string(), id: "cv-offset".to_string(), min: "0".to_string(), max: "4".to_string(), step: "0.5".to_string(), value: "2".to_string(), suffix: " px".to_string() }
                        }
                        Slider { label: "Animation delay".to_string(), id: "cv-delay".to_string(), min: "0".to_string(), max: "250".to_string(), step: "5".to_string(), value: "20".to_string(), suffix: " ms".to_string() }
                    }
                    div { class: "conv-widget-group conv-kernel-info",
                        div { class: "kernel-display", id: "kernel-display" }
                        div { class: "formula-line", id: "kernel-formula", "Y = Σ X × W" }
                        p { class: "kernel-description", id: "kernel-description", "Edge detection responds strongly where brightness changes." }
                        p { class: "cnn-note", id: "conv-explainer", "CNNs learn kernel weights during training." }
                        div { class: "formula-line dimension-line", id: "conv-dimensions", "Input → padding → output" }
                        div { class: "formula-line dimension-line", id: "conv-size-formula", "output size = floor((N + 2p − k) / s) + 1" }
                    }
                    button { class: "play-button conv-run-button", id: "play-convolution", r#type: "button", "▶  Build output live" }
                }
                div { class: "conv-walkthrough",
                    div { class: "conv-animation-panel",
                        div { class: "scan-heading", span { id: "conv-input-title", "INPUT + ZERO PADDING" } span { id: "scan-status", "Upload an image" } }
                        div { class: "scan-stage conv-scan-stage",
                            div { class: "matrix-grid", id: "matrix-grid" }
                            div { class: "scan-kernel-overlay", id: "scan-kernel-overlay",
                                div { class: "kernel-sample-points", id: "kernel-sample-points" }
                            }
                        }
                        div { class: "scan-equation", id: "scan-equation", "Choose a filter to see its pixel equation." }
                    }
                    div { class: "conv-output-panel",
                        div { class: "output-construction-heading", span { id: "conv-output-label", "FILTERED OUTPUT IMAGE" } span { id: "conv-progress", "0 / 0" } }
                        div { class: "output-canvas-stage conv-canvas-stage",
                            canvas { id: "convolution-canvas", class: "convolution-canvas conv-output-canvas" }
                            span { class: "output-focus", id: "conv-output-focus" }
                        }
                        div { class: "scan-legend", span { span { class: "legend-swatch input-swatch" } "Input / zero padding" } span { span { class: "legend-swatch output-swatch" } "Computed output pixels" } }
                    }
                }
            }

            footer { class: "lab-footer", "Your experiments are saved on this device. Clear browser data to remove the saved image." }
        }
    }
}

#[component]
fn ChannelCard(id: String, label: String, letter: String, color: String, value_id: String) -> Element {
    rsx! {
        button { class: "channel-card active {color}", id: "{id}", r#type: "button", "data-channel": "{color}",
            div { class: "channel-card-top", span { class: "channel-letter", "{letter}" } span { class: "channel-state", "ON" } }
            strong { "{label} channel" }
            div { class: "channel-preview" }
            div { class: "channel-value", "Mean intensity " span { id: "{value_id}", "—" } }
        }
    }
}

#[component]
fn Coefficient(label: String, id: String, value: String, color: String) -> Element {
    rsx! {
        label { class: "coefficient-row {color}", r#for: "{id}",
            span { class: "coefficient-label", "{label}" }
            input { id: "{id}", r#type: "range", min: "0", max: "100", value: "{value}", "data-coefficient": "true" }
            output { id: "{id}-value", "{value}%" }
        }
    }
}

#[component]
fn RangeControl(label: String, id: String, min: String, max: String, value: String, output: String, suffix: String) -> Element {
    rsx! {
        label { class: "range-row", r#for: "{id}",
            span { class: "range-label", "{label}" }
            input { id: "{id}", r#type: "range", min: "{min}", max: "{max}", value: "{value}" }
            output { id: "{output}", "{value}{suffix}" }
        }
    }
}

#[component]
fn Slider(label: String, id: String, min: String, max: String, step: String, value: String, suffix: String) -> Element {
    rsx! {
        label { class: "range-row", r#for: "{id}",
            span { class: "range-label", "{label}" }
            input { id: "{id}", r#type: "range", min: "{min}", max: "{max}", step: "{step}", value: "{value}", "data-own": "1", "data-suffix": "{suffix}" }
            output { id: "{id}-value", "{value}{suffix}" }
        }
    }
}
