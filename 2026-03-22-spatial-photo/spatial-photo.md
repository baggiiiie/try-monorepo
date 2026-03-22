Build a web app that lets a user upload an iPhone spatial photo and view a convincing 3D/parallax effect in a normal desktop browser, to achieve a similar viewing effect to Apple Vision Pro, but in laptop browser.

Goal
- The app should NOT try to reproduce Apple Vision Pro exactly.
- The app SHOULD create a monoscopic spatial-photo effect on a laptop/desktop screen using motion parallax.
- The intended pipeline is:
  1. user uploads an iPhone spatial photo file
  2. backend extracts left/right images from the spatial photo
  3. backend computes a usable relative depth map from the stereo pair
  4. frontend renders a depth-warped image with subtle pointer-driven viewpoint shifts using three.js

Scope constraints
- do not attempt in-browser HEIC decoding if avoidable
- do not attempt exact Apple-native spatial metadata playback
- do not build WebXR or VR support
- do not over-engineer for production scale
- optimize for “works locally, clear architecture, easy to iterate on”

Product requirements
- User can upload one spatial photo file
- App processes it and shows a 3D-looking viewer in the browser
- Mouse movement should create subtle parallax
- There should be controls for:
  - depth strength
  - motion amount
  - smoothing / artifact reduction
  - reset view
- The output should feel stable and tasteful, not exaggerated
- Keep motion small to reduce artifacts
- Show clear error states if parsing or extraction fails

Technical approach
- Frontend: React + three.js
- Backend: Node.js service
- Prefer TypeScript across the stack
- The backend is responsible for file ingestion, extraction, and stereo/depth preprocessing
- The frontend is responsible for rendering only

Architecture
Create a small full-stack app with two folders:
- /server
- /client

Server responsibilities
1. Accept uploaded spatial photo files
2. Extract the stereo pair from the iPhone spatial photo
3. Convert extracted images into web-friendly formats like PNG
4. Compute a relative depth map from the stereo pair
5. Return to the client:
   - base image URL or blob
   - depth map URL or blob
   - optional right-eye image URL for debugging
   - metadata JSON with image size and normalization parameters

Important guidance for extraction
- Use a practical server-side approach for HEIC/spatial-photo extraction
- It is acceptable to rely on external tools or libraries if needed
- Prefer a solution that is realistic for a coding prototype, even if platform-dependent
- If exact extraction of Apple spatial photo internals is difficult, structure the code so extraction is isolated behind a clean adapter
- If necessary, implement an abstraction like:
  - SpatialPhotoExtractor interface
  - AppleHeicExtractor implementation
- The rest of the app should not depend on extractor internals

Depth/disparity processing
- Compute a dense relative depth map from the stereo pair
- Relative depth is sufficient; metric depth is not required
- Normalize depth into a texture-friendly format
- Add light smoothing to reduce noise
- Produce a confidence mask if useful, but keep it optional for v1
- Isolate this in a module so it can be swapped later

Frontend responsibilities
1. Upload UI
2. Processing/loading state
3. Viewer using three.js
4. Controls panel

Viewer requirements
- Use a single displayed image plus depth-map-based reprojection
- Render a full-screen plane or image plane
- Use a custom shader material
- The shader should:
  - sample the base color texture
  - use the depth texture to offset UVs based on pointer-driven virtual camera movement
  - keep the effect subtle
  - include basic edge handling to reduce visible holes/streaking
- Use an orthographic camera unless perspective is clearly better for simplicity
- Pointer movement should map to a small virtual camera delta
- Add easing / smoothing so motion feels polished
- Provide a neutral background and centered viewer

UI requirements
- Minimal clean interface
- Upload button / dropzone
- Viewer canvas
- Controls panel with sliders:
  - depth strength
  - motion range
  - edge smoothing
- Buttons:
  - reset
  - reprocess
- Optional debug toggle:
  - show depth map
  - show raw base image

Implementation priorities
Priority 1
- End-to-end working flow
- Upload -> process -> render parallax effect

Priority 2
- Cleaner shader and artifact handling
- Better smoothing and interaction polish

Priority 3
- Debug tools and code cleanup

Artifact handling expectations
Artifacts will happen, especially around foreground edges and disocclusions.
For v1:
- keep motion conservative
- clamp UV offsets
- add simple smoothing / blur / feathering strategies where reasonable
- prefer tasteful realism over dramatic depth

Code quality requirements
- Use TypeScript
- Keep modules small and named clearly
- Add comments where the logic is non-obvious
- Avoid giant files
- Add a README with setup and architecture notes
- Include a short “known limitations” section

Suggested file structure
/server
  /src
    /routes
    /services
      spatialExtractor.ts
      depthEstimator.ts
      imagePipeline.ts
    /types
    index.ts

/client
  /src
    /components
      UploadPanel.tsx
      Viewer.tsx
      ControlsPanel.tsx
    /three
      viewerScene.ts
      spatialPhotoMaterial.ts
    /api
    /types
    App.tsx

Functional expectations
- Running locally should be straightforward
- The user can upload a sample spatial photo and see a convincing 3D effect
- The viewer should feel smooth at normal desktop frame rates
- Failure cases should not crash the app

Acceptance criteria
1. A user can start the app locally
2. A user can upload a spatial photo
3. The backend extracts usable stereo data or fails gracefully with a clear message
4. The backend generates a depth map
5. The frontend renders a depth-warped view in three.js
6. Moving the mouse causes a visible but subtle parallax effect
7. Sliders visibly affect the output
8. The codebase is organized enough for a v2

Non-goals
- Exact Vision Pro parity
- Native Apple ecosystem integration
- Full production security hardening
- Multi-file galleries
- Accounts/auth
- Mobile-first optimization
- WebXR/VR mode

Deliverables
- Full source code
- README
- Setup instructions
- Notes on which extraction/dependency assumptions were made
- A short explanation of the shader approach
- A short explanation of current limitations and next steps

Important implementation note
If exact extraction of iPhone spatial HEIC data proves brittle, do not block the whole project. Build the app with a clean extraction boundary and get the rest of the pipeline working. The repo should make it easy to swap in a better extractor later.

At the end, provide:
1. a short architecture summary
2. setup/run instructions
3. known limitations
