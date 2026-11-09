import { productionHandlers } from '../server/handlers.js';
export function GET(request: Request) {
  return productionHandlers().getAdmin(request);
}
