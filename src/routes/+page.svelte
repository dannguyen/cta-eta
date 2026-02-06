<script>
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import keysRaw from '../../keys.toml?raw';
  import {
    TRAIN_LINE_META,
    chunk,
    escapeHtml,
    formatClock,
    formatDistance,
    formatMinutes,
    minutesUntil,
    nextPerRoute,
    parseBusApiDate,
    parseBusStops,
    parseKeysFile,
    parseTrainApiDate,
    parseTrainStops,
    selectNearestBusStopsByRouteDirection,
    selectNearestTrainStopsByLineDirection,
    withinRadius
  } from '$lib/cta';

  const SEARCH_RADIUS_MILES = 0.5;
  const SEARCH_RADIUS_METERS = SEARCH_RADIUS_MILES * 1609.344;

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
    const entries = await Promise.all(
      stops.map(async (stop) => {
        const url = new URL('/api/train/api/1.0/ttarrivals.aspx', window.location.origin);
        url.searchParams.set('key', trainApiKey);
        url.searchParams.set('outputType', 'JSON');
        url.searchParams.set('stpid', stop.stopId);
        url.searchParams.set('max', '8');

        try {
          const response = await fetch(url);
          const payload = await response.json();

          if (payload?.ctatt?.errCd && payload.ctatt.errCd !== '0') {
            return [stop.stopId, []];
          }

          const rawEta = payload?.ctatt?.eta;
          const etaList = Array.isArray(rawEta) ? rawEta : rawEta ? [rawEta] : [];

          const normalized = etaList
            .map((eta) => {
              const arrival = parseTrainApiDate(eta.arrT);
              return {
                mode: 'train',
                route: eta.rt || 'Train',
                direction: eta.stpDe || 'Inbound',
                destination: eta.destNm || '',
                arrival,
                minutes: minutesUntil(arrival)
              };
            })
            .sort((a, b) => {
              const left = a.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
              const right = b.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
              return left - right;
            });

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
    const stopIds = stops.map((stop) => stop.stopId);

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

          const stopPredictions = results.get(prediction.stpid) ?? [];
          stopPredictions.push({
            mode: 'bus',
            route: prediction.rt || 'Bus',
            direction: prediction.rtdir || 'Inbound',
            destination: prediction.des || '',
            arrival,
            minutes
          });
          results.set(prediction.stpid, stopPredictions);
        }
      } catch {
        // A failed chunk should not block the whole app.
      }
    }

    for (const [stopId, predictions] of results.entries()) {
      predictions.sort((a, b) => {
        const left = a.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
        const right = b.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
        return left - right;
      });
      results.set(stopId, predictions);
    }

    return results;
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
      return 'Train stop';
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
        <p>${escapeHtml(stop.type === 'bus' ? 'Bus stop' : 'Train stop')} • ${escapeHtml(formatDistance(stop.distanceMiles))}</p>
        <ul>${predictionMarkup}</ul>
      </div>
    `;
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
        fetchText('/data/cta-train-stops.csv'),
        fetchText('/data/cta-bus-stops.csv')
      ]);
      if (currentNonce !== loadNonce) {
        return;
      }

      const nearbyTrainStops = withinRadius(
        parseTrainStops(trainCsv),
        userLocation,
        SEARCH_RADIUS_MILES
      );
      const filteredTrainStops = selectNearestTrainStopsByLineDirection(nearbyTrainStops, 2);

      const nearbyBusStops = withinRadius(parseBusStops(busCsv), userLocation, SEARCH_RADIUS_MILES);
      const filteredBusStops = selectNearestBusStopsByRouteDirection(nearbyBusStops);

      loadingMessage = 'Loading train and bus ETAs...';
      const [trainPredictions, busPredictions] = await Promise.all([
        fetchTrainPredictions(filteredTrainStops, keys.train),
        fetchBusPredictions(filteredBusStops, keys.bus)
      ]);
      if (currentNonce !== loadNonce) {
        return;
      }

      const enrichedTrainStops = filteredTrainStops.map((stop) => ({
        ...stop,
        predictions: trainPredictions.get(stop.stopId) ?? []
      }));

      const enrichedBusStops = filteredBusStops.map((stop) => ({
        ...stop,
        predictions: busPredictions.get(stop.stopId) ?? []
      }));

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
    <h2>Nearest Stops</h2>

    {#if !loading && !errorMessage && nearbyStops.length === 0}
      <p class="empty">No CTA stops found in the default 0.5-mile radius.</p>
    {/if}

    <div class="stop-list">
      {#each nearbyStops as stop}
        <article class="stop-card">
          <div class="stop-title-row">
            <span class="dot marker" style={`background:${markerBackground(stop)}`}></span>
            <div>
              <h3>{stop.displayName}</h3>
              <p>{stopLinesLabel(stop)} • {formatDistance(stop.distanceMiles)}</p>
            </div>
          </div>

          {#if nextPerRoute(stop.predictions).length === 0}
            <p class="empty">No live predictions at this stop right now.</p>
          {:else}
            <ul>
              {#each nextPerRoute(stop.predictions) as prediction}
                <li>
                  <strong>{prediction.route}</strong>
                  {prediction.direction}
                  {#if prediction.destination}
                    to {prediction.destination}
                  {/if}
                  <span>{formatMinutes(prediction.minutes)} ({formatClock(prediction.arrival)})</span>
                </li>
              {/each}
            </ul>
          {/if}
        </article>
      {/each}
    </div>
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

  .dot.marker {
    width: 12px;
    height: 12px;
    border: 1px solid #ffffff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  section h2 {
    margin: 18px 0 10px;
    font-size: 1.1rem;
  }

  .stop-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
    gap: 12px;
    margin-bottom: 28px;
  }

  .stop-card {
    background: #fff;
    border: 1px solid #dde5f0;
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
  }

  .stop-title-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  .stop-title-row h3 {
    margin: 0;
    font-size: 1rem;
  }

  .stop-title-row p {
    margin: 2px 0 0;
    color: #4f5b6b;
    font-size: 0.86rem;
  }

  .stop-card ul {
    margin: 10px 0 0;
    padding: 0;
    list-style: none;
  }

  .stop-card li {
    border-top: 1px solid #edf1f8;
    padding: 7px 0;
    font-size: 0.88rem;
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .stop-card li span {
    color: #334155;
    white-space: nowrap;
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

    .stop-list {
      grid-template-columns: 1fr;
    }
  }
</style>
