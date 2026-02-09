<script>
  import { etaUnitText, etaValueText } from '$lib/arrivals/formatting';

  export let mode = 'bus';
  export let direction = '';
  export let etas = [];
  export let showDivider = false;

  $: isTrain = mode === 'train';
</script>

<li class={`route-item ${mode}`} class:with-divider={showDivider}>
  <span class="route-label direction">
    {direction}
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
    grid-template-columns: minmax(0, 1fr) max-content max-content;
    align-items: center;
    column-gap: 8px;
    margin-top: 1px;
    margin-bottom: 0.2rem;
    width: 100%;
  }

  .route-item.with-divider {
    border-top: 1px solid #bbb;
    margin-top: 3px;
    padding-top: 3px;
  }

  .route-label {
    display: inline-flex;
    align-items: center;
    align-self: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .route-label.direction{
    font-weight: 600;
  }

  .eta-stack {
    grid-column: 2 / span 2;
    display: grid;
    grid-auto-rows: min-content;
    align-items: center;
    align-self: center;
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
