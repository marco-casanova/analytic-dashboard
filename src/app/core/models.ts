export type ClusterId = 0 | 1 | 2 | 3;

export interface Patient {
  id: string;
  name: string;
  studyDate: string;
  modelUrl: string;
}
export interface HeartPoint {
  x: number;
  y: number;
  z: number;
  cluster: ClusterId;
  metric: string;
  value: number;
  segment?: string;
  phase?: number;
  time?: string;
}
