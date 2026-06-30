/*
 * config.js — Runtime configuration.
 *
 * The map tile source is the ONLY integration point between the app and your
 * self-hosted map infrastructure. Point `tileUrl` at whatever you run — an OSM
 * raster tile server, or a folder of pre-rendered PNG tiles served statically.
 * No code changes are needed to swap providers; just edit this constant.
 *
 * Current default = public OpenStreetMap (works out-of-the-box for dev/demo).
 * For production / self-hosting, swap `tileUrl` to your own source:
 *
 *   Public OSM (dev only)   : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'  (subdomains: '')
 *   Self-hosted tile server : 'http://localhost:8080/tile/{z}/{x}/{y}.png'      (subdomains: '')
 *   Static PNG folder       : './tiles/{z}/{x}/{y}.png'                          (subdomains: '')
 *
 * NOTE: the public OSM server forbids heavy production traffic (tile usage
 * policy) — point this at your own server before going live. See README.md
 * "Peta (Leaflet) & self-hosting tiles".
 */
/*
 * Backend API base. The app fetches GET `${API_BASE}/activities` on boot and, if
 * it succeeds, uses that data; if the API is unreachable (e.g. opened via the
 * plain static server with no backend), it silently falls back to the bundled
 * data.js seed. Default '/api' works behind the nginx proxy in docker-compose.
 * Set to '' to force bundled-only, or to an absolute URL for cross-origin dev.
 */
export const API_BASE = '/api';

export const MAP = {
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  center: [-6.2088, 106.8456], // Jakarta
  zoom: 11,
  minZoom: 10,
  maxZoom: 18,
  // Leave empty for single-host / folder tiles; set 'abc' only if your URL uses {s}.
  subdomains: '',
  flyToZoom: 14 // zoom used when a marker/card is selected
};
