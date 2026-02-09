<script>
  export let userLocation = null;
  export let foundBusStops = [];
  export let foundTrainStations = [];
  export let filteredBusApiStops = [];
  export let filteredTrainApiStations = [];
  export let searchRadiusMiles = 1;
  export let apiResponses = [];
  export let trainApiUrl = '/api/train';
  export let busApiUrl = '/api/bus';
  export let wrangledArrivals = [];
  export let transitStops = [];

  function apiCallMeta(entry) {
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

  function apiItems(entry) {
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

  function apiItemCount(entry) {
    return apiItems(entry).length;
  }

  function modeItemCount(entries) {
    return entries.reduce((sum, entry) => sum + apiItemCount(entry), 0);
  }

  $: trainApiResponses = apiResponses.filter((entry) => entry.mode === 'train');
  $: busApiResponses = apiResponses.filter((entry) => entry.mode === 'bus');
  $: trainStops = transitStops.filter((stop) => stop?.type === 'train');
  $: busStops = transitStops.filter((stop) => stop?.type === 'bus');
</script>

<section class="debug">
  <h2>Debug</h2>
  <details open>
    <summary>Query Basis (User Location)</summary>
    <p class="debug-narrative">First we get the user's spatial coordinates.</p>
    <details class="debug-subsection">
      <summary>Coordinates</summary>
      <pre>{JSON.stringify(userLocation, null, 2)}</pre>
    </details>
  </details>

  <details open>
    <summary>Stops Found</summary>
    <p class="debug-narrative">
      We then read the bus stops and train stations location data from <code>/data</code> and collect
      the locations that are within {searchRadiusMiles} of the user's location
    </p>
    <details class="debug-subsection">
      <summary>Bus Stops ({foundBusStops.length})</summary>
      <pre>{JSON.stringify(foundBusStops, null, 2)}</pre>
    </details>
    <details class="debug-subsection">
      <summary>Train Stations ({foundTrainStations.length})</summary>
      <pre>{JSON.stringify(foundTrainStations, null, 2)}</pre>
    </details>
  </details>

  <details open>
    <summary>Stops Filtered</summary>
    <p class="debug-narrative">
      The <code>Stops Found</code> lists are sorted by distance to the user. For train, we keep all
      nearby stations; for bus, we keep only the 10 nearest stops. Those reduced ID lists are what
      we call the APIs with as <code>Stops for API</code>.
    </p>
    <details class="debug-subsection">
      <summary>Bus Stops for API ({filteredBusApiStops.length})</summary>
      {#if filteredBusApiStops.length === 0}
        <p class="debug-empty">No bus stops selected for API fetches.</p>
      {:else}
        <pre>{JSON.stringify(filteredBusApiStops, null, 2)}</pre>
      {/if}
    </details>

    <details class="debug-subsection">
      <summary>Train Stations for API ({filteredTrainApiStations.length})</summary>
      {#if filteredTrainApiStations.length === 0}
        <p class="debug-empty">No train stations selected for API fetches.</p>
      {:else}
        <pre>{JSON.stringify(filteredTrainApiStations, null, 2)}</pre>
      {/if}
    </details>
  </details>

  <details open>
    <summary>API Responses ({apiResponses.length})</summary>
    {#if apiResponses.length === 0}
      <p class="debug-empty">No API responses captured yet.</p>
    {:else}
      <details class="debug-subsection debug-call-group" open>
        <summary>
          <span class="debug-subheading">
            Train Calls ({trainApiResponses.length}, {modeItemCount(trainApiResponses)} eta items)
          </span>
        </summary>
        <p class="debug-narrative">We call the endpoint at <code>{trainApiUrl}</code>.</p>
        {#if trainApiResponses.length === 0}
          <p class="debug-empty">No train API calls captured.</p>
        {:else}
          <ul class="debug-call-list">
            {#each trainApiResponses as response, index}
              {@const meta = apiCallMeta(response)}
              <li>
                <details class="debug-call">
                  <summary>Call {index + 1} ({apiItemCount(response)} eta items)</summary>
                  <p><strong>URL:</strong> <code>{meta.href}</code></p>
                  <p><strong>Params:</strong></p>
                  <pre>{JSON.stringify(meta.params, null, 2)}</pre>
                  <p><strong>Response:</strong></p>
                  <pre>{JSON.stringify(response.payload, null, 2)}</pre>
                </details>
              </li>
            {/each}
          </ul>
        {/if}
      </details>

      <details class="debug-subsection debug-call-group" open>
        <summary>
          <span class="debug-subheading">
            Bus Calls ({busApiResponses.length}, {modeItemCount(busApiResponses)} prd items)
          </span>
        </summary>
        <p class="debug-narrative">We call the endpoint at <code>{busApiUrl}</code>.</p>
        {#if busApiResponses.length === 0}
          <p class="debug-empty">No bus API calls captured.</p>
        {:else}
          <ul class="debug-call-list">
            {#each busApiResponses as response, index}
              {@const meta = apiCallMeta(response)}
              <li>
                <details class="debug-call">
                  <summary>Call {index + 1} ({apiItemCount(response)} prd items)</summary>
                  <p><strong>URL:</strong> <code>{meta.href}</code></p>
                  <p><strong>Params:</strong></p>
                  <pre>{JSON.stringify(meta.params, null, 2)}</pre>
                  <p><strong>Response:</strong></p>
                  <pre>{JSON.stringify(response.payload, null, 2)}</pre>
                </details>
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    {/if}
  </details>

  <details>
    <summary>TrainStop Objects ({trainStops.length})</summary>
    {#if trainStops.length === 0}
      <p class="debug-empty">No TrainStop objects available.</p>
    {:else}
      {#each trainStops as stop, index}
        <div class="debug-stop-object">
          <h3>{stop?.name || `Train Stop ${index + 1}`} - train stop</h3>
          <pre>{JSON.stringify(stop, null, 2)}</pre>
        </div>
      {/each}
    {/if}
  </details>

  <details>
    <summary>BusStop Objects ({busStops.length})</summary>
    {#if busStops.length === 0}
      <p class="debug-empty">No BusStop objects available.</p>
    {:else}
      {#each busStops as stop, index}
        <div class="debug-stop-object">
          <h3>{stop?.name || `Bus Stop ${index + 1}`} - bus stop</h3>
          <pre>{JSON.stringify(stop, null, 2)}</pre>
        </div>
      {/each}
    {/if}
  </details>

  <details>
    <summary>Wrangled TransitArrival List ({wrangledArrivals.length})</summary>
    <pre>{JSON.stringify(wrangledArrivals, null, 2)}</pre>
  </details>
</section>

<style>
  .debug {
    margin: 0 0 28px;
    padding: 10px;
    border: 1px solid #dbe4ef;
    border-radius: 10px;
    background: #ffffff;
  }

  .debug h2 {
    margin: 0 0 10px;
    font-size: 1.1rem;
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

  .debug-narrative {
    margin: 8px 0 0;
    color: #334155;
    font-size: 0.9rem;
  }

  .debug-subsection {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed #e2e8f0;
  }

  .debug-subsection > summary {
    padding-left: 12px;
    list-style: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .debug-subsection > summary::-webkit-details-marker {
    display: none;
  }

  .debug-subsection > summary::before {
    content: '+';
    margin-right: 8px;
    color: #475569;
  }

  .debug-call-group > summary {
    padding-left: 8px;
    list-style: none;
    font-family: 'Avenir Next', 'Segoe UI', sans-serif;
    font-size: 0.9rem;
  }

  .debug-call-group > summary::before {
    content: none;
  }

  .debug-call-group > summary::-webkit-details-marker {
    display: none;
  }

  .debug-subheading {
    font-size: 0.96rem;
    font-weight: 700;
    color: #0f172a;
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

  .debug-stop-object {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dotted #e2e8f0;
  }

  .debug-call-list {
    margin: 8px 0 0 18px;
    padding: 0;
    list-style: none;
  }

  .debug-call-list li {
    margin: 6px 0;
  }

  .debug-call-group {
    margin-left: 12px;
    padding-left: 6px;
    border-left: 2px solid #e2e8f0;
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
    list-style: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
  }

  .debug-call > summary::-webkit-details-marker {
    display: none;
  }

  .debug-call > summary::before {
    content: '+';
    margin-right: 8px;
    color: #64748b;
  }

  .debug-call:first-of-type {
    border-top: 0;
    padding-top: 0;
  }
</style>
