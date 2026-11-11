import type { Database } from '../../persistence/db.js';
import { listHotels } from '../../persistence/hotels-repo.js';
import { toHotelView } from '../views.js';

export function createHotelHandlers(dependencies: { db: Database }) {
  return {
    /** GET /v1/hotels — último catálogo de hotéis conhecido (FR-008). */
    async listHotels() {
      const rows = await listHotels(dependencies.db);
      return { items: rows.map(toHotelView) };
    },
  };
}
