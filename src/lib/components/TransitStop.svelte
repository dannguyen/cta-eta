<script>
  import ArrivalGroup from '$lib/components/ArrivalGroup.svelte';

  export let transitStop;
  export let walkSpeedMph = 2;

  function buildArrivalGroups(currentStop, currentWalkSpeedMph) {
    if (!currentStop || typeof currentStop.groupArrivals !== 'function') {
      return [];
    }

    const grouped = currentStop.groupArrivals({ walkSpeedMph: currentWalkSpeedMph });
    const mode = currentStop.type === 'train' ? 'train' : 'bus';

    return grouped.routes.map((route) => {
      return {
        key: `${mode}-group:${currentStop.stopId}:${route.route}`,
        mode,
        rows: route.destinations.map((destination) => ({
          key: `${mode}:${currentStop.stopId}:${route.route}:${destination.direction}`,
          routeName: route.route,
          routeTypeLabel: route.typeLabel,
          routeColorClass: mode === 'train' ? route.route.toLowerCase() : '',
          direction: destination.direction,
          etas: destination.etas
        }))
      };
    });
  }

  $: safeStop = transitStop ?? {
    icon: '',
    name: '',
    stopCategory: ''
  };
  $: distance = transitStop?.distanceFromUser?.({ walkSpeedMph }) ?? {
    distanceText: '',
    walkText: ''
  };
  $: arrivalGroups = buildArrivalGroups(transitStop, walkSpeedMph);
</script>

<li class="arrival-item" id={safeStop.anchorId}>
  <div class="stop-header">
    <span class="stop-name">
      <span class="arrival-emoji">{safeStop.icon}</span>
      <span class="name">{safeStop.name}</span>
      {#if safeStop.type === 'train'}
      <span class="category">{safeStop.stopCategory}</span>
      {/if}
    </span>

    <span class="walk-eta">{distance.walkText}</span>
    <span class="distance">({distance.distanceText})</span>
  </div>

  <ul class="route-list">
    {#each arrivalGroups as group (group.key)}
      <ArrivalGroup mode={group.mode} rows={group.rows} />
    {/each}
  </ul>
</li>

<style>
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
    padding-right: 0.2em;
    background: white;
  }

  .stop-header {
    background: black;
    display: grid;
    grid-template-columns: minmax(96px, max-content) minmax(0, 1fr) max-content max-content;
    align-items: center;
    column-gap: 8px;
    width: 100%;
  }

  .route-list {
    list-style: none;
    margin: 4px 0 0 0;
    padding: 0;
  }

  .stop-name {
    font-size: 1.1em;
    font-weight: 700;
    color: white;
    padding-right: 0.2em;
    padding-top: 0.2em;
    padding-bottom: 0.2em;
  }

  .stop-name {
    grid-column: 1 / span 2;
  }

  .walk-eta {
    grid-column: 3;
    justify-self: end;
    white-space: nowrap;
    color: #ccc;
    font-weight: 600;
  }

  .distance {
    grid-column: 4;
    justify-self: end;
    white-space: nowrap;
    color: #aaa;
    font-weight: 400;
        padding-right: 0.2em;
  }

  @media (min-width: 900px) {
    .arrival-item {
      padding: 10px 12px;
      font-size: 0.98rem;
      line-height: 1.35;
    }

    .stop-header {
      column-gap: 6px;
      max-width: 40rem;
    }

    .stop-name {
      font-size: 1.22em;
    }

    .route-list {
      max-width: 40rem;
    }
  }

  @media (max-width: 720px) {
    .arrival-item {
      padding: 6px 8px;
      font-size: 0.84rem;
      line-height: 1.2;
    }

    .route-list {
      padding-left: 0;
    }

    .walk-eta,
    .distance {
      font-size: 0.95em;
    }
  }
</style>
