import * as THREE from 'three';
import { createSpatialPhotoMaterial } from './spatialPhotoMaterial';
import type { ViewerControls } from '../types';

export class ViewerScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointerCurrent = new THREE.Vector2();
  private readonly textureLoader = new THREE.TextureLoader();
  private frameHandle = 0;
  private resizeObserver: ResizeObserver;
  private colorTexture: THREE.Texture | null = null;
  private depthTexture: THREE.Texture | null = null;
  private imageAspect = 1;
  private onPointerMove: (event: PointerEvent) => void;
  private onPointerLeave: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#0d111a', 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;

    this.material = createSpatialPhotoMaterial();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);

    this.container.appendChild(this.renderer.domElement);

    this.onPointerMove = (event) => {
      const bounds = this.container.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
      this.pointerTarget.set(x, -y);
    };

    this.onPointerLeave = () => {
      this.pointerTarget.set(0, 0);
    };

    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  async load(baseUrl: string, depthUrl: string): Promise<void> {
    const [colorTexture, depthTexture] = await Promise.all([
      this.textureLoader.loadAsync(baseUrl),
      this.textureLoader.loadAsync(depthUrl)
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
      this.imageAspect = image.width / image.height;
      this.material.uniforms.uTexelSize.value.set(1 / image.width, 1 / image.height);
    }

    this.material.uniforms.uColorMap.value = this.colorTexture;
    this.material.uniforms.uDepthMap.value = this.depthTexture;
    this.updateMeshScale();
  }

  updateControls(controls: ViewerControls): void {
    this.material.uniforms.uDepthStrength.value = controls.depthStrength;
    this.material.uniforms.uMotionRange.value = controls.motionRange;
    this.material.uniforms.uEdgeSmoothing.value = controls.edgeSmoothing;
    this.material.uniforms.uShowDepth.value = controls.showDepth ? 1 : 0;
    this.material.uniforms.uShowBase.value = controls.showBase ? 1 : 0;
  }

  resetView(): void {
    this.pointerTarget.set(0, 0);
    this.pointerCurrent.set(0, 0);
    this.material.uniforms.uPointer.value.set(0, 0);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerleave', this.onPointerLeave);
    this.disposeTexture(this.colorTexture);
    this.disposeTexture(this.depthTexture);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private animate = (): void => {
    this.pointerCurrent.lerp(this.pointerTarget, 0.08);
    this.material.uniforms.uPointer.value.copy(this.pointerCurrent);
    this.renderer.render(this.scene, this.camera);
    this.frameHandle = requestAnimationFrame(this.animate);
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;

    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
    this.updateMeshScale();
  }

  private updateMeshScale(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const viewportAspect = width / height;

    if (this.imageAspect > viewportAspect) {
      this.mesh.scale.set(viewportAspect, viewportAspect / this.imageAspect, 1);
      return;
    }

    this.mesh.scale.set(this.imageAspect, 1, 1);
  }

  private disposeTexture(texture: THREE.Texture | null): void {
    texture?.dispose();
  }
}
