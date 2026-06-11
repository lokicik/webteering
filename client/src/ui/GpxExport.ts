import { TimedSample } from './Replay';

// Synthetic geo-anchor: world origin maps here, 1 world unit = 1 metre.
const LAT0 = 61.0;
const LON0 = 24.0;
const METERS_PER_DEG_LAT = 111320;

export function exportGpx(path: TimedSample[], name: string, startEpochMs: number) {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

  const points = path
    .map((p) => {
      // World +z runs "down" the map (south), so subtract for latitude
      const lat = (LAT0 - p.z / METERS_PER_DEG_LAT).toFixed(7);
      const lon = (LON0 + p.x / metersPerDegLon).toFixed(7);
      const time = new Date(startEpochMs + p.t).toISOString();
      return `      <trkpt lat="${lat}" lon="${lon}"><time>${time}</time></trkpt>`;
    })
    .join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Webteering" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'webteering-route.gpx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      default: return '&quot;';
    }
  });
}
