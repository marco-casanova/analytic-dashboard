import { HeartPoint } from '../core/models';

export const toFloat = (v: unknown, def = 0) => (typeof v === 'number' ? v : def);
export function mapPoint(o: any): HeartPoint {
  return {
    x: toFloat(o.x),
    y: toFloat(o.y),
    z: toFloat(o.z),
    cluster: o.cluster as 0 | 1 | 2 | 3,
    metric: String(o.metric ?? 'activation_ms'),
    value: toFloat(o.value),
    segment: o.segment,
    phase: typeof o.phase === 'number' ? o.phase : undefined,
    time: typeof o.time === 'string' ? o.time : undefined,
  };
}
