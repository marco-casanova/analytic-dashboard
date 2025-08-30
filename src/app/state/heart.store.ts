import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { HEART_REPO } from '../core/tokens';
import type { HeartRepository } from '../core/ports';
import type { ClusterId, HeartPoint, Patient } from '../core/models';

@Injectable({ providedIn: 'root' })
export class HeartStore {
  private repo = inject(HEART_REPO, { optional: false }) as HeartRepository;

  // Data
  patients = signal<Patient[]>([]);
  selectedId = signal<string | null>(null);
  points = signal<HeartPoint[]>([]);

  // UI state
  showOverlay = signal(true);
  clustersVisible = signal<Record<ClusterId, boolean>>({ 0: true, 1: true, 2: true, 3: true });
  metric = signal<'activation_ms' | 'voltage_mV' | 'perfusion_idx' | 'scar_pct' | 'strain_pct'>(
    'activation_ms'
  );
  // Viewer controls
  wireframe = signal(false);
  extraLight = signal(false);
  twoD = signal(false);

  filteredPoints = computed(() => {
    const visible = this.clustersVisible();
    return this.points().filter((p) => visible[p.cluster]);
  });

  constructor() {
    effect(() => {
      const id = this.selectedId();
      if (!id) return;
      this.loadPoints(id);
    });
  }

  async init() {
    this.patients.set(await this.repo.listPatients());
  }
  select(id: string) {
    this.selectedId.set(id);
  }
  toggleOverlay(v?: boolean) {
    this.showOverlay.set(v ?? !this.showOverlay());
  }
  toggleCluster(k: ClusterId) {
    this.clustersVisible.update((s) => ({ ...s, [k]: !s[k] }));
  }
  toggleWireframe(v?: boolean) {
    this.wireframe.set(v ?? !this.wireframe());
  }
  toggleExtraLight(v?: boolean) {
    this.extraLight.set(v ?? !this.extraLight());
  }
  toggleTwoD(v?: boolean) {
    this.twoD.set(v ?? !this.twoD());
  }

  private async loadPoints(id: string) {
    this.points.set(await this.repo.getPoints(id));
  }
}
