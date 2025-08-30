import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HeartStore } from '../state/heart.store';
import { API_BASE } from '../core/tokens';

@Component({
  selector: 'three-canvas',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './three-canvas.component.html',
  styleUrls: ['./three-canvas.component.scss'],
})
export class ThreeCanvasComponent implements OnInit, OnDestroy {
  @ViewChild('canvas', { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  // Signals and store
  readonly store = inject(HeartStore);
  readonly patients = this.store.patients;
  readonly selectedId = this.store.selectedId;
  readonly clustersVisible = this.store.clustersVisible;
  readonly xray = signal(false);

  // Three.js objects
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.Camera;
  private perspCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  private orthoCamera?: THREE.OrthographicCamera;
  private orthoSize = 1.5;
  private controls!: OrbitControls;
  private heart?: THREE.Object3D;
  private clusters: THREE.Points[] = [];
  private pointMaterials: THREE.PointsMaterial[] = [];
  private palette: number[] = [0xff5370, 0x82aaff, 0xc3e88d, 0xffcb6b];
  private modelCache = new Map<string, THREE.Object3D>();
  private loader = new GLTFLoader();
  // Lights and alignment
  private extraLight?: THREE.DirectionalLight;
  private modelOffset = new THREE.Vector3();
  private grid?: THREE.GridHelper;
  private darkBg = new THREE.Color(0x0b0f14);
  private lightBg = new THREE.Color(0xeeeeee);
  private ruler?: THREE.Group;
  private rulerDivisions = 10;

  // Config
  private base = inject(API_BASE, { optional: true }) ?? 'http://localhost:4000';

  // Effects declared as fields to ensure they run in an injection context
  private readonly effSelection = effect(() => {
    const id = this.selectedId();
    if (!id) return;
    this.loadHeartModelForSelected();
  });

  // Rebuild point clouds whenever filtered points change
  private readonly effPoints = effect(() => {
    // Access the value to establish dependency
    void this.store.filteredPoints();
    this.rebuildPoints();
  });

  private readonly effClusters = effect(() => {
    const vis = this.clustersVisible();
    const show = this.store.showOverlay();
    if (!this.clusters.length) return;
    this.clusters.forEach((g, i) => (g.visible = show && vis[i as 0 | 1 | 2 | 3]));
  });

  // Preload models for all patients when the list arrives
  private readonly effPreload = effect(() => {
    const list = this.patients();
    if (!list.length) return;
    list.forEach((p) => {
      const raw = p.modelUrl;
      const isAbs = /^https?:\/\//i.test(raw);
      const norm = raw.startsWith('/')
        ? raw
        : isAbs
        ? raw
        : `/models/${raw.replace(/^models\/?/, '')}`;
      if (isAbs) {
        void this.getOrLoadModel(raw).catch(() => {});
      } else {
        // Try /models first, then /api/models for backends that nest models under /api
        const c1 = `${this.base}${norm}`;
        const c2 = `${this.base}/api${norm}`;
        void this.tryLoadAny([c1, c2]).catch(() => {});
      }
    });
  });

  private readonly effOverlay = effect(() => {
    const show = this.store.showOverlay();
    const xray = this.xray();
    this.pointMaterials.forEach((m) => {
      m.depthTest = !xray;
      m.transparent = xray;
      m.opacity = xray ? 0.85 : 1.0;
    });
    this.clusters.forEach((g) => {
      g.renderOrder = xray ? 999 : 1;
    });
    if (this.heart) {
      this.heart.traverse((o: THREE.Object3D) => {
        const any = o as any;
        if (any.isMesh) {
          const mat = any.material as THREE.Material & { transparent?: boolean; opacity?: number };
          if (mat) {
            (mat as any).transparent = xray;
            (mat as any).opacity = xray ? 0.35 : 1.0;
          }
        }
      });
    }
    // Overlay controls points visibility
    this.clusters.forEach((g) => (g.visible = show && g.visible));
    // Toggle 3D ruler with overlay
    this.updateRuler();
  });

  // Wireframe toggle
  private readonly effWireframe = effect(() => {
    const wf = this.store.wireframe();
    // Toggle mesh wireframe
    if (this.heart) {
      this.heart.traverse((o: any) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if ('wireframe' in m) m.wireframe = wf;
        }
      });
    }
    // Background + grid helper
    this.scene.background = wf ? this.lightBg.clone() : this.darkBg.clone();
    this.updateGrid();
  });

  // Extra light toggle
  private readonly effExtraLight = effect(() => {
    const on = this.store.extraLight();
    if (on && !this.extraLight) {
      const l = new THREE.DirectionalLight(0xffffff, 1.0);
      l.position.set(-1, 1.5, 0.5);
      this.scene.add((this.extraLight = l));
    } else if (!on && this.extraLight) {
      this.scene.remove(this.extraLight);
      this.extraLight.dispose?.();
      this.extraLight = undefined;
    }
  });

  // 2D mode (switch camera and controls)
  private readonly effTwoD = effect(() => {
    const twoD = this.store.twoD();
    this.applyCameraMode(twoD);
  });

  ngOnInit(): void {
    // Initialize data
    this.store.init();

    // Setup Three.js
    const canvas = this.canvasRef.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    this.perspCamera.position.set(0.6, 0.4, 0.8);
    this.perspCamera.near = 0.01;
    this.perspCamera.far = 100;
    this.perspCamera.aspect = w / h;
    this.perspCamera.updateProjectionMatrix();
    this.camera = this.perspCamera;
    this.renderer.setSize(w, h, false);

    this.controls = new OrbitControls(this.camera as any, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // Scene basics
    this.scene.background = this.darkBg.clone();
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 1, 1);
    this.scene.add(amb, dir);

    // Effects are set up as class fields above

    // Render loop
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });

    // Resize
    addEventListener('resize', this.onResize);
  }

  onSelect(id: string) {
    this.store.select(id);
  }

  toggleCluster(k: 0 | 1 | 2 | 3) {
    this.store.toggleCluster(k);
  }

  // Wrapper for template to avoid TS casts in template expressions
  toggleClusterIndex(i: number) {
    this.store.toggleCluster(i as unknown as 0 | 1 | 2 | 3);
  }

  resetView() {
    this.camera.position.set(0.6, 0.4, 0.8);
    this.controls.target.set(0, 0, 0);
  }

  private onResize = () => {
    if (!this.renderer) return;
    const c = this.canvasRef.nativeElement;
    const w = c.clientWidth || innerWidth;
    const h = c.clientHeight || innerHeight;
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    } else if (this.camera instanceof THREE.OrthographicCamera) {
      const aspect = w / h;
      this.camera.left = -this.orthoSize * aspect;
      this.camera.right = this.orthoSize * aspect;
      this.camera.top = this.orthoSize;
      this.camera.bottom = -this.orthoSize;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h, false);
  };

  private async loadHeartModel() {
    // Deprecated by loadHeartModelForSelected
    return this.loadHeartModelForSelected();
  }

  private async loadHeartModelForSelected() {
    const id = this.selectedId();
    const list = this.patients();
    const patient = list.find((p) => p.id === id);
    // Normalize and build candidate URLs: absolute, /models/..., /api/models/...
    const raw = patient?.modelUrl ?? '/models/heart.glb';
    const isAbs = /^https?:\/\//i.test(raw);
    const norm = raw.startsWith('/')
      ? raw
      : isAbs
      ? raw
      : `/models/${raw.replace(/^models\/?/, '')}`;
    // Try both /models and /api/models to accommodate different backends/proxies
    const candidates: string[] = isAbs ? [raw] : [`${this.base}${norm}`, `${this.base}/api${norm}`];

    // Remove previous
    if (this.heart) {
      this.scene.remove(this.heart);
      this.heart = undefined;
    }

    try {
      const model = await this.tryLoadAny(candidates);
      // Clone so each selection has its own instance/materials
      const instance = model.clone(true);
      instance.scale.set(0.01, 0.01, 0.01);
      // Center model and remember offset so points stay aligned
      const box = new THREE.Box3().setFromObject(instance);
      const center = box.getCenter(new THREE.Vector3());
      instance.position.sub(center);
      this.modelOffset.copy(center);
      this.heart = instance;
      this.scene.add(instance);
      this.fitToCurrent();
      if (this.store.wireframe()) this.updateGrid();
      if (this.store.showOverlay()) this.updateRuler();
    } catch (e) {
      // Show a simple placeholder if patient model is unavailable
      const geo = new THREE.SphereGeometry(0.15, 32, 32);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8aa0ff,
        metalness: 0.1,
        roughness: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, 0);
      this.modelOffset.set(0, 0, 0);
      this.heart = mesh;
      this.scene.add(mesh);
      this.fitToCurrent();
      if (this.store.wireframe()) this.updateGrid();
      if (this.store.showOverlay()) this.updateRuler();
    }
  }

  private async tryLoadAny(urls: string[]): Promise<THREE.Object3D> {
    let lastErr: unknown;
    for (const u of urls) {
      try {
        return await this.getOrLoadModel(u);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error('All model URLs failed');
  }

  private async getOrLoadModel(url: string): Promise<THREE.Object3D> {
    const cached = this.modelCache.get(url);
    if (cached) return cached;
    const obj = await new Promise<THREE.Object3D>((resolve, reject) => {
      this.loader.load(url, (gltf: GLTF) => resolve(gltf.scene), undefined, reject);
    });
    this.modelCache.set(url, obj);
    return obj;
  }

  private rebuildPoints() {
    // clear old
    for (const c of this.clusters) {
      this.scene.remove(c);
      c.geometry.dispose();
    }
    this.clusters = [];
    this.pointMaterials.forEach((m) => m.dispose());
    this.pointMaterials = [];

    const pts = this.store.filteredPoints();
    // Build one Points per cluster for toggling
    for (let k = 0; k < 4; k++) {
      const arr = pts.filter((p) => p.cluster === (k as 0 | 1 | 2 | 3));
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(arr.length * 3);
      arr.forEach((p, i) => {
        pos[3 * i] = p.x - this.modelOffset.x;
        pos[3 * i + 1] = p.y - this.modelOffset.y;
        pos[3 * i + 2] = p.z - this.modelOffset.z;
      });
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        size: 0.01,
        color: this.palette[k],
        sizeAttenuation: true,
      });
      const cloud = new THREE.Points(geo, mat);
      cloud.renderOrder = 1;
      this.scene.add(cloud);
      this.clusters.push(cloud);
      this.pointMaterials.push(mat);
    }
    // No annotations
  }

  private fitToCurrent() {
    const c = this.canvasRef.nativeElement;
    const w = c.clientWidth || innerWidth;
    const h = c.clientHeight || innerHeight;
    // Fit camera to object bounds
    const box = new THREE.Box3();
    if (this.heart) box.setFromObject(this.heart);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const radius = size * 0.5;
    if (this.camera instanceof THREE.PerspectiveCamera) {
      const fov = this.perspCamera.fov * (Math.PI / 180);
      const dist = radius / Math.sin(fov / 2);
      this.perspCamera.position.set(0, 0, dist * 1.2);
      this.perspCamera.aspect = w / h;
      this.perspCamera.updateProjectionMatrix();
      this.controls.target.set(0, 0, 0);
    } else if (this.camera instanceof THREE.OrthographicCamera) {
      this.orthoSize = radius * 1.2 || 1.5;
      const aspect = w / h;
      this.camera.left = -this.orthoSize * aspect;
      this.camera.right = this.orthoSize * aspect;
      this.camera.top = this.orthoSize;
      this.camera.bottom = -this.orthoSize;
      this.camera.position.set(0, 0, radius * 2);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.controls.target.set(0, 0, 0);
    }
  }

  private applyCameraMode(twoD: boolean) {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    if (twoD) {
      const w = canvas.clientWidth || innerWidth;
      const h = canvas.clientHeight || innerHeight;
      const aspect = w / h;
      if (!this.orthoCamera)
        this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
      this.camera = this.orthoCamera;
      this.orthoSize = 1.5;
      this.orthoCamera.left = -this.orthoSize * aspect;
      this.orthoCamera.right = this.orthoSize * aspect;
      this.orthoCamera.top = this.orthoSize;
      this.orthoCamera.bottom = -this.orthoSize;
      this.orthoCamera.updateProjectionMatrix();
      this.controls.dispose();
      this.controls = new OrbitControls(this.camera as any, canvas);
      this.controls.enableRotate = false;
      this.controls.enablePan = true;
      this.controls.enableZoom = true;
      this.fitToCurrent();
    } else {
      this.camera = this.perspCamera;
      this.controls.dispose();
      this.controls = new OrbitControls(this.camera as any, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enableRotate = true;
      this.fitToCurrent();
    }
  }

  private updateRuler() {
    // remove previous
    if (this.ruler) {
      this.scene.remove(this.ruler);
      this.disposeGroup(this.ruler);
      this.ruler = undefined;
    }
    if (!this.store.showOverlay()) return;
    // size from current model bounds
    let size = 2;
    if (this.heart) {
      const box = new THREE.Box3().setFromObject(this.heart);
      const s = box.getSize(new THREE.Vector3());
      size = Math.max(s.x, s.y, s.z) * 1.2 || 2;
    }
    this.ruler = this.buildRuler(size, this.rulerDivisions);
    this.ruler.renderOrder = 1000;
    this.scene.add(this.ruler);
  }

  private buildRuler(size: number, divisions = 10): THREE.Group {
    const group = new THREE.Group();
    const half = size / 2;
    const step = size / divisions;

    // lattice lines
    const verts: number[] = [];
    const pushLine = (a: THREE.Vector3, b: THREE.Vector3) => {
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };
    for (let i = 0; i <= divisions; i++) {
      const v = -half + i * step;
      for (let j = 0; j <= divisions; j++) {
        const w = -half + j * step;
        pushLine(new THREE.Vector3(-half, v, w), new THREE.Vector3(half, v, w)); // X lines
        pushLine(new THREE.Vector3(v, -half, w), new THREE.Vector3(v, half, w)); // Y lines
        pushLine(new THREE.Vector3(v, w, -half), new THREE.Vector3(v, w, half)); // Z lines
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x78909c, transparent: true, opacity: 0.5 });
    const lines = new THREE.LineSegments(geo, mat);
    group.add(lines);

    // axes
    const arrowLen = half * 1.05;
    const xArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      arrowLen,
      0xff5252,
      step * 0.6,
      step * 0.35
    );
    const yArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      arrowLen,
      0x66bb6a,
      step * 0.6,
      step * 0.35
    );
    const zArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      arrowLen,
      0x42a5f5,
      step * 0.6,
      step * 0.35
    );
    group.add(xArrow, yArrow, zArrow);

    // step label
    const label = this.makeTextSprite(`step = ${step.toFixed(2)}`);
    label.position.set(-half, half + step * 0.4, -half);
    label.renderOrder = 1001;
    group.add(label);

    return group;
  }

  private makeTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#263238';
    ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
    ctx.strokeStyle = '#90a4ae';
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    ctx.fillStyle = '#e0f2f1';
    ctx.font = '28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const scale = 0.25;
    sprite.scale.set(scale, scale * 0.5, 1);
    return sprite;
  }

  private disposeGroup(group: THREE.Object3D) {
    group.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: any) => m.dispose?.());
      }
      if (obj.map) obj.map.dispose?.();
      if (obj.texture) obj.texture.dispose?.();
    });
  }

  private updateGrid() {
    // Remove existing grid
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      const mats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
      mats.forEach((m) => (m as THREE.Material).dispose());
      this.grid = undefined;
    }
    // Only add when wireframe is on
    if (!this.store.wireframe()) return;
    let size = 2;
    let y = 0;
    if (this.heart) {
      const box = new THREE.Box3().setFromObject(this.heart);
      const s = box.getSize(new THREE.Vector3());
      size = Math.max(s.x, s.y, s.z) * 1.4 || 2;
      y = box.min.y;
    }
    const divisions = Math.max(10, Math.round(size * 10));
    const color1 = new THREE.Color(0x90a4ae);
    const color2 = new THREE.Color(0xcfd8dc);
    this.grid = new THREE.GridHelper(size, divisions, color1, color2);
    const gridMats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    gridMats.forEach((m) => {
      (m as any).transparent = true;
      (m as any).opacity = 0.35;
    });
    this.grid.position.set(0, y, 0);
    this.scene.add(this.grid);
  }

  // Annotations removed per request

  ngOnDestroy(): void {
    removeEventListener('resize', this.onResize);
    this.renderer?.dispose();
    this.pointMaterials.forEach((m) => m.dispose());
    this.clusters.forEach((c) => c.geometry.dispose());
    if (this.extraLight) {
      this.scene.remove(this.extraLight);
      this.extraLight.dispose?.();
      this.extraLight = undefined;
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      const mats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
      mats.forEach((m) => (m as THREE.Material).dispose());
      this.grid = undefined;
    }
    if (this.ruler) {
      this.scene.remove(this.ruler);
      this.disposeGroup(this.ruler);
      this.ruler = undefined;
    }
  }
}
