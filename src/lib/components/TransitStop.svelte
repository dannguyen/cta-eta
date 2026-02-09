<script>
  import ArrivalGroup from '$lib/components/ArrivalGroup.svelte';

  export let transitStop;
  export let walkSpeedMph = 2;

  function buildArrivalGroups(currentStop, currentWalkSpeedMph) {
    if (!currentStop || typeof currentStop.groupArrivals !== 'function') {
      return [];
    }

    const grouped = currentStop.groupArrivals({ walkSpeedMph: currentWalkSpeedMph });

    if (currentStop.type === 'train') {
      return grouped.routes.map((route) => ({
        key: `train-group:${currentStop.stopId}:${route.route}`,
        mode: 'train',
        rows: route.destinations.map((destination, destinationIndex) => ({
          key: `train:${currentStop.stopId}:${route.route}:${destination.direction}`,
          showFirstColumn: destinationIndex === 0,
          routeName: route.route,
          routeTypeLabel: route.typeLabel,
          routeColorClass: route.route.toLowerCase(),
          direction: destination.direction,
          etas: destination.etas
        }))
      }));
    }

    return grouped.directions.map((direction) => ({
      key: `bus-group:${currentStop.stopId}:${direction.direction}`,
      mode: 'bus',
      rows: direction.routes.map((route, routeIndex) => ({
        key: `bus:${currentStop.stopId}:${direction.direction}:${route.route}`,
        showFirstColumn: routeIndex === 0,
        routeName: route.route,
        routeTypeLabel: route.typeLabel,
        routeColorClass: '',
        direction: direction.direction,
        etas: route.etas
      }))
    }));
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

<li class="arrival-item">
  <div class="stop-header">
    <span class="stop-name">
      <span class="arrival-emoji">{safeStop.icon}</span>
      <span class="name">{safeStop.name}</span>
      <span class="category">{safeStop.stopCategory}</span>
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
    margin-right: 6px;
  }

  .stop-header {
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
    color: #0f172a;
  }

  .stop-name {
    grid-column: 1 / span 2;
  }

  .walk-eta {
    grid-column: 3;
    justify-self: end;
    white-space: nowrap;
    color: #334155;
    font-weight: 600;
  }

  .distance {
    grid-column: 4;
    justify-self: end;
    white-space: nowrap;
    color: #475569;
    font-weight: 400;
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
