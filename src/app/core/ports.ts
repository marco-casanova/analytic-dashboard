import { HeartPoint, Patient } from './models';

export interface HeartRepository {
  listPatients(): Promise<Patient[]>;
  getPoints(patientId: string): Promise<HeartPoint[]>;
}
