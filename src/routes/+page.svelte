<script>
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import 'leaflet/dist/leaflet.css';
  import { TRAIN_LINE_META, parseBusStops, parseTrainStations, withinRadius } from '$lib/cta';
  import { apiEndpoint, fetchText, withBasePath } from '$lib/api';
  import { getUserLocation } from '$lib/location';
  import { fetchBusPredictions, fetchTrainPredictions } from '$lib/arrivals/predictions';
  import { buildUpcomingStops, groupBusStopsByName } from '$lib/arrivals/grouping';
  import { etaUnitText, etaValueText } from '$lib/arrivals/formatting';
  import { markerIcon, popupHtml } from '$lib/map/markers';

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

    try {
      loadingMessage = 'Requesting your location...';
      userLocation = await getUserLocation();
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
      const candidateBusStops = nearbyBusStops.slice(0, 10);

      loadingMessage = 'Loading train and bus ETAs...';
      const [trainData, busData] = await Promise.all([
        fetchTrainPredictions(nearbyTrainStations, { endpoint: apiEndpoint('api/train') }),
        fetchBusPredictions(candidateBusStops, { endpoint: apiEndpoint('api/bus') })
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

  $: upcomingStops = buildUpcomingStops(nearbyStops, { walkSpeedMph: WALK_SPEED_MPH });
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
      <p class="empty">No CTA stops found in the default 0.5-mile radius.</p>
    {:else if !loading && !errorMessage && upcomingStops.length === 0}
      <p class="empty">No live arrivals available right now.</p>
    {:else if upcomingStops.length > 0}
      <ul class="arrival-list">
        {#each upcomingStops as stop}
          <li class="arrival-item">
            <div class="stop-header">

              <span class="stop-name">
                <span class="arrival-emoji">{stop.icon}</span>
                  <span class="name">{stop.stopName}</span>
                  <span class="category">{stop.stopCategory}</span>


              </span>

              <span class="stop-info">
                <span class="distance">{stop.distanceText}</span>
                <span>({stop.walkText})</span>

              </span>

            </div>

            <ul class="route-list">
              {#if stop.type === 'train'}
                {#each stop.routes as route}
                  <li class="direction-group-item">
                    <ul class="direction-list">
                      {#each route.destinations as destination, destinationIndex}
                        <li class="route-item train">
                          <span class="group-label" class:ghost={destinationIndex > 0}>
                            <span class="route-name train {route.route.toLowerCase()}">
                              {route.route}
                              <span class="route-type">Line</span>
                            </span>
                          </span>
                          <span class="route-label arrival-emphasis">{destination.direction}</span>
                          <span class="eta-stack">
                            {#each destination.etas as eta}
                              <span class="eta-line">
                                <span class={`eta-part eta-min ${eta.timingClass} ${eta.descriptor}`}>
                                  <span class="eta-value">{etaValueText(eta.minutes)}</span>
                                  {#if etaUnitText(eta.minutes)}
                                    <span class="eta-unit">{etaUnitText(eta.minutes)}</span>
                                  {/if}
                                </span>
                                <span class={`eta-part clock`}>{eta.clockText}</span>
                              </span>
                            {/each}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  </li>
                {/each}
              {:else}
                {#each stop.directions as direction}
                  <li class="direction-group-item">
                    <ul class="direction-list">
                      {#each direction.routes as route, routeIndex}
                        <li class="route-item bus">
                          <span class="group-label arrival-emphasis" class:ghost={routeIndex > 0}>
                            {direction.direction}
                          </span>
                          <span class="route-label">
                            <span class="route-name">{route.route}</span>
                            <span class="route-type">{route.typeLabel}</span>
                          </span>
                          <span class="eta-stack">
                            {#each route.etas as eta}
                              <span class="eta-line">
                                <span class={`eta-part eta-min ${eta.timingClass} ${eta.descriptor}`}>
                                  <span class="eta-value">{etaValueText(eta.minutes)}</span>
                                  {#if etaUnitText(eta.minutes)}
                                    <span class="eta-unit">{etaUnitText(eta.minutes)}</span>
                                  {/if}
                                </span>
                                <span class={`eta-part clock`}>{eta.clockText}</span>
                              </span>
                            {/each}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  </li>
                {/each}
              {/if}
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

  .arrival-record {
    margin-bottom: 1.0em;
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
    padding: 0 0 0 0px;
  }

  .direction-group-item {
    margin: 2px 0;
    display: block;
  }


  .route-name {
    font-weight: 400;
    padding: 0.1rem 0.2rem;
    border: thin solid gray;
  }

  .route-name.bus{
    align-self: flex-start;
    font-weight: 600;
    border-radius: 5%;
  }

  .route-name.train{
     font-weight: 600;
     color: white;
  }

 .route-name.blue{
    background: #0000cc;
  }

  .route-name.brown{
    background: brown;
  }


 .route-name.green{
    background: #00cc00;
  }

 .route-name.orange{
    background: orange;
  }

 .route-name.purple{
    background: purple;
  }
  .route-name.red{
    background: #cc0000;
  }

  .route-name.yellow{
    background: yellow;
  }


  .arrival-emphasis {
    font-weight: 600;
    color: #334155;
  }

  .direction-list {
    list-style: none;
    margin: 0 0 0.5rem 0;
    padding: 0 0 0 0px;
    width: 100%;
  }

  .route-item {
    display: grid;
    grid-template-columns: minmax(96px, max-content) minmax(0, 1fr) max-content max-content;
    align-items: baseline;
    column-gap: 8px;
    margin-top: 1px;
    margin-bottom: 0.2rem;
    width: 100%;
  }

  .group-label {
    display: inline-flex;
    align-items: baseline;
    white-space: nowrap;
  }

  .group-label.ghost {
    visibility: hidden;
  }

  .route-label {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .route-item.bus .route-type {
    display: none;
  }

  .eta-stack {
    grid-column: 3 / span 2;
    display: grid;
    grid-auto-rows: min-content;
    align-items: flex-start;
    row-gap: 2px;
    width: 100%;
  }

  .eta-line {
    display: grid;
    grid-template-columns: max-content max-content;
    align-items: baseline;
    column-gap: 10px;
    justify-content: end;
    white-space: nowrap;
    width: 100%;
  }

  .eta-min {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    justify-self: end;
  }

  .eta-part {
    white-space: nowrap;
  }

  .eta-value {
    text-align: right;
  }

  .eta-part.clock {
    font-size: 0.9rem;
    font-weight: 300;
  }

  .eta-prefix {
    display: inline-block;
    min-width: 58px;
    color: #344054;
  }

  .eta-prefix.ghost {
    visibility: hidden;
  }

  .eta-unit {
    color: #344054;
  }

  .eta-too-far,
  :global(.popup .eta-too-far) {
    color: #770022;
    font-weight: 400;
  }

  .eta-near,
  :global(.popup .eta-near) {
    color: #665522;
    font-weight: 600;
  }

  .eta-normal,
  :global(.popup .eta-normal) {
    color: #222222;
    font-weight: 400;
  }

  .stop-name {
    font-size: 1.1em;
    font-weight: 700;
    color: #0f172a;
  }

  .stop-info{
    margin-left: 0.5em;
  }
  .distance {
    color: #475569;
    font-weight: 400;
  }

  .empty {
    color: #5c6676;
    font-size: 0.95rem;
    margin-top: 8px;
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

    .arrival-item {
      padding: 10px 12px;
      font-size: 0.98rem;
      line-height: 1.35;
    }

    .stop-name {
      font-size: 1.22em;
    }

    .route-list,
    .direction-list,
    .route-item {
      max-width: 40rem;
    }

    .route-item {
      column-gap: 6px;
    }

    .eta-part.clock {
      font-size: 0.95rem;
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

    .arrival-item {
      padding: 6px 8px;
      font-size: 0.84rem;
      line-height: 1.2;
    }

    .route-list {
      padding-left: 0px;
    }
  }
</style>
