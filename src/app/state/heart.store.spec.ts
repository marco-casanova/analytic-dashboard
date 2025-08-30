import { HeartStore } from './heart.store';

class FakeRepo {
  listPatients = async () => [{ id: 'p1', name: 'Ana', studyDate: '2025-07-10', modelUrl: '/m' }];
  getPoints = async (_: string) => [
    { x: 0, y: 0, z: 0, cluster: 0, metric: 'activation_ms', value: 1 },
    { x: 1, y: 1, z: 1, cluster: 2, metric: 'activation_ms', value: 2 },
  ];
}

describe('HeartStore', () => {
  it('filters by visible clusters', async () => {
    const store = new HeartStore();
    // @ts-ignore inject repo
    store['repo'] = new FakeRepo();
    await store.init();
    store.select('p1');
    expect(store.filteredPoints().length).toBe(2);
    store.toggleCluster(2);
    expect(store.filteredPoints().length).toBe(1);
  });
});
