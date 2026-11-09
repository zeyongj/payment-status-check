import { productionHandlers } from '../server/handlers.js';
export function GET(request: Request) {
  return productionHandlers().getAdmins(request);
}
export function POST(request: Request) {
  return productionHandlers().postAdmins(request);
}
