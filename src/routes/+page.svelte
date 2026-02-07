<script>
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import {
    TRAIN_LINE_META,
    chunk,
    escapeHtml,
    formatClock,
    formatMinutes,
    minutesUntil,
    parseBusApiDate,
    parseBusStops,
    parseKeysFile,
    parseTrainApiDate,
    parseTrainStations,
    trainDisplayFromRoute,
    withinRadius
  } from '$lib/cta';

  const SEARCH_RADIUS_MILES = 0.5;
  const SEARCH_RADIUS_METERS = SEARCH_RADIUS_MILES * 1609.344;
  const WALK_SPEED_MPH = 2;
  const TRAIN_API_URL = 'https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx';
  const BUS_API_URL = 'https://www.ctabustracker.com/bustime/api/v3/getpredictions';

  let loading = false;
  let loadingMessage = '';
  let errorMessage = '';

  let userLocation = null;
  let nearbyStops = [];

  let mapContainer;
  let map;
  let markerLayer;
  let L;

  let loadNonce = 0;

  function withBasePath(path) {
    const normalizedPath = String(path).replace(/^\/+/, '');

    if (typeof document !== 'undefined') {
      return new URL(normalizedPath, document.baseURI).toString();
    }

    const base = import.meta.env.BASE_URL || '/';
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${normalizedBase}${normalizedPath}`;
  }

  async function getUserLocation() {
    if (!navigator.geolocation) {
      throw new Error('This browser does not support geolocation.');
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        () => reject(new Error('Location access is required to find nearby CTA stops.')),
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30000
        }
      );
    });
  }

  async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed for ${url}`);
    }
    return response.text();
  }

  async function loadApiKeys() {
    if (import.meta.env.DEV) {
      try {
        return parseKeysFile(await fetchText(withBasePath('keys.toml')));
      } catch {
        return { train: '', bus: '' };
      }
    }

    return {
      train: String(import.meta.env.VITE_TRAIN_API_KEY ?? '').trim(),
      bus: String(import.meta.env.VITE_BUS_API_KEY ?? '').trim()
    };
  }

  async function fetchTrainPredictions(stops, trainApiKey) {
    const predictionTime = (prediction) => {
      if (prediction.arrival instanceof Date && !Number.isNaN(prediction.arrival.getTime())) {
        return prediction.arrival.getTime();
      }

      if (Number.isFinite(prediction.minutes)) {
        return Date.now() + prediction.minutes * 60000;
      }

      return Number.MAX_SAFE_INTEGER;
    };

    const distanceByStationId = new Map(
      stops.map((stop) => [String(stop.stationId ?? stop.stopId), stop.distanceMiles])
    );

    const perStationPredictions = await Promise.all(
      stops.map(async (stop) => {
        const url = new URL(TRAIN_API_URL);
        url.searchParams.set('key', trainApiKey);
        url.searchParams.set('outputType', 'JSON');
        url.searchParams.set('mapid', stop.stationId ?? stop.stopId);

        try {
          const response = await fetch(url);
          const payload = await response.json();

          if (payload?.ctatt?.errCd && payload.ctatt.errCd !== '0') {
            return [];
          }

          const rawEta = payload?.ctatt?.eta;
          const etaList = Array.isArray(rawEta) ? rawEta : rawEta ? [rawEta] : [];
          const predictions = [];

          for (const eta of etaList) {
            const arrival = parseTrainApiDate(eta.arrT);
            const displayRoute = trainDisplayFromRoute(eta.rt);
            const destination = eta.destNm || 'Unknown destination';

            predictions.push({
              mode: 'train',
              stopId: String(eta.staId || stop.stationId || stop.stopId),
              route: displayRoute.name || 'Train',
              direction: `toward ${destination}`,
              destination,
              arrival,
              minutes: minutesUntil(arrival)
            });
          }

          return predictions;
        } catch {
          return [];
        }
      })
    );

    const allPredictions = perStationPredictions.flat();
    const predictionsByRouteDestination = new Map();

    for (const prediction of allPredictions) {
      const key = `${prediction.route}|${prediction.destination}`;
      const group = predictionsByRouteDestination.get(key) ?? [];
      group.push(prediction);
      predictionsByRouteDestination.set(key, group);
    }

    const results = new Map(stops.map((stop) => [stop.stopId, []]));
    const selectedStopIds = new Set();

    for (const group of predictionsByRouteDestination.values()) {
      const stationIds = [...new Set(group.map((prediction) => prediction.stopId))].filter((stationId) =>
        distanceByStationId.has(stationId)
      );

      stationIds.sort(
        (a, b) =>
          (distanceByStationId.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (distanceByStationId.get(b) ?? Number.MAX_SAFE_INTEGER)
      );

      const chosenStationId = stationIds[0];
      if (!chosenStationId) {
        continue;
      }

      const topTwo = group
        .filter((prediction) => prediction.stopId === chosenStationId)
        .sort((a, b) => predictionTime(a) - predictionTime(b))
        .slice(0, 2);

      if (!topTwo.length) {
        continue;
      }

      selectedStopIds.add(chosenStationId);
      const stationPredictions = results.get(chosenStationId) ?? [];
      stationPredictions.push(...topTwo);
      results.set(chosenStationId, stationPredictions);
    }

    for (const [stationId, predictions] of results.entries()) {
      predictions.sort((a, b) => predictionTime(a) - predictionTime(b));
      results.set(stationId, predictions);
    }

    return {
      predictionsByStop: results,
      selectedStopIds
    };
  }

  async function fetchBusPredictions(stops, busApiKey) {
    const results = new Map(stops.map((stop) => [stop.stopId, []]));
    const allPredictions = [];
    const stopIds = stops.map((stop) => stop.stopId);
    const distanceByStopId = new Map(stops.map((stop) => [String(stop.stopId), stop.distanceMiles]));

    const predictionTime = (prediction) => {
      if (prediction.arrival instanceof Date && !Number.isNaN(prediction.arrival.getTime())) {
        return prediction.arrival.getTime();
      }

      if (Number.isFinite(prediction.minutes)) {
        return Date.now() + prediction.minutes * 60000;
      }

      return Number.MAX_SAFE_INTEGER;
    };

    for (const idsChunk of chunk(stopIds, 10)) {
      const url = new URL(BUS_API_URL);
      url.searchParams.set('key', busApiKey);
      url.searchParams.set('format', 'json');
      url.searchParams.set('stpid', idsChunk.join(','));
      url.searchParams.set('top', '40');

      try {
        const response = await fetch(url);
        const payload = await response.json();

        const rawPredictions = payload?.['bustime-response']?.prd;
        const predictionList = Array.isArray(rawPredictions)
          ? rawPredictions
          : rawPredictions
            ? [rawPredictions]
            : [];

        for (const prediction of predictionList) {
          const arrival = parseBusApiDate(prediction.prdtm);
          const fallbackMinutes = minutesUntil(arrival);
          const countdown = Number(prediction.prdctdn);
          const minutes = Number.isFinite(countdown)
            ? Math.max(0, countdown)
            : prediction.prdctdn === 'DUE'
              ? 0
              : fallbackMinutes;

          const normalized = {
            mode: 'bus',
            stopId: prediction.stpid,
            stopName: prediction.stpnm || '',
            route: prediction.rt || 'Bus',
            direction: prediction.rtdir || 'Inbound',
            destination: prediction.des || '',
            arrival,
            minutes
          };

          allPredictions.push(normalized);
        }
      } catch {
        // A failed chunk should not block the whole app.
      }
    }

    const predictionsByRouteDirection = new Map();
    for (const prediction of allPredictions) {
      const key = `${prediction.route}|${prediction.direction}`;
      const group = predictionsByRouteDirection.get(key) ?? [];
      group.push(prediction);
      predictionsByRouteDirection.set(key, group);
    }

    const selectedStopIds = new Set();
    for (const group of predictionsByRouteDirection.values()) {
      const closestStops = [...new Set(group.map((prediction) => String(prediction.stopId)))]
        .filter((stopId) => distanceByStopId.has(stopId))
        .sort(
          (a, b) =>
            (distanceByStopId.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (distanceByStopId.get(b) ?? Number.MAX_SAFE_INTEGER)
        )
        .slice(0, 2);

      for (const stopId of closestStops) {
        const topTwo = group
          .filter((prediction) => String(prediction.stopId) === stopId)
          .sort((a, b) => predictionTime(a) - predictionTime(b))
          .slice(0, 2);

        if (!topTwo.length) {
          continue;
        }

        selectedStopIds.add(stopId);
        const stopPredictions = results.get(stopId) ?? [];
        stopPredictions.push(...topTwo);
        results.set(stopId, stopPredictions);
      }
    }

    for (const [stopId, predictions] of results.entries()) {
      predictions.sort((a, b) => predictionTime(a) - predictionTime(b));
      results.set(stopId, predictions);
    }

    return {
      predictionsByStop: results,
      selectedStopIds
    };
  }

  function groupBusStopsByName(candidateBusStops, busData) {
    const stopById = new Map(candidateBusStops.map((stop) => [String(stop.stopId), stop]));
    const grouped = new Map();

    for (const stopId of busData.selectedStopIds) {
      const stop = stopById.get(String(stopId));
      if (!stop) {
        continue;
      }

      const predictions = busData.predictionsByStop.get(String(stopId)) ?? [];
      for (const prediction of predictions) {
        const stopName = String(prediction.stopName || stop.displayName || '').trim() || stop.displayName;
        const key = stopName.toUpperCase();

        let group = grouped.get(key);
        if (!group) {
          group = {
            type: 'bus',
            stopId: `bus:${key}`,
            displayName: stopName,
            members: new Map(),
            routeDirections: new Map()
          };
          grouped.set(key, group);
        }

        group.members.set(String(stop.stopId), stop);

        const route = String(prediction.route || 'Bus').trim() || 'Bus';
        const direction = String(prediction.direction || 'Inbound').trim() || 'Inbound';
        const routeKey = `${route}|${direction}`;

        const directionPredictions = group.routeDirections.get(routeKey) ?? [];
        directionPredictions.push({
          ...prediction,
          route,
          direction
        });
        group.routeDirections.set(routeKey, directionPredictions);
      }
    }

    return [...grouped.values()].map((group) => {
      const members = [...group.members.values()];
      const latitude =
        members.reduce((sum, member) => sum + member.latitude, 0) / Math.max(1, members.length);
      const longitude =
        members.reduce((sum, member) => sum + member.longitude, 0) / Math.max(1, members.length);
      const distanceMiles = members.reduce(
        (minDistance, member) => Math.min(minDistance, member.distanceMiles),
        Number.MAX_SAFE_INTEGER
      );
      const predictionSortTime = (prediction) => prediction.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;

      const predictions = [...group.routeDirections.values()]
        .flatMap((directionPredictions) =>
          [...directionPredictions].sort((a, b) => predictionSortTime(a) - predictionSortTime(b)).slice(0, 2)
        )
        .sort((a, b) => predictionSortTime(a) - predictionSortTime(b));

      return {
        type: 'bus',
        stopId: group.stopId,
        displayName: group.displayName,
        latitude,
        longitude,
        distanceMiles,
        predictions
      };
    });
  }

  function markerBackground(stop) {
    if (stop.type === 'bus') {
      return '#151515';
    }

    const colors = stop.lines.map((line) => line.color);

    if (colors.length === 0) {
      return '#4c566a';
    }

    if (colors.length === 1) {
      return colors[0];
    }

    const slice = 100 / colors.length;
    const parts = colors.map((color, index) => {
      const start = (slice * index).toFixed(2);
      const end = (slice * (index + 1)).toFixed(2);
      return `${color} ${start}% ${end}%`;
    });

    return `conic-gradient(${parts.join(', ')})`;
  }

  function busMarkerLines(stop) {
    const routes = [...new Set((stop.predictions ?? []).map((prediction) => String(prediction.route)))]
      .map((route) => route.trim())
      .filter(Boolean);

    if (!routes.length) {
      return ['Bus'];
    }

    const visibleRoutes = routes.slice(0, 3);
    if (routes.length > 3) {
      visibleRoutes.push('...');
    }
    return visibleRoutes;
  }

  function markerIcon(stop) {
    if (stop.type === 'bus') {
      const lines = busMarkerLines(stop);
      const lineHtml = lines
        .map((line) => `<span class="bus-marker-line">${escapeHtml(line)}</span>`)
        .join('');
      const height = 10 + lines.length * 11;

      return L.divIcon({
        className: 'stop-marker-wrapper',
        html: `<span class="bus-marker">${lineHtml}</span>`,
        iconSize: [56, height],
        iconAnchor: [28, Math.round(height / 2)],
        popupAnchor: [0, -10]
      });
    }

    return L.divIcon({
      className: 'stop-marker-wrapper',
      html: `<span class="stop-marker" style="background:${markerBackground(stop)}"></span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -8]
    });
  }

  function busDirectionOnly(prediction) {
    return String(prediction.direction ?? '').trim() || 'N/A';
  }

  function destinationOrDirection(prediction) {
    const direction = String(prediction.direction ?? '').trim();
    const destination = String(prediction.destination ?? '').trim();

    if (direction && destination) {
      const normalizedDirection = direction.toLowerCase();
      const normalizedDestination = destination.toLowerCase();
      if (
        normalizedDirection.includes(normalizedDestination) ||
        normalizedDirection.includes('toward') ||
        normalizedDirection.includes('to ')
      ) {
        return direction;
      }
      return `${direction} to ${destination}`;
    }

    return direction || destination || 'N/A';
  }

  function popupHtml(stop) {
    const walkMinutes = walkingMinutesFromMiles(stop.distanceMiles);
    const predictions = [...(stop.predictions ?? [])]
      .sort((a, b) => {
        const left = a.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
        const right = b.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
        return left - right;
      })
      .slice(0, 8);

    const predictionMarkup = predictions.length
      ? predictions
          .map(
            (prediction) => `
              <li>
                <strong>${escapeHtml(prediction.route)}</strong>
                ${escapeHtml(
                  prediction.mode === 'bus'
                    ? busDirectionOnly(prediction)
                    : destinationOrDirection(prediction)
                )}
                <span class="${etaTimingClass(prediction.minutes, walkMinutes)}">${escapeHtml(
                  formatMinutes(prediction.minutes)
                )} (${escapeHtml(formatClock(prediction.arrival))})</span>
              </li>
            `
          )
          .join('')
      : '<li>No live predictions at this time.</li>';

    return `
      <div class="popup">
        <h3>${escapeHtml(stop.displayName)}</h3>
        <p>${escapeHtml(stop.type === 'bus' ? 'Bus stop' : 'Train station')} • ${escapeHtml(distanceWithWalkText(stop.distanceMiles))}</p>
        <ul>${predictionMarkup}</ul>
      </div>
    `;
  }

  function arrivalPrefixText(minutes) {
    if (minutes === null || minutes === undefined) {
      return 'arriving at';
    }

    if (minutes <= 0) {
      return 'arriving';
    }

    return 'arriving in';
  }

  function etaValueText(minutes) {
    if (minutes === null || minutes === undefined) {
      return 'unknown time';
    }

    if (minutes <= 0) {
      return 'now';
    }

    return String(minutes);
  }

  function etaUnitText(minutes) {
    if (minutes === null || minutes === undefined || minutes <= 0) {
      return '';
    }

    return minutes === 1 ? 'minute' : 'minutes';
  }

  function etaTimingClass(etaMinutes, walkMinutes) {
    if (!Number.isFinite(etaMinutes) || !Number.isFinite(walkMinutes)) {
      return 'eta-blue';
    }

    if (etaMinutes <= 0 || etaMinutes < walkMinutes) {
      return 'eta-red';
    }

    const delta = etaMinutes - walkMinutes;
    if (delta >= 1 && delta <= 3) {
      return 'eta-orange';
    }

    return 'eta-blue';
  }

  function compactClock(date) {
    return formatClock(date).replace(/\s/g, '');
  }

  function walkingMinutesFromMiles(miles) {
    if (!Number.isFinite(miles)) {
      return null;
    }

    const feet = miles * 5280;
    const baseMinutes = Math.ceil((miles / WALK_SPEED_MPH) * 60);
    const extraMinutes = Math.ceil(feet / 500);
    return Math.max(0, baseMinutes + extraMinutes);
  }

  function distanceOnlyText(miles) {
    if (!Number.isFinite(miles)) {
      return '';
    }

    return miles < 0.6 ? `${Math.round(miles * 5280)} ft` : `${miles.toFixed(2)} mi`;
  }

  function walkingAwayText(miles) {
    const walkMinutes = walkingMinutesFromMiles(miles);
    return walkMinutes === 1 ? '1 min away' : `${walkMinutes} min away`;
  }

  function distanceWithWalkText(miles) {
    if (!Number.isFinite(miles)) {
      return '';
    }

    return `${distanceOnlyText(miles)}, ${walkingAwayText(miles)}`;
  }

  async function ensureLeaflet() {
    if (L) {
      return;
    }

    const leafletModule = await import('leaflet');
    L = leafletModule.default ?? leafletModule;
  }

  async function drawMap() {
    if (!mapContainer || !userLocation) {
      return;
    }

    await ensureLeaflet();

    if (!map) {
      map = L.map(mapContainer, {
        zoomControl: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      markerLayer = L.layerGroup().addTo(map);
    }

    markerLayer.clearLayers();

    const points = [[userLocation.latitude, userLocation.longitude]];

    L.circle([userLocation.latitude, userLocation.longitude], {
      radius: SEARCH_RADIUS_METERS,
      color: '#1f6feb',
      weight: 2,
      dashArray: '6 6',
      fillOpacity: 0.04
    }).addTo(markerLayer);

    L.circleMarker([userLocation.latitude, userLocation.longitude], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#1f6feb',
      fillOpacity: 1
    })
      .bindPopup('Your location')
      .addTo(markerLayer);

    for (const stop of nearbyStops) {
      const marker = L.marker([stop.latitude, stop.longitude], {
        icon: markerIcon(stop)
      });

      marker.bindPopup(popupHtml(stop), {
        maxWidth: 320
      });

      marker.addTo(markerLayer);
      points.push([stop.latitude, stop.longitude]);
    }

    map.fitBounds(points, {
      padding: [32, 32],
      maxZoom: 16
    });
  }

  async function loadApp() {
    const currentNonce = ++loadNonce;

    loading = true;
    errorMessage = '';
    nearbyStops = [];

    try {
      loadingMessage = 'Loading CTA API keys...';
      const keys = await loadApiKeys();
      if (!keys.train || !keys.bus) {
        throw new Error(
          import.meta.env.DEV
            ? 'Could not find CTA API keys in static/keys.toml.'
            : 'Could not find CTA API keys in build env (VITE_TRAIN_API_KEY / VITE_BUS_API_KEY).'
        );
      }

      loadingMessage = 'Requesting your location...';
      userLocation = await getUserLocation();
      if (currentNonce !== loadNonce) {
        return;
      }

      loadingMessage = 'Loading CTA stop datasets...';
      const [trainCsv, busCsv] = await Promise.all([
        fetchText(withBasePath('data/cta-train-stations.csv')),
        fetchText(withBasePath('data/cta-bus-stops.csv'))
      ]);
      if (currentNonce !== loadNonce) {
        return;
      }

      const nearbyTrainStations = withinRadius(
        parseTrainStations(trainCsv),
        userLocation,
        SEARCH_RADIUS_MILES
      );

      const nearbyBusStops = withinRadius(parseBusStops(busCsv), userLocation, SEARCH_RADIUS_MILES);
      const candidateBusStops = nearbyBusStops.slice(0, 10);

      loadingMessage = 'Loading train and bus ETAs...';
      const [trainData, busData] = await Promise.all([
        fetchTrainPredictions(nearbyTrainStations, keys.train),
        fetchBusPredictions(candidateBusStops, keys.bus)
      ]);
      if (currentNonce !== loadNonce) {
        return;
      }

      const enrichedTrainStops = nearbyTrainStations
        .filter((stop) => trainData.selectedStopIds.has(stop.stopId))
        .map((stop) => ({
          ...stop,
          predictions: trainData.predictionsByStop.get(stop.stopId) ?? []
        }))
        .filter((stop) => stop.predictions.length > 0);

      const enrichedBusStops = groupBusStopsByName(candidateBusStops, busData).filter(
        (stop) => stop.predictions.length > 0
      );

      nearbyStops = [...enrichedTrainStops, ...enrichedBusStops].sort(
        (a, b) => a.distanceMiles - b.distanceMiles
      );

      await drawMap();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load CTA data.';
    } finally {
      if (currentNonce === loadNonce) {
        loading = false;
        loadingMessage = '';
      }
    }
  }

  function reload() {
    loadApp();
  }

  onMount(() => {
    loadApp();

    return () => {
      loadNonce += 1;
      if (map) {
        map.remove();
        map = undefined;
      }
    };
  });

  $: stopCounts = {
    total: nearbyStops.length,
    bus: nearbyStops.filter((stop) => stop.type === 'bus').length,
    train: nearbyStops.filter((stop) => stop.type === 'train').length
  };

  $: visibleTrainLineCodes = new Set(
    nearbyStops
      .filter((stop) => stop.type === 'train')
      .flatMap((stop) => stop.lines.map((line) => line.code))
  );

  $: legendEntries = [
    ...(nearbyStops.some((stop) => stop.type === 'bus')
      ? [{ label: 'Bus stop', color: '#151515' }]
      : []),
    ...Object.values(TRAIN_LINE_META)
      .filter((line) => visibleTrainLineCodes.has(line.code))
      .map((line) => ({ label: line.id, color: line.color }))
  ];

  $: upcomingStops = nearbyStops
    .filter((stop) => (stop.predictions?.length ?? 0) > 0)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .map((stop) => {
      const walkMinutes = walkingMinutesFromMiles(stop.distanceMiles);
      const groupedByDirection = new Map();

      for (const prediction of stop.predictions ?? []) {
        const routeName = String(prediction.route);
        const directionLabel =
          stop.type === 'bus' ? busDirectionOnly(prediction) : destinationOrDirection(prediction);
        const directionGroup = groupedByDirection.get(directionLabel) ?? {
          direction: directionLabel,
          routes: new Map()
        };
        const routeGroup = directionGroup.routes.get(routeName) ?? {
          route: routeName,
          typeLabel: stop.type === 'train' ? 'Train' : 'Bus',
          etas: []
        };
        routeGroup.etas.push(prediction);
        directionGroup.routes.set(routeName, routeGroup);
        groupedByDirection.set(directionLabel, directionGroup);
      }

      const directions = [...groupedByDirection.values()]
        .map((directionGroup) => ({
          direction: directionGroup.direction,
          routes: [...directionGroup.routes.values()]
            .map((routeGroup) => ({
              route: routeGroup.route,
              typeLabel: routeGroup.typeLabel,
              etas: [...routeGroup.etas]
                .sort((a, b) => {
                  const left = a.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
                  const right = b.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
                  return left - right;
                })
                .slice(0, 2)
                .map((eta) => ({
                  minutes: eta.minutes,
                  prefixText: arrivalPrefixText(eta.minutes),
                  clockText: compactClock(eta.arrival),
                  timingClass: etaTimingClass(eta.minutes, walkMinutes),
                  sortTime: eta.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER
                }))
            }))
            .sort((a, b) => {
              const routeCompare = a.route.localeCompare(b.route, undefined, {
                numeric: true,
                sensitivity: 'base'
              });
              if (routeCompare !== 0) {
                return routeCompare;
              }
              const left = a.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER;
              const right = b.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER;
              return left - right;
            })
        }))
        .sort((a, b) => {
          const directionCompare = a.direction.localeCompare(b.direction, undefined, {
            numeric: true,
            sensitivity: 'base'
          });
          if (directionCompare !== 0) {
            return directionCompare;
          }
          const left = a.routes[0]?.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER;
          const right = b.routes[0]?.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER;
          return left - right;
        });

      return {
        stopId: stop.stopId,
        icon: stop.type === 'train' ? '🚆' : '🚌',
        distanceText: distanceOnlyText(stop.distanceMiles),
        walkText: walkingAwayText(stop.distanceMiles),
        stopName: stop.displayName,
        directions
      };
    });
</script>

<svelte:head>
  <title>CTA ETA Web App</title>
  <meta
    name="description"
    content="Nearby CTA train and bus arrival times, based on your current location."
  />
</svelte:head>

<main>
  <header>
    <h1>CTA Nearby ETAs</h1>
    <p>
      Nearest CTA rail stops and bus stops within
      <strong>{SEARCH_RADIUS_MILES.toFixed(1)} mile</strong>
      of your current location.
    </p>
    <div class="toolbar">
      <button type="button" on:click={reload} disabled={loading}>Refresh</button>
      {#if loading}
        <span class="status">{loadingMessage}</span>
      {:else if errorMessage}
        <span class="status error">{errorMessage}</span>
      {:else}
        <span class="status">
          {stopCounts.total} nearby stops ({stopCounts.train} train, {stopCounts.bus} bus)
        </span>
      {/if}
    </div>
  </header>

  <section class="map-wrap">
    <div class="map" bind:this={mapContainer}></div>
  </section>

  {#if legendEntries.length > 0}
    <section class="legend">
      <h2>Legend</h2>
      <div class="chips">
        {#each legendEntries as item}
          <span class="chip">
            <span class="dot" style={`background:${item.color}`}></span>
            {item.label}
          </span>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h2>Upcoming Arrivals</h2>

    {#if !loading && !errorMessage && nearbyStops.length === 0}
      <p class="empty">No CTA stops found in the default 0.5-mile radius.</p>
    {:else if !loading && !errorMessage && upcomingStops.length === 0}
      <p class="empty">No live arrivals available right now.</p>
    {:else if upcomingStops.length > 0}
      <ul class="arrival-list">
        {#each upcomingStops as stop}
          <li class="arrival-item">
            <div class="stop-header">
              <span class="arrival-emoji">{stop.icon}</span>
              <span class="distance">{stop.distanceText}</span>
              <span>({stop.walkText}):</span>
              <span class="stop-name">{stop.stopName}</span>
            </div>
            <ul class="route-list">
              {#each stop.directions as direction}
                <li class="direction-group-item">
                  <span class="route-dash">-</span>
                  <span class="arrival-emphasis">{direction.direction}:</span>
                  <ul class="direction-list">
                    {#each direction.routes as route}
                      <li class="route-item">
                        <span class="route-name">{route.route}</span>
                        <span>{route.typeLabel}</span>
                        {#each route.etas as eta, etaIndex}
                          {#if etaIndex === 0}
                            <span class="eta-prefix">{eta.prefixText}</span>
                            <span class={`eta-part ${eta.timingClass}`}>{etaValueText(eta.minutes)}</span>
                            {#if etaUnitText(eta.minutes)}
                              <span class="eta-unit">{etaUnitText(eta.minutes)}</span>
                            {/if}
                            <span class={`eta-part ${eta.timingClass}`}>({eta.clockText})</span>
                          {:else}
                            <span class="eta-join">and</span>
                            <span class={`eta-part ${eta.timingClass}`}>{etaValueText(eta.minutes)}</span>
                            {#if etaUnitText(eta.minutes)}
                              <span class="eta-unit">{etaUnitText(eta.minutes)}</span>
                            {/if}
                            <span class={`eta-part ${eta.timingClass}`}>({eta.clockText})</span>
                          {/if}
                        {/each}
                      </li>
                    {/each}
                  </ul>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background: #f5f7fb;
    color: #18202a;
    font-family: 'Avenir Next', 'Segoe UI', sans-serif;
  }

  :global(.stop-marker-wrapper) {
    background: transparent;
    border: 0;
  }

  :global(.stop-marker) {
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    border: 2px solid #ffffff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }

  :global(.bus-marker) {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    padding: 3px 6px;
    border-radius: 10px;
    border: 2px solid #ffffff;
    background: #111111;
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.05;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }

  :global(.bus-marker-line) {
    display: block;
    white-space: nowrap;
  }

  :global(.popup h3) {
    margin: 0 0 4px;
    font-size: 14px;
  }

  :global(.popup p) {
    margin: 0 0 8px;
    font-size: 12px;
    color: #4b5563;
  }

  :global(.popup ul) {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  :global(.popup li) {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0;
    border-top: 1px solid #ebeff5;
    font-size: 12px;
  }

  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px;
  }

  header h1 {
    margin: 0;
    font-size: clamp(1.6rem, 3vw, 2.2rem);
  }

  header p {
    margin: 6px 0 14px;
    color: #4f5b6b;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  button {
    border: 0;
    border-radius: 10px;
    padding: 10px 14px;
    background: #1f6feb;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .status {
    color: #334155;
    font-size: 0.95rem;
  }

  .status.error {
    color: #b42318;
  }

  .map-wrap {
    margin-top: 16px;
  }

  .map {
    height: min(60vh, 560px);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
  }

  .legend {
    margin: 14px 0 6px;
  }

  .legend h2 {
    margin: 0 0 8px;
    font-size: 1rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #d6deea;
    background: #fff;
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 0.85rem;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  section h2 {
    margin: 18px 0 10px;
    font-size: 1.1rem;
  }

  .arrival-list {
    list-style: none;
    margin: 0 0 28px;
    padding: 0;
    background: #fff;
    border: 1px solid #dde5f0;
    border-radius: 10px;
    overflow: hidden;
  }

  .arrival-item {
    padding: 7px 10px;
    border-top: 1px solid #edf1f8;
    font-size: 0.88rem;
    line-height: 1.25;
  }

  .arrival-item:first-child {
    border-top: 0;
  }

  .arrival-emoji {
    margin-right: 6px;
  }

  .stop-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .route-list {
    list-style: none;
    margin: 4px 0 0 0;
    padding: 0 0 0 16px;
  }

  .direction-group-item {
    margin: 2px 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: flex-start;
  }

  .route-dash {
    margin-left: -12px;
    width: 8px;
  }

  .route-name {
    font-weight: 700;
  }

  .arrival-emphasis {
    font-weight: 600;
    color: #334155;
  }

  .direction-list {
    list-style: none;
    margin: 0;
    padding: 0 0 0 10px;
    width: 100%;
  }

  .route-item {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 1px;
  }

  .eta-part {
    white-space: nowrap;
  }

  .eta-prefix {
    color: #344054;
  }

  .eta-unit {
    color: #344054;
  }

  .eta-join {
    color: #344054;
  }

  .eta-red,
  :global(.popup .eta-red) {
    color: #b42318;
    font-weight: 700;
  }

  .eta-orange,
  :global(.popup .eta-orange) {
    color: #b54708;
    font-weight: 700;
  }

  .eta-blue,
  :global(.popup .eta-blue) {
    color: #175cd3;
    font-weight: 700;
  }

  .stop-name {
    font-weight: 700;
    color: #0f172a;
  }

  .distance {
    color: #475569;
    font-weight: 600;
  }

  .empty {
    color: #5c6676;
    font-size: 0.95rem;
    margin-top: 8px;
  }

  @media (max-width: 720px) {
    main {
      padding: 12px;
    }

    .map {
      height: 46vh;
      border-radius: 12px;
    }

    .arrival-item {
      padding: 6px 8px;
      font-size: 0.84rem;
      line-height: 1.2;
    }

    .route-list {
      padding-left: 12px;
    }
  }
</style>
