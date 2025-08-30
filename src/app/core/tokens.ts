import { InjectionToken } from '@angular/core';
import { HeartRepository } from './ports';

export const HEART_REPO = new InjectionToken<HeartRepository>('HEART_REPO');
export const API_BASE = new InjectionToken<string>('API_BASE');
