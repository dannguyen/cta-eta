const EARTH_RADIUS_MILES = 3958.8;

export const TRAIN_LINE_META = {
  RED: { code: 'RED', id: 'Red', color: '#d7263d' },
  BLUE: { code: 'BLUE', id: 'Blue', color: '#2074d4' },
  G: { code: 'G', id: 'Green', color: '#009b3a' },
  BRN: { code: 'BRN', id: 'Brown', color: '#7b4b2a' },
  P: { code: 'P', id: 'Purple', color: '#522398' },
  Y: { code: 'Y', id: 'Yellow', color: '#f4c300' },
  Pnk: { code: 'Pnk', id: 'Pink', color: '#e27ea6' },
  O: { code: 'O', id: 'Orange', color: '#f47b20' }
};

export function parseKeysFile(raw) {
  const keys = { train: '', bus: '' };

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    let value = match[2].trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    if (key === 'train' || key === 'bus') {
      keys[key] = value;
    }
  }

  return keys;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const [header, ...dataRows] = rows;
  return dataRows
    .filter((cols) => cols.length > 0 && cols.some((value) => value !== ''))
    .map((cols) => {
      const record = {};
      for (let i = 0; i < header.length; i += 1) {
        record[header[i]] = cols[i] ?? '';
      }
      return record;
    });
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isTrue(value) {
  return String(value).toUpperCase() === 'TRUE' || String(value) === '1';
}

function haversineMiles(fromLat, fromLon, toLat, toLon) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;

  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

function parseTrainLines(record) {
  const lines = [];

  for (const [column, meta] of Object.entries(TRAIN_LINE_META)) {
    if (isTrue(record[column])) {
      lines.push(meta);
    }
  }

  return lines;
}

export function parseTrainStops(csvText) {
  const rows = parseCsv(csvText);

  return rows
    .map((row) => ({
      type: 'train',
      stopId: row.STOP_ID,
      mapId: row.MAP_ID,
      directionId: row.DIRECTION_ID,
      stopName: row.STOP_NAME,
      stationName: row.STATION_NAME,
      displayName: row.STATION_DESCRIPTIVE_NAME || row.STATION_NAME,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
      lines: parseTrainLines(row)
    }))
    .filter((stop) => stop.latitude !== null && stop.longitude !== null && stop.stopId);
}

export function parseBusStops(csvText) {
  const rows = parseCsv(csvText);
  const grouped = new Map();

  for (const row of rows) {
    const id = row.STOP_ID;
    if (!id) {
      continue;
    }

    const lat = toNumber(row.latitude);
    const lon = toNumber(row.longitude);
    if (lat === null || lon === null) {
      continue;
    }

    let stop = grouped.get(id);
    if (!stop) {
      stop = {
        type: 'bus',
        stopId: id,
        displayName: row.PUBLIC_NAM || `${row.STREET} & ${row.CROSS_ST}`,
        latitude: lat,
        longitude: lon,
        directions: new Set(),
        routes: new Set(),
        routeDirections: new Set()
      };
      grouped.set(id, stop);
    }

    const direction = row.DIR?.trim();
    if (direction) {
      stop.directions.add(direction);
    }

    if (row.ROUTESSTPG) {
      for (const route of row.ROUTESSTPG.split(',')) {
        const trimmedRoute = route.trim();
        if (trimmedRoute) {
          stop.routes.add(trimmedRoute);
          if (direction) {
            stop.routeDirections.add(`${trimmedRoute}|${direction}`);
          }
        }
      }
    }
  }

  return [...grouped.values()];
}

export function withDistance(stops, userLocation) {
  return stops
    .map((stop) => ({
      ...stop,
      distanceMiles: haversineMiles(
        userLocation.latitude,
        userLocation.longitude,
        stop.latitude,
        stop.longitude
      )
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function withinRadius(stops, userLocation, radiusMiles) {
  return withDistance(stops, userLocation).filter((stop) => stop.distanceMiles <= radiusMiles);
}

function uniqueByStopId(stops) {
  const byStopId = new Map();

  for (const stop of stops) {
    const existing = byStopId.get(stop.stopId);
    if (!existing || stop.distanceMiles < existing.distanceMiles) {
      byStopId.set(stop.stopId, stop);
    }
  }

  return [...byStopId.values()].sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function selectNearestBusStopsByRouteDirection(stops) {
  const nearestByRouteDirection = new Map();
  const sortedStops = [...stops].sort((a, b) => a.distanceMiles - b.distanceMiles);

  for (const stop of sortedStops) {
    const pairs = stop.routeDirections ?? [];
    for (const pair of pairs) {
      const existing = nearestByRouteDirection.get(pair);
      if (!existing || stop.distanceMiles < existing.distanceMiles) {
        nearestByRouteDirection.set(pair, stop);
      }
    }
  }

  return uniqueByStopId([...nearestByRouteDirection.values()]);
}

export function selectNearestTrainStopsByLineDirection(stops, limitPerLineDirection = 2) {
  const selectedCounts = new Map();
  const selectedStops = [];
  const sortedStops = [...stops].sort((a, b) => a.distanceMiles - b.distanceMiles);

  for (const stop of sortedStops) {
    const directionId = stop.directionId || 'UNKNOWN';
    for (const line of stop.lines ?? []) {
      const groupKey = `${line.code}|${directionId}`;
      const currentCount = selectedCounts.get(groupKey) ?? 0;
      if (currentCount >= limitPerLineDirection) {
        continue;
      }
      selectedCounts.set(groupKey, currentCount + 1);
      selectedStops.push(stop);
    }
  }

  return uniqueByStopId(selectedStops);
}

export function chunk(array, size) {
  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

export function parseTrainApiDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export function parseBusApiDate(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0)
  );
}

export function minutesUntil(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const diffMs = date.getTime() - Date.now();
  const mins = Math.ceil(diffMs / 60000);
  return Math.max(0, mins);
}

export function formatClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatDistance(miles) {
  if (!Number.isFinite(miles)) {
    return '';
  }

  if (miles < 0.1) {
    return `${Math.round(miles * 5280)} ft`;
  }

  return `${miles.toFixed(2)} mi`;
}

export function formatMinutes(mins) {
  if (mins === null || mins === undefined) {
    return 'Unknown';
  }

  if (mins <= 0) {
    return 'Due';
  }

  if (mins === 1) {
    return '1 min';
  }

  return `${mins} min`;
}

export function nextPerRoute(predictions) {
  const grouped = new Map();

  const sorted = [...predictions].sort((a, b) => {
    const left = a.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    const right = b.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });

  for (const prediction of sorted) {
    const key = `${prediction.route}|${prediction.direction}|${prediction.destination}`;
    if (!grouped.has(key)) {
      grouped.set(key, prediction);
    }
  }

  return [...grouped.values()].sort((a, b) => {
    const left = a.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    const right = b.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
