<script>
  import ArrivalGroup from '$lib/components/ArrivalGroup.svelte';

  export let stop;

  function buildArrivalGroups(currentStop) {
    if (!currentStop) {
      return [];
    }

    if (currentStop.type === 'train') {
      return currentStop.routes.map((route) => ({
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

    return currentStop.directions.map((direction) => ({
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

  $: arrivalGroups = buildArrivalGroups(stop);
</script>

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
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
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

  .stop-info {
    margin-left: 0.5em;
  }

  .distance {
    color: #475569;
    font-weight: 400;
  }

  @media (min-width: 900px) {
    .arrival-item {
      padding: 10px 12px;
      font-size: 0.98rem;
      line-height: 1.35;
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
  }
</style>
