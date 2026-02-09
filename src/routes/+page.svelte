<script>
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import 'leaflet/dist/leaflet.css';
  import { TRAIN_LINE_META, parseBusStops, parseTrainStations, withinRadius } from '$lib/cta';
  import { apiEndpoint, fetchText, withBasePath } from '$lib/api';
  import { getUserLocation } from '$lib/location';
  import { TransitArrival } from '$lib/arrivals/TransitArrival';
  import { TransitStop as TransitStopModel } from '$lib/arrivals/TransitStop';
  import { fetchBusPredictions, fetchTrainPredictions } from '$lib/arrivals/predictions';
  import { buildBusStopsFromArrivals, buildTrainStopsFromArrivals, buildUpcomingStops } from '$lib/arrivals/grouping';
  import { markerIcon, popupHtml } from '$lib/map/markers';
  import TransitStopItem from '$lib/components/TransitStop.svelte';

  const SEARCH_RADIUS_MILES = 1;
  const WALK_SPEED_MPH = 2;

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
  const IS_DEV = import.meta.env.DEV;
  let debugUserLocation = null;
  let debugFilteredBusStops = [];
  let debugFilteredTrainStations = [];
  let debugFilteredBusApiStops = [];
  let debugFilteredTrainApiStations = [];
  let debugApiResponses = [];
  let debugWrangledTransitArrivals = [];
  let debugTransitStops = [];
  let debugTrainApiResponses = [];
  let debugBusApiResponses = [];

  function debugArrivalSnapshot(arrivals) {
    return arrivals.map((arrival) => arrival.toPrediction());
  }

  function debugTransitStopSnapshot(stops, { walkSpeedMph = WALK_SPEED_MPH } = {}) {
    return stops.map((stop) => {
      const transitStop =
        stop instanceof TransitStopModel ? stop : TransitStopModel.fromStopData(stop);
      const distance = transitStop.distanceFromUser({ walkSpeedMph });
      const grouped = transitStop.groupArrivals({ walkSpeedMph });

      return {
        stopId: transitStop.stopId,
        name: transitStop.name,
        type: transitStop.type,
        distanceMiles: transitStop.distanceMiles,
        distance,
        arrivalCount: transitStop.arrivals.length,
        arrivals: transitStop.arrivals.map((arrival) => arrival.toPrediction()),
        groupedArrivals: grouped
      };
    });
  }

  function debugStopIdentityList(stops, type) {
    return stops.map((stop) => {
      const id =
        type === 'train'
          ? stop?.stationId ?? stop?.stopId ?? null
          : stop?.stopId ?? stop?.stationId ?? null;
      const name = String(stop?.displayName ?? stop?.stopName ?? '').trim();

      return {
        id: id === null ? '' : String(id),
        name: name || 'Unknown'
      };
    });
  }

  function debugApiCallMeta(entry) {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      const parsed = new URL(entry?.url ?? '', origin);
      return {
        href: parsed.toString(),
        params: Object.fromEntries(parsed.searchParams.entries())
      };
    } catch {
      return {
        href: String(entry?.url ?? ''),
        params: {}
      };
    }
  }

  function debugApiItems(entry) {
    if (!entry?.payload) {
      return [];
    }

    if (entry.mode === 'train') {
      const eta = entry.payload?.ctatt?.eta;
      return Array.isArray(eta) ? eta : eta ? [eta] : [];
    }

    if (entry.mode === 'bus') {
      const prd = entry.payload?.['bustime-response']?.prd;
      return Array.isArray(prd) ? prd : prd ? [prd] : [];
    }

    return [];
  }

  function debugApiItemCount(entry) {
    return debugApiItems(entry).length;
  }

  function debugModeItemCount(entries) {
    return entries.reduce((sum, entry) => sum + debugApiItemCount(entry), 0);
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
        icon: markerIcon(L, stop)
      });

      marker.bindPopup(popupHtml(stop, { walkSpeedMph: WALK_SPEED_MPH }), {
        maxWidth: 320
      });

      marker.addTo(markerLayer);
      points.push([stop.latitude, stop.longitude]);
    }

    map.fitBounds(points, {
      padding: [10, 10],
      maxZoom: 19
    });
  }

  async function loadApp() {
    const currentNonce = ++loadNonce;

    loading = true;
    errorMessage = '';
    nearbyStops = [];
    if (IS_DEV) {
      debugUserLocation = null;
      debugFilteredBusStops = [];
      debugFilteredTrainStations = [];
      debugFilteredBusApiStops = [];
      debugFilteredTrainApiStations = [];
      debugApiResponses = [];
      debugWrangledTransitArrivals = [];
      debugTransitStops = [];
    }

    try {
      loadingMessage = 'Requesting your location...';
      userLocation = await getUserLocation();
      if (IS_DEV) {
        debugUserLocation = userLocation;
      }
      if (currentNonce !== loadNonce) {
        return;
      }

      loadingMessage = 'Loading CTA stop datasets...';
      const [trainCsv, busCsv] = await Promise.all([
        fetchText(withBasePath('data/cta-train-stations.csv', base)),
        fetchText(withBasePath('data/cta-bus-stops.csv', base))
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
      const candidateTrainStations = nearbyTrainStations;
      const candidateBusStops = nearbyBusStops.slice(0, 10);
      if (IS_DEV) {
        debugFilteredTrainStations = nearbyTrainStations;
        debugFilteredBusStops = nearbyBusStops;
        debugFilteredTrainApiStations = debugStopIdentityList(candidateTrainStations, 'train');
        debugFilteredBusApiStops = debugStopIdentityList(candidateBusStops, 'bus');
      }

      loadingMessage = 'Loading train and bus ETAs...';
      const [trainData, busData] = await Promise.all([
        fetchTrainPredictions(candidateTrainStations, {
          endpoint: apiEndpoint('api/train'),
          onApiResponse: (entry) => {
            if (currentNonce !== loadNonce || !IS_DEV) {
              return;
            }
            debugApiResponses = [...debugApiResponses, entry];
          }
        }),
        fetchBusPredictions(candidateBusStops, {
          endpoint: apiEndpoint('api/bus'),
          onApiResponse: (entry) => {
            if (currentNonce !== loadNonce || !IS_DEV) {
              return;
            }
            debugApiResponses = [...debugApiResponses, entry];
          }
        })
      ]);
      if (currentNonce !== loadNonce) {
        return;
      }

      const enrichedTrainStops = buildTrainStopsFromArrivals(nearbyTrainStations, trainData.arrivals);
      const enrichedBusStops = buildBusStopsFromArrivals(candidateBusStops, busData.arrivals);
      const wrangledStops = [...enrichedTrainStops, ...enrichedBusStops];
      if (IS_DEV) {
        const transitStops = wrangledStops.map((stop) => TransitStopModel.fromStopData(stop));
        const wrangledArrivals = transitStops.flatMap((stop) => stop.arrivals);
        debugWrangledTransitArrivals = debugArrivalSnapshot(wrangledArrivals);
        debugTransitStops = debugTransitStopSnapshot(transitStops, {
          walkSpeedMph: WALK_SPEED_MPH
        });
      }

      nearbyStops = wrangledStops.sort(
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

  $: upcomingStops = buildUpcomingStops(nearbyStops, { walkSpeedMph: WALK_SPEED_MPH });
  $: debugTrainApiResponses = debugApiResponses.filter((entry) => entry.mode === 'train');
  $: debugBusApiResponses = debugApiResponses.filter((entry) => entry.mode === 'bus');
</script>

<svelte:head>
  <title>CTA ETA: Chicago Transit ETAs Near You</title>
  <meta
    name="description"
    content="Nearby CTA train and bus arrival times, based on your current location."
  />
</svelte:head>

<main>
  <header class="site-title">
    <h1>CTA ETA</h1>
    <h2>Chicago Transit Nearest You</h2>
  </header>

  <section class="top-layout">
    <section class="top-controls">
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
    </section>

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
  </section>

  <section>
    <h2>Upcoming Arrivals</h2>

    {#if !loading && !errorMessage && nearbyStops.length === 0}
      <p class="empty">No CTA stops found in a {SEARCH_RADIUS_MILES}-mile radius.</p>
    {:else if !loading && !errorMessage && upcomingStops.length === 0}
      <p class="empty">No live arrivals available right now.</p>
    {:else if upcomingStops.length > 0}
      <ul class="arrival-list">
        {#each upcomingStops as stop}
          <TransitStopItem {stop} />
        {/each}
      </ul>
    {/if}
  </section>

  {#if IS_DEV}
    <section class="debug">
      <h2>Debug</h2>
      <details open>
        <summary>Query Basis (User Location)</summary>
        <pre>{JSON.stringify(debugUserLocation, null, 2)}</pre>
      </details>

      <details>
        <summary>Found</summary>
        <details class="debug-subsection">
          <summary>Bus Stops ({debugFilteredBusStops.length})</summary>
          <pre>{JSON.stringify(debugFilteredBusStops, null, 2)}</pre>
        </details>
        <details class="debug-subsection">
          <summary>Train Stations ({debugFilteredTrainStations.length})</summary>
          <pre>{JSON.stringify(debugFilteredTrainStations, null, 2)}</pre>
        </details>
      </details>

      <details>
        <summary>Filtered</summary>
        <details class="debug-subsection">
          <summary>Bus Stops for API ({debugFilteredBusApiStops.length})</summary>
          {#if debugFilteredBusApiStops.length === 0}
            <p class="debug-empty">No bus stops selected for API fetches.</p>
          {:else}
            <ul class="debug-id-list">
              {#each debugFilteredBusApiStops as stop}
                <li><code>{stop.id}</code> {stop.name}</li>
              {/each}
            </ul>
          {/if}
        </details>

        <details class="debug-subsection">
          <summary>Train Stations for API ({debugFilteredTrainApiStations.length})</summary>
          {#if debugFilteredTrainApiStations.length === 0}
            <p class="debug-empty">No train stations selected for API fetches.</p>
          {:else}
            <ul class="debug-id-list">
              {#each debugFilteredTrainApiStations as station}
                <li><code>{station.id}</code> {station.name}</li>
              {/each}
            </ul>
          {/if}
        </details>
      </details>

      <details>
        <summary>API Responses ({debugApiResponses.length})</summary>
        {#if debugApiResponses.length === 0}
          <p class="debug-empty">No API responses captured yet.</p>
        {:else}
          <details class="debug-subsection">
            <summary>Train Calls ({debugTrainApiResponses.length}, {debugModeItemCount(debugTrainApiResponses)} eta items)</summary>
            {#if debugTrainApiResponses.length === 0}
              <p class="debug-empty">No train API calls captured.</p>
            {:else}
              {#each debugTrainApiResponses as response, index}
                {@const meta = debugApiCallMeta(response)}
                <details class="debug-call">
                  <summary>Call {index + 1} ({debugApiItemCount(response)} eta items)</summary>
                  <p><strong>URL:</strong> <code>{meta.href}</code></p>
                  <p><strong>Params:</strong></p>
                  <pre>{JSON.stringify(meta.params, null, 2)}</pre>
                  <p><strong>Response:</strong></p>
                  <pre>{JSON.stringify(response.payload, null, 2)}</pre>
                </details>
              {/each}
            {/if}
          </details>

          <details class="debug-subsection">
            <summary>Bus Calls ({debugBusApiResponses.length}, {debugModeItemCount(debugBusApiResponses)} prd items)</summary>
            {#if debugBusApiResponses.length === 0}
              <p class="debug-empty">No bus API calls captured.</p>
            {:else}
              {#each debugBusApiResponses as response, index}
                {@const meta = debugApiCallMeta(response)}
                <details class="debug-call">
                  <summary>Call {index + 1} ({debugApiItemCount(response)} prd items)</summary>
                  <p><strong>URL:</strong> <code>{meta.href}</code></p>
                  <p><strong>Params:</strong></p>
                  <pre>{JSON.stringify(meta.params, null, 2)}</pre>
                  <p><strong>Response:</strong></p>
                  <pre>{JSON.stringify(response.payload, null, 2)}</pre>
                </details>
              {/each}
            {/if}
          </details>
        {/if}
      </details>

      <details>
        <summary>Wrangled TransitArrival List ({debugWrangledTransitArrivals.length})</summary>
        <pre>{JSON.stringify(debugWrangledTransitArrivals, null, 2)}</pre>
      </details>

      <details>
        <summary>TransitStop Objects ({debugTransitStops.length})</summary>
        {#if debugTransitStops.length === 0}
          <p class="debug-empty">No TransitStop objects available.</p>
        {:else}
          {#each debugTransitStops as stop, index}
            <div class="debug-stop-object">
              <h3>{stop?.name || `Stop ${index + 1}`} - {stop?.type || 'unknown'} stop</h3>
              <pre>{JSON.stringify(stop, null, 2)}</pre>
            </div>
          {/each}
        {/if}
      </details>
    </section>
  {/if}
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 2px solid #ffffff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }

  :global(.stop-marker-emoji) {
    font-size: 13px;
    line-height: 1;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45));
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

  .top-layout {
    margin-top: 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  .top-controls {
    border: 1px solid #dbe4ef;
    border-radius: 12px;
    background: #ffffff;
    padding: 10px;
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
    margin-top: 0;
  }

  .map {
    height: min(30vh, 300px);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
  }

  .legend {
    display: none;
    margin: 0;
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

  :global(.popup .eta-too-far) {
    color: #770022;
    font-weight: 400;
  }

  :global(.popup .eta-near) {
    color: #665522;
    font-weight: 600;
  }

  :global(.popup .eta-normal) {
    color: #222222;
    font-weight: 400;
  }

  .empty {
    color: #5c6676;
    font-size: 0.95rem;
    margin-top: 8px;
  }

  .debug {
    margin: 0 0 28px;
    padding: 10px;
    border: 1px solid #dbe4ef;
    border-radius: 10px;
    background: #ffffff;
  }

  .debug details {
    border-top: 1px solid #edf1f8;
    padding: 8px 0;
  }

  .debug details:first-of-type {
    border-top: 0;
    padding-top: 0;
  }

  .debug summary {
    cursor: pointer;
    font-weight: 600;
    color: #1f2937;
  }

  .debug pre {
    margin: 8px 0 0;
    max-height: 240px;
    overflow: auto;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px;
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .debug-empty {
    margin: 8px 0 0;
    color: #64748b;
    font-size: 0.85rem;
  }

  .debug-subsection {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed #e2e8f0;
  }

  .debug-subsection > summary {
    padding-left: 12px;
  }

  .debug-subsection p {
    margin: 0 0 6px;
    font-size: 0.82rem;
    color: #334155;
  }

  .debug-subsection code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
  }

  .debug-id-list {
    margin: 8px 0 0;
    padding-left: 18px;
  }

  .debug-id-list li {
    margin: 4px 0;
    font-size: 0.85rem;
    color: #334155;
  }

  .debug-stop-object {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dotted #e2e8f0;
  }

  .debug-stop-object h3 {
    margin: 0 0 6px;
    font-size: 0.9rem;
    font-weight: 700;
    color: #1f2937;
  }

  .debug-call {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dotted #e2e8f0;
  }

  .debug-call > summary {
    padding-left: 24px;
  }

  .debug-call:first-of-type {
    border-top: 0;
    padding-top: 0;
  }

  @media (min-width: 900px) {
    .top-layout {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: 16px;
      row-gap: 12px;
    }

    .map-wrap {
      grid-column: 1;
      grid-row: 1 / span 2;
    }

    .top-controls {
      grid-column: 2;
      grid-row: 1;
    }

    .legend {
      grid-column: 2;
      grid-row: 2;
    }
  }

  header.site-title{
    h1{
      margin-bottom: 0.0em;
    }
    h2{
      font-size: 1em;
      margin-top: 0.3em;
    }
  }

  @media (max-width: 720px) {
    main {
      padding: 12px;
    }

    .map {
      height: 46vh;
      border-radius: 12px;
    }
  }
</style>
