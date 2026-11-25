// The user's location from the browser / phone (GPS), for Sales Check In (check in / check out).
// Browsers only allow it on HTTPS or localhost, and ask the user's permission the first time.
import { useLoadingStore } from '@/stores/loadingStore';
import type { GpsLocation } from '@/types';

/** Why the location couldn't be read, in words the user can act on */
const GPS_ERRORS: Record<number, string> = {
  1: 'Location access is blocked: allow this site to use your location in the browser, then try again',
  2: "Your location can't be found right now: check that GPS / location services are on",
  3: 'Getting your location took too long: try again (outdoors or near a window helps)',
};

/**
 * Read the current location once (high accuracy, up to 20 s), behind the portal's LOADING overlay.
 * Throws an Error with a message for the user.
 */
export async function getCurrentLocation(): Promise<GpsLocation> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('This browser cannot give your location');
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error('Location only works when the portal is opened over HTTPS (or on localhost)');
  }
  const { start, finish } = useLoadingStore.getState();
  start();
  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
    );
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    };
  } catch (error) {
    const code = (error as GeolocationPositionError).code;
    throw new Error(GPS_ERRORS[code] ?? 'Your location could not be read');
  } finally {
    finish();
  }
}
