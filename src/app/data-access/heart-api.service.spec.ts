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
        { provide: API_BASE, useValue: '' },
        HeartApiService,
      ],
    });
    svc = TestBed.inject(HeartApiService);
    httpMock = TestBed.inject(HttpTestingController as any);
  });

  afterEach(() => httpMock.verify());

  it('lists patients from local data', async () => {
    const p = svc.listPatients();
    const req = httpMock.expectOne('/data/patients.json');
    req.flush([
      { id: 'p1', name: 'Ana', studyDate: '2025-07-10', modelUrl: '/exams/p1/heart.glb' },
    ]);
    const out = await p;
    expect(out[0].id).toBe('p1');
  });

  it('maps points correctly from local data', async () => {
    const p = svc.getPoints('p1');
    const req = httpMock.expectOne('/data/points-p1.json');
    req.flush([{ x: 0.1, y: 0.2, z: -0.3, cluster: 2, metric: 'activation_ms', value: 123.4 }]);
    const out = await p;
    expect(out[0].cluster).toBe(2);
    expect(out[0].value).toBeCloseTo(123.4);
  });
});
