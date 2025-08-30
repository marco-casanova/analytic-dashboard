import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HeartApiService } from './heart-api.service';
import { API_BASE } from '../core/tokens';

describe('HeartApiService', () => {
  let svc: HeartApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE, useValue: 'http://test' },
        HeartApiService,
      ],
    });
    svc = TestBed.inject(HeartApiService);
    httpMock = TestBed.inject(HttpTestingController as any);
  });

  afterEach(() => httpMock.verify());

  it('lists patients', async () => {
    const p = svc.listPatients();
    const req = httpMock.expectOne('http://test/api/patients');
    req.flush([{ id: 'p1', name: 'Ana', studyDate: '2025-07-10', modelUrl: '/models/heart.glb' }]);
    const out = await p;
    expect(out[0].id).toBe('p1');
  });

  it('maps points correctly', async () => {
    const p = svc.getPoints('p1');
    const req = httpMock.expectOne('http://test/api/patients/p1/points');
    req.flush([{ x: 0.1, y: 0.2, z: -0.3, cluster: 2, metric: 'activation_ms', value: 123.4 }]);
    const out = await p;
    expect(out[0].cluster).toBe(2);
    expect(out[0].value).toBeCloseTo(123.4);
  });
});
