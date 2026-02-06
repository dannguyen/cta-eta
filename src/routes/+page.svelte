<script>
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import keysRaw from '../../keys.toml?raw';
  import {
    TRAIN_LINE_META,
    chunk,
    escapeHtml,
    formatClock,
    formatMinutes,
    minutesUntil,
    nextPerRoute,
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
  const WALK_SPEED_MPH = 4;

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

    const entries = await Promise.all(
      stops.map(async (stop) => {
        const url = new URL('/api/train/api/1.0/ttarrivals.aspx', window.location.origin);
        url.searchParams.set('key', trainApiKey);
        url.searchParams.set('outputType', 'JSON');
        url.searchParams.set('mapid', stop.stationId ?? stop.stopId);

        try {
          const response = await fetch(url);
          const payload = await response.json();

          if (payload?.ctatt?.errCd && payload.ctatt.errCd !== '0') {
            return [stop.stopId, []];
          }

          const rawEta = payload?.ctatt?.eta;
          const etaList = Array.isArray(rawEta) ? rawEta : rawEta ? [rawEta] : [];

          const closestByRouteDestination = new Map();
          for (const eta of etaList) {
            const arrival = parseTrainApiDate(eta.arrT);
            const displayRoute = trainDisplayFromRoute(eta.rt);
            const destination = eta.destNm || 'Unknown destination';

            const normalized = {
              mode: 'train',
              route: displayRoute.name || 'Train',
              direction: `toward ${destination}`,
              destination,
              arrival,
              minutes: minutesUntil(arrival)
            };

            const key = `${normalized.route}|${destination}`;
            const existing = closestByRouteDestination.get(key);
            if (!existing || predictionTime(normalized) < predictionTime(existing)) {
              closestByRouteDestination.set(key, normalized);
            }
          }

          const normalized = [...closestByRouteDestination.values()].sort(
            (a, b) => predictionTime(a) - predictionTime(b)
          );

          return [stop.stopId, normalized];
        } catch {
          return [stop.stopId, []];
        }
      })
    );

    return new Map(entries);
  }

  async function fetchBusPredictions(stops, busApiKey) {
    const results = new Map(stops.map((stop) => [stop.stopId, []]));
    const allPredictions = [];
    const stopIds = stops.map((stop) => stop.stopId);

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
      const url = new URL('/api/bus/bustime/api/v3/getpredictions', window.location.origin);
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

    const closestByRouteDirection = new Map();
    for (const prediction of allPredictions) {
      const key = `${prediction.route}|${prediction.direction}`;
      const existing = closestByRouteDirection.get(key);

      if (!existing || predictionTime(prediction) < predictionTime(existing)) {
        closestByRouteDirection.set(key, prediction);
      }
    }

    for (const prediction of closestByRouteDirection.values()) {
      const stopPredictions = results.get(prediction.stopId) ?? [];
      stopPredictions.push(prediction);
      results.set(prediction.stopId, stopPredictions);
    }

    for (const [stopId, predictions] of results.entries()) {
      predictions.sort((a, b) => predictionTime(a) - predictionTime(b));
      results.set(stopId, predictions);
    }

    return {
      predictionsByStop: results,
      selectedStopIds: new Set([...closestByRouteDirection.values()].map((prediction) => prediction.stopId))
    };
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

  function markerIcon(stop) {
    return L.divIcon({
      className: 'stop-marker-wrapper',
      html: `<span class="stop-marker" style="background:${markerBackground(stop)}"></span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -8]
    });
  }

  function stopLinesLabel(stop) {
    if (stop.type === 'bus') {
      return 'Bus stop';
    }

    if (!stop.lines.length) {
      return 'Train station';
    }

    return stop.lines.map((line) => line.id).join(', ');
  }

  function popupHtml(stop) {
    const predictions = nextPerRoute(stop.predictions).slice(0, 8);

    const predictionMarkup = predictions.length
      ? predictions
          .map(
            (prediction) => `
              <li>
                <strong>${escapeHtml(prediction.route)}</strong>
                ${escapeHtml(prediction.direction)}
                ${prediction.destination ? `to ${escapeHtml(prediction.destination)}` : ''}
                <span>${escapeHtml(formatMinutes(prediction.minutes))} (${escapeHtml(formatClock(prediction.arrival))})</span>
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

  function arrivalMinutesText(minutes) {
    if (minutes === null || minutes === undefined) {
      return 'arriving at an unknown time';
    }

    if (minutes <= 0) {
      return 'arriving now';
    }

    if (minutes === 1) {
      return 'arriving in 1 minute';
    }

    return `arriving in ${minutes} minutes`;
  }

  function compactClock(date) {
    return formatClock(date).replace(/\s/g, '');
  }

  function walkingMinutesFromMiles(miles) {
    if (!Number.isFinite(miles)) {
      return null;
    }

    const minutes = Math.ceil((miles / WALK_SPEED_MPH) * 60);
    return Math.max(0, minutes);
  }

  function distanceWithWalkText(miles) {
    if (!Number.isFinite(miles)) {
      return '';
    }

    const walkMinutes = walkingMinutesFromMiles(miles);
    const walkText = walkMinutes === 1 ? '1 min away' : `${walkMinutes} min away`;
    return `${miles.toFixed(2)} mi, ${walkText}`;
  }

  function hexToRgb(hexColor) {
    const hex = String(hexColor ?? '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return null;
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }

  function trainBadgeStyle(routeName) {
    const lineMeta = Object.values(TRAIN_LINE_META).find(
      (line) => line.id.toLowerCase() === String(routeName ?? '').toLowerCase()
    );

    if (!lineMeta) {
      return '';
    }

    const rgb = hexToRgb(lineMeta.color);
    if (!rgb) {
      return '';
    }

    return `background-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16); border-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5);`;
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
      const keys = parseKeysFile(keysRaw);
      if (!keys.train || !keys.bus) {
        throw new Error('Could not find train and bus keys in keys.toml.');
      }

      loadingMessage = 'Requesting your location...';
      userLocation = await getUserLocation();
      if (currentNonce !== loadNonce) {
        return;
      }

      loadingMessage = 'Loading CTA stop datasets...';
      const [trainCsv, busCsv] = await Promise.all([
        fetchText('/data/cta-train-stations.csv'),
        fetchText('/data/cta-bus-stops.csv')
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
      const [trainPredictions, busData] = await Promise.all([
        fetchTrainPredictions(nearbyTrainStations, keys.train),
        fetchBusPredictions(candidateBusStops, keys.bus)
      ]);
      if (currentNonce !== loadNonce) {
        return;
      }

      const enrichedTrainStops = nearbyTrainStations.map((stop) => ({
        ...stop,
        predictions: trainPredictions.get(stop.stopId) ?? []
      }));

      const enrichedBusStops = candidateBusStops
        .filter((stop) => busData.selectedStopIds.has(stop.stopId))
        .map((stop) => ({
          ...stop,
          predictions: busData.predictionsByStop.get(stop.stopId) ?? []
        }))
        .filter((stop) => stop.predictions.length > 0);

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

  $: upcomingArrivals = nearbyStops
    .flatMap((stop) =>
      (stop.predictions ?? []).map((prediction) => ({
        etaTime: compactClock(prediction.arrival),
        type: stop.type,
        routeLabel: stop.type === 'train' ? `${prediction.route} Line` : String(prediction.route),
        typeLabel: stop.type === 'train' ? 'Train' : 'Bus',
        routeBadgeStyle: stop.type === 'train' ? trainBadgeStyle(prediction.route) : '',
        destinationDirection: destinationOrDirection(prediction),
        stopName: stop.displayName,
        distance: distanceWithWalkText(stop.distanceMiles),
        etaMinutesText: arrivalMinutesText(prediction.minutes),
        sortTime: prediction.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER
      }))
    )
    .sort((a, b) => a.sortTime - b.sortTime);
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
    {:else if !loading && !errorMessage && upcomingArrivals.length === 0}
      <p class="empty">No live arrivals available right now.</p>
    {:else if upcomingArrivals.length > 0}
      <ul class="arrival-list">
        {#each upcomingArrivals as item}
          <li class="arrival-item">
            <span class="arrival-line">
              <span class="arrival-emoji">{item.type === 'train' ? '🚆' : '🚌'}</span>
              <strong class="arrival-time">{item.etaTime}</strong>:
              <span class={`route-line ${item.type}`} style={item.routeBadgeStyle}>{item.routeLabel}</span>
              <span class="type-label">{item.typeLabel}</span>
              <span class="arrival-emphasis">({item.destinationDirection})</span>
              <span class="eta-minutes">{item.etaMinutesText}</span>
              at <span class="stop-name">{item.stopName}</span>
              <span class="distance">({item.distance})</span>
            </span>
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

  .arrival-time {
    font-weight: 700;
  }

  .route-line {
    display: inline-block;
    margin: 0 2px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid #d8e0eb;
    background: #f8fafc;
    font-weight: 700;
  }

  .route-line.train {
    border-color: #d8e0eb;
  }

  .route-line.bus {
    color: #1f2937;
  }

  .type-label {
    font-weight: 500;
    color: #334155;
  }

  .arrival-emphasis {
    font-weight: 600;
    color: #334155;
  }

  .eta-minutes {
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
  }
</style>
