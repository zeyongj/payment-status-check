import { productionHandlers } from '../server/handlers.js';
export function GET(request: Request) {
  return productionHandlers().getConfig(request);
}
export function PUT(request: Request) {
  return productionHandlers().putConfig(request);
}
