import * as THREE from 'three';
import { createSpatialPhotoMaterial } from './spatialPhotoMaterial';
import type { ViewerControls } from '../types';

export class WalkAroundScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly photoMesh: THREE.Mesh;
  private readonly textureLoader = new THREE.TextureLoader();

  private frameHandle = 0;
  private colorTexture: THREE.Texture | null = null;
  private depthTexture: THREE.Texture | null = null;

  // Movement state
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private isPointerLocked = false;
  private lastTime = 0;

  // Photo position — pinned 4 units ahead, centered at eye height
  private readonly photoPosition = new THREE.Vector3(0, 1.6, -4);
  private readonly photoPointerVec = new THREE.Vector2();

  // Movement constants
  private readonly moveSpeed = 3.5;
  private readonly mouseSensitivity = 0.002;

  // Bound handlers
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onPointerLockChange: () => void;
  private readonly onClick: () => void;
  private readonly onResize: () => void;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#0a0e16', 1);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0e16, 8, 40);

    // Perspective camera at eye height
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    this.camera.position.set(0, 1.6, 2);
    this.euler.setFromQuaternion(this.camera.quaternion);

    // Build the room environment
    this.buildRoom();

    // Photo plane — will be sized on load
    this.material = createSpatialPhotoMaterial();
    const photoGeo = new THREE.PlaneGeometry(1, 1);
    this.photoMesh = new THREE.Mesh(photoGeo, this.material);
    this.photoMesh.position.copy(this.photoPosition);
    this.scene.add(this.photoMesh);

    // Frame around the photo
    this.buildPhotoFrame();

    // Lighting
    const ambient = new THREE.AmbientLight(0x334466, 0.6);
    this.scene.add(ambient);

    const spot = new THREE.SpotLight(0xddeeff, 12, 12, Math.PI / 5, 0.4);
    spot.position.set(0, 3.5, -2);
    spot.target = this.photoMesh;
    this.scene.add(spot);
    this.scene.add(spot.target);

    // Event handlers
    this.onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Escape') {
        // Let Escape propagate so fullscreen exits
        return;
      }
      e.preventDefault();
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this.onMouseMove = (e) => {
      if (!this.isPointerLocked) return;
      this.euler.y -= e.movementX * this.mouseSensitivity;
      this.euler.x -= e.movementY * this.mouseSensitivity;
      this.euler.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    };
    this.onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.renderer.domElement;
    };
    this.onClick = () => {
      if (!this.isPointerLocked) {
        this.renderer.domElement.requestPointerLock();
      }
    };
    this.onResize = () => this.resize();

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.renderer.domElement.addEventListener('click', this.onClick);
    window.addEventListener('resize', this.onResize);

    this.resize();
    this.lastTime = performance.now();
    this.animate();
  }

  async load(baseUrl: string, depthUrl: string): Promise<void> {
    const [colorTexture, depthTexture] = await Promise.all([
      this.textureLoader.loadAsync(baseUrl),
      this.textureLoader.loadAsync(depthUrl),
    ]);

    this.disposeTexture(this.colorTexture);
    this.disposeTexture(this.depthTexture);

    this.colorTexture = colorTexture;
    this.colorTexture.colorSpace = THREE.SRGBColorSpace;
    this.colorTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.colorTexture.magFilter = THREE.LinearFilter;
    this.colorTexture.generateMipmaps = true;

    this.depthTexture = depthTexture;
    this.depthTexture.colorSpace = THREE.NoColorSpace;
    this.depthTexture.minFilter = THREE.LinearFilter;
    this.depthTexture.magFilter = THREE.LinearFilter;
    this.depthTexture.generateMipmaps = false;

    const image = this.colorTexture.image as { width: number; height: number };
    if (image?.width && image?.height) {
      const aspect = image.width / image.height;
      const photoHeight = 2.2;
      const photoWidth = photoHeight * aspect;
      this.photoMesh.scale.set(photoWidth, photoHeight, 1);
      this.material.uniforms.uTexelSize.value.set(1 / image.width, 1 / image.height);

      // Rebuild frame to match
      this.rebuildPhotoFrame(photoWidth, photoHeight);
    }

    this.material.uniforms.uColorMap.value = this.colorTexture;
    this.material.uniforms.uDepthMap.value = this.depthTexture;
  }

  updateControls(controls: ViewerControls): void {
    this.material.uniforms.uDepthStrength.value = controls.depthStrength;
    this.material.uniforms.uMotionRange.value = controls.motionRange;
    this.material.uniforms.uEdgeSmoothing.value = controls.edgeSmoothing;
    this.material.uniforms.uShowDepth.value = controls.showDepth ? 1 : 0;
    this.material.uniforms.uShowBase.value = controls.showBase ? 1 : 0;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    window.removeEventListener('resize', this.onResize);
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    this.disposeTexture(this.colorTexture);
    this.disposeTexture(this.depthTexture);
    this.photoMesh.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private buildRoom(): void {
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111822,
      roughness: 0.85,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    this.scene.add(floor);

    // Grid lines on floor
    const grid = new THREE.GridHelper(20, 40, 0x1a2233, 0x141c2a);
    grid.position.y = 0.005;
    this.scene.add(grid);

    // Back wall (behind the photo)
    const wallGeo = new THREE.PlaneGeometry(20, 6);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0e1520,
      roughness: 0.9,
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 3, -5);
    this.scene.add(backWall);

    // Ceiling
    const ceilGeo = new THREE.PlaneGeometry(20, 20);
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0x0c1018,
      roughness: 0.95,
    });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 4;
    this.scene.add(ceil);
  }

  private frameMesh: THREE.Mesh | null = null;

  private buildPhotoFrame(): void {
    this.rebuildPhotoFrame(1, 1);
  }

  private rebuildPhotoFrame(photoWidth: number, photoHeight: number): void {
    if (this.frameMesh) {
      this.frameMesh.geometry.dispose();
      (this.frameMesh.material as THREE.Material).dispose();
      this.scene.remove(this.frameMesh);
    }

    const border = 0.06;
    const frameShape = new THREE.Shape();
    const hw = photoWidth / 2 + border;
    const hh = photoHeight / 2 + border;
    frameShape.moveTo(-hw, -hh);
    frameShape.lineTo(hw, -hh);
    frameShape.lineTo(hw, hh);
    frameShape.lineTo(-hw, hh);
    frameShape.lineTo(-hw, -hh);

    // Inner cutout
    const ihw = photoWidth / 2;
    const ihh = photoHeight / 2;
    const hole = new THREE.Path();
    hole.moveTo(-ihw, -ihh);
    hole.lineTo(-ihw, ihh);
    hole.lineTo(ihw, ihh);
    hole.lineTo(ihw, -ihh);
    hole.lineTo(-ihw, -ihh);
    frameShape.holes.push(hole);

    const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.04, bevelEnabled: false });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.4,
      metalness: 0.3,
    });
    this.frameMesh = new THREE.Mesh(frameGeo, frameMat);
    this.frameMesh.position.copy(this.photoPosition);
    this.frameMesh.position.z += 0.01; // Slightly in front
    this.scene.add(this.frameMesh);
  }

  private animate = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Movement
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    this.velocity.set(0, 0, 0);

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.velocity.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.velocity.sub(forward);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.velocity.sub(right);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.velocity.add(right);

    if (this.velocity.lengthSq() > 0) {
      this.velocity.normalize().multiplyScalar(this.moveSpeed * dt);
      this.camera.position.add(this.velocity);
    }

    // Keep camera at eye height
    this.camera.position.y = 1.6;

    // Compute parallax pointer from camera-to-photo relative position
    const toPhoto = new THREE.Vector3().subVectors(this.photoPosition, this.camera.position);
    // Project camera offset onto the photo's local X and Y
    const localX = -toPhoto.x / 3;
    const localY = (this.camera.position.y - this.photoPosition.y) / 3;
    this.photoPointerVec.set(
      Math.max(-1, Math.min(1, localX)),
      Math.max(-1, Math.min(1, localY))
    );
    this.material.uniforms.uPointer.value.copy(this.photoPointerVec);

    this.renderer.render(this.scene, this.camera);
    this.frameHandle = requestAnimationFrame(this.animate);
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private disposeTexture(texture: THREE.Texture | null): void {
    texture?.dispose();
  }
}
