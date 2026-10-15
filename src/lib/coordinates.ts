/**
 * Utilities for robust, safe parsing, validation, and formatting of geographic coordinates.
 *
 * Guarantees:
 * - Accepts valid numbers and valid numeric strings (e.g. 37.77, "37.77", "-122.41").
 * - Handles null, undefined, empty strings, whitespace, NaN, Infinity, and non-numeric strings safely.
 * - Enforces standard coordinate ranges:
 *     Latitude:  [-90.0, 90.0]
 *     Longitude: [-180.0, 180.0]
 * - Never converts invalid/missing data to 0 (0 is a real coordinate on the equator/prime meridian).
 * - Ensures any call to `.toFixed()` operates exclusively on a validated, finite JavaScript number.
 */

export interface CoordinatePair {
  latitude: number;
  longitude: number;
}

/**
 * Safely parses an unknown coordinate value into a validated finite number within bounds [min, max].
 * Returns null if the value is missing, empty, non-numeric, NaN, Infinity, or out of bounds.
 */
export function parseCoordinate(val: unknown, min: number, max: number): number | null {
  if (val === null || val === undefined) {
    return null;
  }

  let num: number;

  if (typeof val === 'number') {
    num = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') {
      return null;
    }
    num = Number(trimmed);
  } else {
    return null;
  }

  // Check for NaN or non-finite numbers
  if (isNaN(num) || !isFinite(num)) {
    return null;
  }

  // Check bounds
  if (num < min || num > max) {
    return null;
  }

  return num;
}

/**
 * Validates and parses latitude within [-90.0, 90.0].
 */
export function parseLatitude(val: unknown): number | null {
  return parseCoordinate(val, -90.0, 90.0);
}

/**
 * Validates and parses longitude within [-180.0, 180.0].
 */
export function parseLongitude(val: unknown): number | null {
  return parseCoordinate(val, -180.0, 180.0);
}

/**
 * Returns true if both latitude and longitude are valid numbers within their respective bounds.
 */
export function isValidCoordinatePair(lat: unknown, lng: unknown): boolean {
  return parseLatitude(lat) !== null && parseLongitude(lng) !== null;
}

/**
 * Safely formats a coordinate value to a fixed number of decimal places.
 * Returns null if the coordinate is missing, invalid, or out of range.
 * Does NOT fallback to 0 or any fake location.
 */
export function formatCoordinate(
  val: unknown,
  min: number,
  max: number,
  decimals = 4
): string | null {
  const num = parseCoordinate(val, min, max);
  if (num === null) {
    return null;
  }
  return num.toFixed(decimals);
}

/**
 * Safely formats latitude to specified decimals (default 4).
 * Returns null if invalid or missing.
 */
export function formatLatitude(val: unknown, decimals = 4): string | null {
  return formatCoordinate(val, -90.0, 90.0, decimals);
}

/**
 * Safely formats longitude to specified decimals (default 4).
 * Returns null if invalid or missing.
 */
export function formatLongitude(val: unknown, decimals = 4): string | null {
  return formatCoordinate(val, -180.0, 180.0, decimals);
}

/**
 * Formats a pair of coordinates as "lat, lng" (e.g. "37.7937, -122.3965").
 * Returns null if either coordinate is invalid.
 */
export function formatCoordinatePair(
  lat: unknown,
  lng: unknown,
  decimals = 4
): string | null {
  const latStr = formatLatitude(lat, decimals);
  const lngStr = formatLongitude(lng, decimals);
  if (latStr === null || lngStr === null) {
    return null;
  }
  return `${latStr}, ${lngStr}`;
}
