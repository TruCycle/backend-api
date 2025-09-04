import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

// SRID constants based on architecture doc
export const SRID = 4326;

@Injectable()
export class GeoService {
  constructor(private readonly dataSource: DataSource) {}

  makePoint(lon: number, lat: number) {
    return `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), ${SRID})`;
  }

  // Example: find shops within radius in degrees (caller must convert meters→degrees if needed)
  async nearestShops(lon: number, lat: number, radiusDeg = 0.05) {
    const point = this.makePoint(lon, lat);
    return this.dataSource.query(
      `SELECT id, name, ST_AsGeoJSON(geom) AS geom,
              ST_Distance(geom, ${point}) AS distance
         FROM shop
        WHERE ST_DWithin(geom, ${point}, $1)
        ORDER BY geom <-> ${point}
        LIMIT 25`,
      [radiusDeg],
    );
  }
}

