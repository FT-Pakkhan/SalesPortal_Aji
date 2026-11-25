// Shared by the Sales Check In screens and the map (kept apart from CheckInMap so the screens don't load Leaflet,
// which only runs in the browser)

/** Minutes as "1h 25m"; empty while still checked in */
export const formatDuration = (minutes: number | null | undefined) =>
  minutes == null ? '' : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
