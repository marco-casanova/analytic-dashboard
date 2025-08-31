export type ClusterId = 0 | 1 | 2 | 3;

export interface Patient {
  id: string;
  name: string;
  studyDate: string;
  modelUrl: string;
  notes?: Array<PatientNote>;
}

export interface PatientNote {
  title: string;
  body: string;
  // Either provide absolute world anchor or normalized relative (-1..1) coordinates
  anchor?: { x: number; y: number; z: number };
  rel?: { x: number; y: number; z: number };
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
