# Learn CV With Me

Interactive, browser-based lessons that make computer vision and media compression easier to understand. The app uses Rust and Dioxus for its interface, with JavaScript demos for pixel and codec operations.

## Lessons

- **Image operations** (`/image-operations`): inspect RGB channels and pixel values; experiment with grayscale, contrast, sharpening, blur, and HSV; then explore filters, convolution methods, padding, stride, and max or average pooling with a live window walkthrough.
- **Image formats** (`/image-formats`): explore JPEG color conversion, transform and quantization, plus PNG filtering, chunks, checksums, and file output.
- **Video formats** (`/video-formats`): follow a simplified H.264 encoding pipeline, inspect its intermediate results, and compare its size estimate with the browser's WebCodecs encoder when available.

Image and video demonstrations run in the browser. Image Operations saves the latest uploaded image in IndexedDB on the current device.

## Run locally

Requirements: Rust toolchain and [Dioxus CLI](https://dioxuslabs.com/learn/0.7/getting_started/).

```sh
dx serve
```

Open the local address printed by Dioxus CLI. To check the Rust project:

```sh
cargo check
```

## Project layout

```text
src/                 Dioxus routes, pages, layouts, and components
assets/styles/       Application and component stylesheets
assets/js/           Interactive image and video lesson engines
assets/images/       Logo and other images
assets/icons/        App icon
tailwind.css         Tailwind input; Dioxus writes output to assets/styles/tailwind.css
```

Routes are declared in `src/lib.rs`. Tailwind input and output paths are configured in `Dioxus.toml`.
