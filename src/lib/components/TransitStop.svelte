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
    <div class="header-main">
      <span class="arrival-emoji-frame">
        <span class="arrival-emoji">{safeStop.icon}</span>
      </span>
      <span class="stop-name">
        <span class="name">{safeStop.name}</span>
        {#if safeStop.type === 'train'}
          <span class="category">{safeStop.stopCategory}</span>
        {/if}
      </span>

      <span class="walk-eta">{distance.walkText}</span>
      <span class="distance">({distance.distanceText})</span>
    </div>
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.05em;
    line-height: 1;
  }

  .arrival-emoji-frame {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    border-radius: 999px;
    padding: 2px 6px;
  }

  .stop-header {
    width: 100%;
  }

  .header-main {
    background: #111111;
    border-radius: 8px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) max-content max-content;
    align-items: center;
    column-gap: 8px;
    padding: 6px 10px;
  }

  .route-list {
    list-style: none;
    margin: 4px 0 0 0;
    padding: 0;
  }

  .stop-name {
    font-size: 1.06em;
    font-weight: 600;
    color: white;
    min-width: 0;
  }

  .walk-eta {
    justify-self: end;
    white-space: nowrap;
    color: #f0f0f0;
    font-weight: 600;
  }

  .distance {
    justify-self: end;
    white-space: nowrap;
    color: #c8c8c8;
    font-weight: 400;
  }

  .category {
    font-weight: 500;
  }

  @media (min-width: 900px) {
    .arrival-item {
      padding: 10px 12px;
      font-size: 0.98rem;
      line-height: 1.35;
    }

    .stop-header {
      max-width: 40rem;
    }

    .header-main {
      padding: 7px 12px;
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

    .header-main {
      padding: 5px 8px;
      column-gap: 6px;
    }

    .walk-eta,
    .distance {
      font-size: 0.95em;
    }
  }
</style>
