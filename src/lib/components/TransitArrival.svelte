<script>
  import { etaUnitText, etaValueText } from '$lib/arrivals/formatting';

  export let mode = 'bus';
  export let showFirstColumn = true;
  export let routeName = '';
  export let routeTypeLabel = '';
  export let routeColorClass = '';
  export let direction = '';
  export let etas = [];

  $: isTrain = mode === 'train';
</script>

<li class={`route-item ${mode}`}>
  <span class="group-label" class:ghost={!showFirstColumn} class:arrival-emphasis={!isTrain}>
    {#if isTrain}
      <span class={`route-name train ${routeColorClass}`}>
        {routeName}
        <span class="route-type">{routeTypeLabel || 'Line'}</span>
      </span>
    {:else}
      {direction}
    {/if}
  </span>

  <span class="route-label" class:arrival-emphasis={isTrain}>
    {#if isTrain}
      {direction}
    {:else}
      <span class="route-name bus">{routeName}</span>
      <span class="route-type">{routeTypeLabel || 'Bus'}</span>
    {/if}
  </span>

  <span class="eta-stack">
    {#each etas as eta}
      <span class="eta-line">
        <span class={`eta-part eta-min ${eta.timingClass} ${eta.descriptor}`}>
          <span class="eta-value">{etaValueText(eta.minutes)}</span>
          {#if etaUnitText(eta.minutes)}
            <span class="eta-unit">{etaUnitText(eta.minutes)}</span>
          {/if}
        </span>
        <span class="eta-part clock">{eta.clockText}</span>
      </span>
    {/each}
  </span>
</li>

<style>
  .arrival-emphasis {
    font-weight: 600;
    color: #334155;
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

  .route-name {
    font-weight: 400;
    padding: 0.1rem 0.2rem;
    border: thin solid gray;
  }

  .route-name.bus {
    align-self: flex-start;
    font-weight: 600;
    border-radius: 5%;
  }

  .route-name.train {
    font-weight: 600;
    color: white;
  }

  .route-name.blue {
    background: #0000cc;
  }

  .route-name.brown {
    background: brown;
  }

  .route-name.green {
    background: #00cc00;
  }

  .route-name.orange {
    background: orange;
  }

  .route-name.purple {
    background: purple;
  }

  .route-name.red {
    background: #cc0000;
  }

  .route-name.yellow {
    background: yellow;
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

  .eta-unit {
    color: #344054;
  }

  .eta-part.clock {
    font-size: 0.9rem;
    font-weight: 300;
  }

  .eta-too-far {
    color: #770022;
    font-weight: 400;
  }

  .eta-near {
    color: #665522;
    font-weight: 600;
  }

  .eta-normal {
    color: #222222;
    font-weight: 400;
  }

  @media (min-width: 900px) {
    .route-item {
      column-gap: 6px;
    }

    .eta-part.clock {
      font-size: 0.95rem;
    }
  }
</style>
