import { Routes } from '@angular/router';
import { HEART_REPO, API_BASE } from './core/tokens';
import { HeartApiService } from './data-access/heart-api.service';

export const APP_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/viewer-page/viewer-page.component').then((m) => m.ViewerPageComponent),
  },
  {
    path: 'plots',
    loadComponent: () =>
      import('./features/dot-plots/dot-plots.component').then((m) => m.DotPlotsComponent),
  },
];

export const APP_PROVIDERS = [
  // Use relative base so Angular dev proxy can route /api and /models
  { provide: API_BASE, useValue: '' },
  { provide: HEART_REPO, useExisting: HeartApiService },
];
