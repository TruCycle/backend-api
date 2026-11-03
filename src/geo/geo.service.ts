import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

// SRID constants based on architecture doc
export const SRID = 4326;

@Injectable()
export class GeoService {
  constructor(private readonly dataSource: DataSource) {}

  async nearestShops(lon: number, lat: number, radiusMeters = 5000) {
    if (!Number.isFinite(lon) || lon < -180 || lon > 180 || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50000) {
      throw new BadRequestException('Valid coordinates and a radius of up to 50000 metres are required');
    }
    const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography';
    return this.dataSource.query(
      `SELECT id,
              name,
              phone_number,
              address_line,
              postcode,
              latitude,
              longitude,
              opening_hours,
              acceptable_categories,
              active,
              ST_AsGeoJSON(geom) AS geom,
              ST_Distance(geom::geography, ${point}) AS distance_meters
         FROM shop
        WHERE active = TRUE
          AND ST_DWithin(geom::geography, ${point}, $3)
        ORDER BY distance_meters ASC, id ASC
        LIMIT 25`,
      [lon, lat, radiusMeters],
    );
  }
}

