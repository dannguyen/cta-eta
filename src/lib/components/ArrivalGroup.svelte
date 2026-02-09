<script>
  import TransitArrival from '$lib/components/TransitArrival.svelte';

  export let mode = 'bus';
  export let rows = [];

  $: firstRow = rows[0] ?? null;
</script>

<li class={`arrival-group ${mode}`}>
  <div class={`group-route-cell ${mode} ${firstRow?.routeColorClass ?? ''}`}>
    {#if firstRow}
      <span class="group-route-name">{firstRow.routeName}</span>
      {#if mode === 'train'}
        <span class="group-route-type">{firstRow.routeTypeLabel || 'Line'}</span>
      {/if}
    {/if}
  </div>

  <ul class="group-rows">
    {#each rows as row, rowIndex (row.key)}
      <TransitArrival
        mode={mode}
        direction={row.direction}
        etas={row.etas}
        showDivider={rowIndex > 0}
      />
    {/each}
  </ul>
</li>

<style>
  .arrival-group {
    margin: 0;
    margin-bottom: 1.5em;
    list-style: none;
    display: grid;
    grid-template-columns: minmax(96px, max-content) minmax(0, 1fr);
    column-gap: 8px;
    align-items: stretch;
  }


  .group-route-cell {
    align-self: stretch;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 6px;
    border: 1px solid #667085;
    border-radius: 8px;
    background: #ffffff;
    color: #111827;
    white-space: nowrap;
    font-weight: 600;
  }

  .group-route-name {
    line-height: 1.1;
  }

  .group-route-type {
    line-height: 1.1;
    font-weight: 500;
  }

  .group-route-cell.bus .group-route-type {
    display: none;
  }

  .group-route-cell.train {
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.6);
  }

  .group-route-cell.blue {
    background: #0000cc;
  }

  .group-route-cell.brown {
    background: brown;
  }

  .group-route-cell.green {
    background: #00aa00;
  }

  .group-route-cell.orange {
    background: #cc7000;
  }

  .group-route-cell.purple {
    background: purple;
  }

  .group-route-cell.red {
    background: #cc0000;
  }

  .group-route-cell.yellow {
    background: #b38f00;
  }

  .group-rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  @media (min-width: 900px) {
    .arrival-group {
      column-gap: 6px;
    }
  }
</style>
