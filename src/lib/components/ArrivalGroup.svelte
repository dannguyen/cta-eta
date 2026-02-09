<script>
  import TransitArrival from '$lib/components/TransitArrival.svelte';

  export let mode = 'bus';
  export let rows = [];
</script>

<li class="arrival-group">
  {#each rows as row (row.key)}
    <TransitArrival
      mode={mode}
      showFirstColumn={row.showFirstColumn}
      routeName={row.routeName}
      routeTypeLabel={row.routeTypeLabel}
      routeColorClass={row.routeColorClass}
      direction={row.direction}
      etas={row.etas}
    />
  {/each}
</li>

<style>
  .arrival-group {
    margin: 2px 0;
    list-style: none;
  }
</style>
