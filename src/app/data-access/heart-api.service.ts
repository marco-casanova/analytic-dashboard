import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../core/tokens';
import { HeartRepository } from '../core/ports';
import { HeartPoint, Patient } from '../core/models';
import { mapPoint } from './mappers';

@Injectable({ providedIn: 'root' })
export class HeartApiService implements HeartRepository {
  private http = inject(HttpClient);
  // Keep API_BASE injection for compatibility
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _base = inject(API_BASE, { optional: true });

  async listPatients(): Promise<Patient[]> {
    // Read local patients from public/data
    const obs = this.http.get<Patient[]>('/data/patients.json');
    return firstValueFrom(obs);
  }
  async getPoints(patientId: string): Promise<HeartPoint[]> {
    // Read local points from public/data
    const url = `/data/points-${encodeURIComponent(patientId)}.json`;
    const obs = this.http.get<any[]>(url);
    const raw = await firstValueFrom(obs);
    return raw.map(mapPoint);
  }
}
