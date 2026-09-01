import { Request } from 'express';
import { AdminJwtPayload } from './jwt-payload.interface';

export interface BackofficeRequest extends Request {
  user: AdminJwtPayload;
}
