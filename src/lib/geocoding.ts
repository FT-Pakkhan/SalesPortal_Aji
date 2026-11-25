// Address of a GPS point (reverse geocoding), as in the reference project: OpenStreetMap Nominatim — free, no key.
// The server asks it, so only the coordinates leave the portal (never the user or customer).
// Nominatim's rules: at most one request a second and a User-Agent naming the application; a visit check-in / out
// is far below that.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 5000;

/**
 * The address at latitude / longitude, e.g. "12, Jalan Puchong, Taman Wawasan, 47100 Puchong, Selangor, Malaysia",
 * or null when the service doesn't answer in time (the visit is saved without it — the map still shows the point).
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const url = `${NOMINATIM_URL}?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AJI-Sales-Portal/1.0', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    const address = data.display_name?.trim();
    return address ? address.slice(0, 500) : null;
  } catch {
    return null;
  }
}
