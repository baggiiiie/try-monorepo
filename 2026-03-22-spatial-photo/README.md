# Spatial photo desktop viewer

A small full-stack prototype that turns an iPhone spatial photo into a subtle desktop parallax viewer.

## What it does

1. Upload a single iPhone spatial `.HEIC` file.
2. The Node server extracts the image payloads from the HEIC container.
3. The server prepares a depth map.
   - Preferred path: normalize Apple’s embedded auxiliary depth/disparity map when it exists.
   - Fallback path: estimate a coarse relative disparity map from the extracted stereo pair in TypeScript.
4. The React + three.js client renders a single-image depth warp with gentle pointer-driven motion.

This is intentionally **not** a Vision Pro clone. The goal is a tasteful monoscopic “spatial photo” feel in a normal browser.

## Project structure

```text
/server
  /src
    /routes
    /services
    /types
/client
  /src
    /api
    /components
    /three
    /types
```

## Architecture summary

### Server

- **Express + TypeScript** API.
- `POST /api/process` accepts a single file upload.
- `AppleHeicExtractor` isolates HEIC extraction behind a clean adapter.
- `imagePipeline.ts` converts extracted images into browser-friendly PNGs and downsizes them for local iteration.
- `depthEstimator.ts`
  - normalizes embedded aux depth when present
  - otherwise runs a lightweight stereo block-matching fallback
- Processed assets are served from `/processed/:id/...`.

### Client

- **React + Vite + TypeScript**.
- Upload panel, control panel, and a three.js viewer.
- The viewer uses a custom shader on a single plane.
- Pointer movement drives a tiny virtual camera offset.
- The shader shifts UVs using the depth texture and blends a few nearby samples to soften edge artifacts.

## Shader approach

The renderer uses one base color texture plus one grayscale depth texture.

For each fragment:

1. Sample normalized depth.
2. Convert pointer position into a small motion vector.
3. Offset the base image UV by `motion * depth`.
4. Clamp UVs to stay stable.
5. Blend nearby taps around the warped UV to reduce streaking and disocclusion artifacts.

This keeps the effect conservative and better suited to a laptop screen.

## Setup

### Requirements

- Node.js 20+
- npm 10+
- `heif-convert` available on your `PATH`
  - macOS/Homebrew: `brew install libheif`

Optional but useful sample file in this repo:

- `example-photo.HEIC`

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

That starts:

- server: `http://localhost:8787`
- client: `http://localhost:5173`

### Production-ish local build

```bash
npm run build
npm run start -w server
```

Then open `http://localhost:8787`.
The server will serve the built client from `client/dist` when that folder exists.

## How to use

1. Open the client in the browser.
2. Upload an iPhone spatial `.HEIC` file.
3. Wait for processing.
4. Move the pointer slowly over the viewer.
5. Adjust:
   - depth strength
   - motion amount
   - edge smoothing
6. Use debug toggles to inspect the base image or depth map.

## Extraction and dependency assumptions

- Extraction is intentionally isolated behind `SpatialPhotoExtractor` / `AppleHeicExtractor`.
- Current implementation assumes `heif-convert --with-aux` can decode Apple spatial HEIC files and emit:
  - a primary image
  - two secondary images that form the stereo pair
  - an auxiliary depth image when present
- This is practical for local prototyping, but not guaranteed to handle every Apple HEIC variant.
- If extraction behavior changes, only the extractor module should need significant changes.

## Known limitations

- The app prefers embedded Apple aux depth when available, so the sample looks better than the stereo fallback path.
- The stereo fallback is a lightweight block matcher, not a production-quality stereo pipeline.
- Disocclusion holes and edge halos can still appear, especially with strong motion.
- Rendering is monoscopic only.
- No WebXR / VR support.
- No persistence, auth, or multi-photo management.
- The current local workflow depends on `heif-convert` being installed on the machine.

## Next steps

- Swap the fallback stereo matcher for a stronger disparity estimator.
- Add optional confidence masking / bilateral smoothing.
- Improve inpainting around foreground edges.
- Cache and manage processed assets more cleanly.
- Optionally serve the built client from the server for a single-command local launch.

## End-of-task summary

### 1. Short architecture summary

- **Server**: upload -> HEIC extraction -> base/depth preparation -> processed asset URLs
- **Client**: upload UI -> processing states -> three.js depth-warp viewer -> tuning controls
- **Boundary**: extractor is isolated so Apple-specific parsing can be replaced later

### 2. Setup / run instructions

```bash
brew install libheif
npm install
npm run dev
```

Then open `http://localhost:5173` and upload a spatial `.HEIC` file.

### 3. Known limitations

- Best results currently come from Apple’s embedded aux depth when available.
- Fallback stereo depth is intentionally simple.
- Artifact handling is conservative, not perfect.
- This is a local prototype, not a hardened production app.
