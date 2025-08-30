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
  private base = inject(API_BASE, { optional: true }) ?? 'http://localhost:4000';

  async listPatients(): Promise<Patient[]> {
    const obs = this.http.get<Patient[]>(`${this.base}/api/patients`);
    return firstValueFrom(obs);
  }
  async getPoints(patientId: string): Promise<HeartPoint[]> {
    const obs = this.http.get<any[]>(`${this.base}/api/patients/${patientId}/points`);
    const raw = await firstValueFrom(obs);
    return raw.map(mapPoint);
  }
}
