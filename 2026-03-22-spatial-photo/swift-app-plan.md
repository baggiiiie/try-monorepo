# Spatial Photo Viewer — Native Swift App Plan

## Goal

Replace the web upload flow with a native iOS app that reads spatial photos directly via PhotoKit, extracts stereo + depth data on-device, and renders interactive motion parallax — no server needed.

## Why Native

Mobile Safari converts HEIC → JPEG on upload, stripping all spatial data (stereo pair, embedded depth). A native app uses PhotoKit to access the original HEIC container with all auxiliary images intact.

---

## Architecture

```
┌─────────────────────────────────────┐
│           SwiftUI Shell             │
│  ┌───────────┐  ┌────────────────┐  │
│  │ PHPicker   │  │ Parallax View  │  │
│  │ (import)   │  │ (Metal/SceneKit│  │
│  └─────┬─────┘  └───────▲────────┘  │
│        │                │           │
│  ┌─────▼────────────────┴────────┐  │
│  │     SpatialPhotoProcessor     │  │
│  │  - CIImage / ImageIO          │  │
│  │  - AVDepthData                │  │
│  │  - Stereo pair extraction     │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Screens

1. **Library** — Grid of spatial photos from the user's photo library (filtered to `PHAsset.mediaSubtypes.spatialMedia`).
2. **Viewer** — Full-screen parallax viewer driven by device motion (gyroscope) or touch.

## Key Components

### 1. Photo Import (`SpatialPhotoLibrary`)

- Use `PHPickerViewController` or `PHFetchOptions` filtered to spatial photos.
- Request the original HEIC data via `PHAssetResource` with `.photo` type — this preserves the full HEIC container.
- No transcoding, no data loss.

### 2. HEIC Extraction (`SpatialPhotoProcessor`)

Extract layers from the HEIC container using Apple frameworks (no `heif-convert` needed):

| Layer | API |
|---|---|
| Primary image | `CIImage` / `CGImageSource` |
| Depth map | `AVDepthData` from image aux data (`kCGImageAuxiliaryDataTypeDisparity` / `kCGImageAuxiliaryDataTypeDepth`) |
| Stereo pair | `CGImageSourceCopyAuxiliaryDataInfoAtIndex` with stereo auxiliary data type, or read secondary image from the HEIC container's image index |

```swift
// Depth extraction sketch
let source = CGImageSourceCreateWithData(heicData, nil)!
if let auxData = CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeDepth) {
    let depthData = try AVDepthData(fromDictionaryRepresentation: auxData as! [AnyHashable: Any])
    let depthMap = depthData.converting(toDepthDataType: kCVPixelFormatType_DisparityFloat32).depthDataMap
}
```

### 3. Parallax Renderer (`ParallaxView`)

Two approach options:

**Option A — Metal shader (recommended)**
- Render the primary image as a textured quad.
- Pass the depth map as a second texture.
- In the fragment shader, offset UV sampling based on depth × device tilt.
- Same displacement logic as the current web `canvas` renderer, but GPU-native.

**Option B — SceneKit**
- Map the primary image onto a subdivided plane mesh.
- Displace vertices along Z using depth map values.
- Rotate the camera slightly based on device motion.

### 4. Motion Input (`MotionProvider`)

- Use `CMMotionManager` for gyroscope-driven parallax (device tilt).
- Fall back to touch-drag panning (same as the current web version).
- Clamp rotation to ±5° to keep the effect subtle.

## Data Flow

1. User picks a spatial photo from the library grid.
2. `SpatialPhotoProcessor` extracts primary image + depth map from HEIC data.
3. Both textures are passed to `ParallaxView`.
4. `MotionProvider` streams device attitude → view updates displacement uniforms.

## Project Structure

```
SpatialViewer/
├── App/
│   └── SpatialViewerApp.swift
├── Views/
│   ├── LibraryView.swift          # Photo grid
│   ├── ParallaxView.swift         # Metal/SceneKit renderer
│   └── ParallaxMetalView.swift    # MTKView subclass (if Metal)
├── Services/
│   ├── SpatialPhotoLibrary.swift  # PhotoKit fetch + filtering
│   ├── SpatialPhotoProcessor.swift # HEIC → image + depth
│   └── MotionProvider.swift       # CMMotionManager wrapper
├── Shaders/
│   └── Parallax.metal             # Displacement fragment shader
└── Models/
    └── SpatialPhoto.swift         # Extracted photo data model
```

## Dependencies

None beyond Apple frameworks:

- `PhotosUI` — photo picker
- `AVFoundation` — `AVDepthData`
- `ImageIO` — `CGImageSource` for HEIC parsing
- `MetalKit` — rendering
- `CoreMotion` — gyroscope

## Minimum Target

- iOS 16+ (spatial photo support in PhotoKit)
- iPhone with gyroscope (all modern iPhones)

## Open Questions

- **Share/export**: Should the app support exporting the parallax as a short video or Live Photo for sharing?
- **Vision Pro**: Worth adding a visionOS target that renders the stereo pair as actual stereoscopic 3D?
- **Depth quality**: Compare `AVDepthData` embedded depth vs. stereo-computed depth — which looks better for parallax? May want to support both and let user toggle.
