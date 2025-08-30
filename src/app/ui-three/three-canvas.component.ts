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
  // Optional model tint color (hex string like '#ff0000' or null)
  readonly modelColor = signal<string | null>(null);

  // Three.js objects
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.Camera;
  private perspCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  private orthoCamera?: THREE.OrthographicCamera;
  private orthoSize = 1.5;
  private controls!: OrbitControls;
  private heart?: THREE.Object3D;
  // Insertion guides replacing C0..C3 point clusters
  private clusters: THREE.Object3D[] = [];
  private guideMaterials: THREE.Material[] = [];
  private guideBaseOpacity = 0.32; // varies slightly per patient
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

  // Rebuild insertion guides whenever filters change (uses filteredPoints as a trigger)
  private readonly effPoints = effect(() => {
    // Access the value to establish dependency
    void this.store.filteredPoints();
    this.rebuildGuides();
  });

  private readonly effClusters = effect(() => {
    const vis = this.clustersVisible();
    const show = this.store.showOverlay();
    if (!this.clusters.length) return;
    this.clusters.forEach((g, i) => (g.visible = show && !!vis[i as 0 | 1 | 2 | 3]));
  });

  // Preload models for all patients when the list arrives
  private readonly effPreload = effect(() => {
    const list = this.patients();
    if (!list.length) return;
    list.forEach((p) => {
      const raw = p.modelUrl;
      const isAbs = /^https?:\/\//i.test(raw);
      // Build candidates without forcing /api for static assets
      const candidates: string[] = [];
      if (isAbs) {
        candidates.push(raw);
      } else if (raw.startsWith('/')) {
        // Already an absolute-root path (e.g., /exams/p1/heart.glb or /models/foo.glb)
        candidates.push(raw);
      } else {
        // Normalize relative references
        const cleaned = raw.replace(/^\.?:?\/?/, '');
        if (/^(exams|models)\//.test(cleaned)) {
          candidates.push(`/${cleaned}`);
        } else {
          // Default to /models for backwards compatibility
          candidates.push(`/models/${cleaned}`);
        }
      }
      void this.tryLoadAny(candidates).catch(() => {});
    });
  });

  private readonly effOverlay = effect(() => {
    const show = this.store.showOverlay();
    const xray = this.xray();
    this.guideMaterials.forEach((m) => {
      if ('depthTest' in (m as any)) (m as any).depthTest = !xray;
      if ('depthWrite' in (m as any)) (m as any).depthWrite = !xray;
      (m as any).transparent = true;
      // Keep a consistent translucent look; slightly emphasize in xray
      (m as any).opacity = xray
        ? Math.min(0.6, this.guideBaseOpacity + 0.13)
        : this.guideBaseOpacity;
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
            if ('depthWrite' in mat) (mat as any).depthWrite = !xray;
          }
        }
      });
    }
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
    // Normalize and build candidate URLs: prefer static assets under /exams or /models
    const raw = patient?.modelUrl ?? '/models/heart.glb';
    const isAbs = /^https?:\/\//i.test(raw);
    const candidates: string[] = [];
    if (isAbs) {
      candidates.push(raw);
    } else if (raw.startsWith('/')) {
      candidates.push(raw);
    } else {
      const cleaned = raw.replace(/^\.?:?\/?/, '');
      if (/^(exams|models)\//.test(cleaned)) {
        candidates.push(`/${cleaned}`);
      } else {
        candidates.push(`/models/${cleaned}`);
      }
    }

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
      // Apply current tint if any
      if (this.modelColor()) this.applyModelColor(instance, this.modelColor()!);
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
      // Rebuild guides to match new bounds
      this.rebuildGuides();
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
      this.rebuildGuides();
    }
  }

  // UI handlers for color control
  onColorInput(val: string) {
    // expect #rrggbb; accept empty to clear
    const hex =
      typeof val === 'string' && /^#?[0-9a-fA-F]{6}$/.test(val)
        ? val.startsWith('#')
          ? val
          : `#${val}`
        : null;
    if (hex) {
      this.modelColor.set(hex);
      if (this.heart) this.applyModelColor(this.heart, hex);
    }
  }

  clearColor() {
    this.modelColor.set(null);
    if (this.heart) this.restoreOriginalMaterials(this.heart);
  }

  toggleFullColor(on: boolean) {
    if (on) {
      // Pick a pleasant default if none chosen
      const hex = this.modelColor() ?? '#d32f2f';
      this.modelColor.set(hex);
      // Disable x-ray for full color
      if (this.xray()) this.xray.set(false);
      if (this.heart) this.applyModelColor(this.heart, hex);
    } else {
      this.clearColor();
    }
  }

  // Apply a uniform tint to all mesh materials in the object
  private applyModelColor(root: THREE.Object3D, hex: string) {
    const color = new THREE.Color(hex);
    root.traverse((o: any) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        // Preserve originals once
        if ((m as any).__orig === undefined) {
          (m as any).__orig = {
            color: (m as any).color ? (m as any).color.clone() : null,
            metalness: (m as any).metalness ?? null,
            roughness: (m as any).roughness ?? null,
            emissive: (m as any).emissive ? (m as any).emissive.clone() : null,
          };
        }
        if ('color' in m && (m as any).color?.set) (m as any).color.set(color);
        if ('metalness' in m)
          (m as any).metalness = Math.max(0, Math.min(1, (m as any).metalness ?? 0.2));
        if ('roughness' in m)
          (m as any).roughness = Math.max(0, Math.min(1, (m as any).roughness ?? 0.8));
        if ('needsUpdate' in m) (m as any).needsUpdate = true;
      }
    });
  }

  private restoreOriginalMaterials(root: THREE.Object3D) {
    root.traverse((o: any) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const orig = (m as any).__orig;
        if (!orig) continue;
        if (orig.color && 'color' in m) (m as any).color.copy(orig.color);
        if (orig.metalness !== null && 'metalness' in m) (m as any).metalness = orig.metalness;
        if (orig.roughness !== null && 'roughness' in m) (m as any).roughness = orig.roughness;
        if (orig.emissive && 'emissive' in m) (m as any).emissive.copy(orig.emissive);
        if ('needsUpdate' in m) (m as any).needsUpdate = true;
      }
    });
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

  private rebuildGuides() {
    // Remove previous guides
    for (const obj of this.clusters) {
      this.scene.remove(obj);
      this.disposeGroup(obj);
    }
    this.clusters = [];
    this.guideMaterials.forEach((m) => m.dispose?.());
    this.guideMaterials = [];

    // Determine bounds
    let min = new THREE.Vector3(-1, -1, -1);
    let max = new THREE.Vector3(1, 1, 1);
    if (this.heart) {
      const box = new THREE.Box3().setFromObject(this.heart);
      min.copy(box.min);
      max.copy(box.max);
    }
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const size = new THREE.Vector3().subVectors(max, min);
    const maxLen = Math.max(size.x, size.y, size.z) || 2;
    // Build a centered cube to contain the model and keep guides inside
    const half = maxLen / 2;
    const cubeMin = new THREE.Vector3(center.x - half, center.y - half, center.z - half);
    const cubeMax = new THREE.Vector3(center.x + half, center.y + half, center.z + half);
    // Use a small inner margin so guides don't coincide with the cube surface
    const margin = maxLen * 0.02;
    const innerMin = cubeMin.clone().addScalar(margin);
    const innerMax = cubeMax.clone().addScalar(-margin);
    // Per-patient variations
    const variant = this.computeGuideVariant(this.selectedId(), size);
    this.guideBaseOpacity = variant.baseOpacity;
    const thickness = maxLen * 0.03 * variant.thicknessScale; // thin, but visible

    const makeBoxBetween = (a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Mesh => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const geo = new THREE.BoxGeometry(len, thickness, thickness);
      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: this.guideBaseOpacity,
        metalness: 0.0,
        roughness: 0.9,
        depthWrite: !this.xray(),
      });
      const mesh = new THREE.Mesh(geo, mat);
      // orient local X to dir
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(1, 0, 0),
        dir.clone().normalize()
      );
      mesh.quaternion.copy(quat);
      mesh.position.copy(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
      mesh.renderOrder = this.xray() ? 999 : 1;
      this.guideMaterials.push(mat);
      return mesh;
    };

    // Define four paths spanning the cube with small offsets per patient
    const paths: Array<[THREE.Vector3, THREE.Vector3, number]> = [];
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    // C0: Along X with small patient-specific offset in Y/Z
    {
      const y0 = clamp(center.y + variant.offsetXY.y, innerMin.y, innerMax.y);
      const z0 = clamp(center.z + variant.offsetXY.z, innerMin.z, innerMax.z);
      paths.push([
        new THREE.Vector3(innerMin.x, y0, z0),
        new THREE.Vector3(innerMax.x, y0, z0),
        this.palette[0],
      ]);
    }
    // C1: Along Y with offset in X/Z
    {
      const x0 = clamp(center.x + variant.offsetYZ.x, innerMin.x, innerMax.x);
      const z0 = clamp(center.z + variant.offsetYZ.z, innerMin.z, innerMax.z);
      paths.push([
        new THREE.Vector3(x0, innerMin.y, z0),
        new THREE.Vector3(x0, innerMax.y, z0),
        this.palette[1],
      ]);
    }
    // C2: Along Z with offset in X/Y
    {
      const x0 = clamp(center.x + variant.offsetZX.x, innerMin.x, innerMax.x);
      const y0 = clamp(center.y + variant.offsetZX.y, innerMin.y, innerMax.y);
      paths.push([
        new THREE.Vector3(x0, y0, innerMin.z),
        new THREE.Vector3(x0, y0, innerMax.z),
        this.palette[2],
      ]);
    }
    // C3: One of the cube diagonals selected per patient
    const diags: Array<[THREE.Vector3, THREE.Vector3]> = [
      [innerMin.clone(), innerMax.clone()],
      [
        new THREE.Vector3(innerMax.x, innerMin.y, innerMin.z),
        new THREE.Vector3(innerMin.x, innerMax.y, innerMax.z),
      ],
      [
        new THREE.Vector3(innerMin.x, innerMax.y, innerMin.z),
        new THREE.Vector3(innerMax.x, innerMin.y, innerMax.z),
      ],
      [
        new THREE.Vector3(innerMin.x, innerMin.y, innerMax.z),
        new THREE.Vector3(innerMax.x, innerMax.y, innerMin.z),
      ],
    ];
    const idx = ((variant.diagonalIndex % diags.length) + diags.length) % diags.length;
    const d = diags[idx];
    paths.push([d[0], d[1], this.palette[3]]);

    paths.forEach(([a, b, col]) => {
      const guide = makeBoxBetween(a, b, col);
      this.scene.add(guide);
      this.clusters.push(guide);
    });

    // Apply 2D thickness adjustments
    this.updateGuideThickness(this.store.twoD());
  }

  // Compute small, deterministic per-patient variations for guides
  private computeGuideVariant(
    patientId: string | null | undefined,
    size: THREE.Vector3
  ): {
    thicknessScale: number;
    baseOpacity: number;
    diagonalIndex: number;
    offsetXY: { y: number; z: number };
    offsetYZ: { x: number; z: number };
    offsetZX: { x: number; y: number };
  } {
    const id = patientId ?? 'default';
    let h = 2166136261 >>> 0; // FNV-1a base
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = (seed: number) => {
      // xorshift32
      let x = (h ^ seed) >>> 0;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      // Normalize to [0,1)
      return ((x >>> 0) & 0xffffffff) / 4294967296; // 2^32
    };
    const r1 = rand(0x9e37);
    const r2 = rand(0x7f4a7c15);
    const r3 = rand(0x94d049bb);
    const r4 = rand(0x1b873593);
    const r5 = rand(0x85ebca6b);
    const r6 = rand(0xc2b2ae35);

    // Thickness within ~±20%
    const thicknessScale = 0.9 + (r1 - 0.5) * 0.4; // [0.7, 1.1]
    // Base opacity subtle variance [0.28, 0.38]
    const baseOpacity = 0.28 + r2 * 0.1;
    // Pick one of 4 diagonals
    const diagonalIndex = Math.max(0, Math.min(3, Math.floor(r3 * 4)));

    // Offsets up to ~5% of each dimension
    const ox = (r4 - 0.5) * 0.1 * Math.max(0.0001, size.x);
    const oy = (r5 - 0.5) * 0.1 * Math.max(0.0001, size.y);
    const oz = (r6 - 0.5) * 0.1 * Math.max(0.0001, size.z);

    return {
      thicknessScale,
      baseOpacity,
      diagonalIndex,
      offsetXY: { y: oy, z: oz },
      offsetYZ: { x: ox, z: oz },
      offsetZX: { x: ox, y: oy },
    };
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
      this.updateGuideThickness(true);
    } else {
      this.camera = this.perspCamera;
      this.controls.dispose();
      this.controls = new OrbitControls(this.camera as any, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enableRotate = true;
      this.fitToCurrent();
      this.updateGuideThickness(false);
    }
  }

  private updateGuideThickness(twoD: boolean) {
    // Thinner in 2D for a "line-like" appearance
    const s = twoD ? 0.25 : 1.0;
    for (const obj of this.clusters) {
      if ((obj as any).isMesh) {
        // Scale only cross-section (local Y/Z)
        (obj as THREE.Mesh).scale.set(1, s, s);
      }
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
    this.guideMaterials.forEach((m) => m.dispose?.());
    this.clusters.forEach((c) => this.disposeGroup(c));
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
