import { chunk } from "$lib/cta";
import { TransitArrival } from "$lib/arrivals/TransitArrival";

function predictionTimestamp(prediction) {
  const arrivalTime = prediction?.arrivalTime ?? prediction?.arrival;
  if (
    arrivalTime instanceof Date &&
    !Number.isNaN(arrivalTime.getTime())
  ) {
    return arrivalTime.getTime();
  }

  if (Number.isFinite(prediction.minutes)) {
    return Date.now() + prediction.minutes * 60000;
  }

  return Number.MAX_SAFE_INTEGER;
}

function defaultBaseOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost";
}

function endpointUrl(endpoint, baseOrigin) {
  return new URL(endpoint, baseOrigin).toString();
}

export async function fetchTrainPredictions(
  stops,
  {
    endpoint = "/api/train",
    fetchFn = fetch,
    baseOrigin = defaultBaseOrigin(),
    onApiResponse = null,
  } = {},
) {
  const distanceByStationId = new Map(
    stops.map((stop) => [
      String(stop.stationId ?? stop.stopId),
      stop.distanceMiles,
    ]),
  );

  const stationById = new Map(
    stops.map((stop) => [String(stop.stationId ?? stop.stopId), stop]),
  );

  const perStationPredictions = await Promise.all(
    stops.map(async (stop) => {
      const url = new URL(endpointUrl(endpoint, baseOrigin));
      url.searchParams.set("mapid", stop.stationId ?? stop.stopId);

      try {
        const response = await fetchFn(url);
        const payload = await response.json();
        if (typeof onApiResponse === "function") {
          onApiResponse({
            mode: "train",
            url: url.toString(),
            payload,
          });
        }

        if (payload?.ctatt?.errCd && payload.ctatt.errCd !== "0") {
          return [];
        }

        const rawEta = payload?.ctatt?.eta;
        const etaList = Array.isArray(rawEta) ? rawEta : rawEta ? [rawEta] : [];

        return etaList.map((eta) =>
          TransitArrival.fromTrainEta(eta, {
            fallbackStopId: stop.stationId ?? stop.stopId,
            fallbackStationId: stop.stationId ?? stop.stopId,
            fallbackStopName: stop.stationName ?? stop.displayName,
            stopLatitude: stop.latitude,
            stopLongitude: stop.longitude,
          }).toPrediction(),
        );
      } catch {
        if (typeof onApiResponse === "function") {
          onApiResponse({
            mode: "train",
            url: url.toString(),
            payload: null,
            error: "request_failed",
          });
        }
        return [];
      }
    }),
  );

  const allPredictions = perStationPredictions.flat();
  const predictionsByRouteDestination = new Map();

  for (const prediction of allPredictions) {
    const key = `${prediction.route}|${prediction.destination}`;
    const group = predictionsByRouteDestination.get(key) ?? [];
    group.push(prediction);
    predictionsByRouteDestination.set(key, group);
  }

  const results = new Map(stops.map((stop) => [String(stop.stopId), []]));
  const selectedStopIds = new Set();

  for (const group of predictionsByRouteDestination.values()) {
    const stationIds = [
      ...new Set(group.map((prediction) => String(prediction.stationId ?? prediction.stopId))),
    ].filter((stationId) => distanceByStationId.has(stationId));

    stationIds.sort(
      (a, b) =>
        (distanceByStationId.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (distanceByStationId.get(b) ?? Number.MAX_SAFE_INTEGER),
    );

    const chosenStationId = stationIds[0];
    if (!chosenStationId) {
      continue;
    }

    const topTwo = group
      .filter(
        (prediction) =>
          String(prediction.stationId ?? prediction.stopId) === chosenStationId,
      )
      .sort((a, b) => predictionTimestamp(a) - predictionTimestamp(b))
      .slice(0, 2);

    if (!topTwo.length) {
      continue;
    }

    selectedStopIds.add(chosenStationId);
    const stationPredictions = results.get(chosenStationId) ?? [];
    stationPredictions.push(
      ...topTwo.map((prediction) => ({
        ...prediction,
        stationId: prediction.stationId ?? Number.parseInt(chosenStationId, 10),
        stopLatitude:
          prediction.stopLatitude ??
          stationById.get(chosenStationId)?.latitude ??
          null,
        stopLongitude:
          prediction.stopLongitude ??
          stationById.get(chosenStationId)?.longitude ??
          null,
      })),
    );
    results.set(chosenStationId, stationPredictions);
  }

  for (const [stationId, predictions] of results.entries()) {
    predictions.sort((a, b) => predictionTimestamp(a) - predictionTimestamp(b));
    results.set(stationId, predictions);
  }

  const arrivals = [...results.values()]
    .flat()
    .map((prediction) => TransitArrival.fromPrediction(prediction));

  return {
    arrivals,
    predictionsByStop: results,
    selectedStopIds,
  };
}

export async function fetchBusPredictions(
  stops,
  {
    endpoint = "/api/bus",
    fetchFn = fetch,
    baseOrigin = defaultBaseOrigin(),
    onApiResponse = null,
  } = {},
) {
  const results = new Map(stops.map((stop) => [String(stop.stopId), []]));
  const allPredictions = [];
  const stopIds = stops.map((stop) => stop.stopId);
  const distanceByStopId = new Map(
    stops.map((stop) => [String(stop.stopId), stop.distanceMiles]),
  );
  const stopById = new Map(stops.map((stop) => [String(stop.stopId), stop]));

  for (const idsChunk of chunk(stopIds, 10)) {
    const url = new URL(endpointUrl(endpoint, baseOrigin));
    url.searchParams.set("stpid", idsChunk.join(","));
    url.searchParams.set("top", "40");

    try {
      const response = await fetchFn(url);
      const payload = await response.json();
      if (typeof onApiResponse === "function") {
        onApiResponse({
          mode: "bus",
          url: url.toString(),
          payload,
        });
      }

      const rawPredictions = payload?.["bustime-response"]?.prd;
      const predictionList = Array.isArray(rawPredictions)
        ? rawPredictions
        : rawPredictions
          ? [rawPredictions]
          : [];

      for (const prediction of predictionList) {
        const stop = stopById.get(String(prediction.stpid));
        allPredictions.push(
          TransitArrival.fromBusPrediction(prediction, {
            stopLatitude: stop?.latitude ?? null,
            stopLongitude: stop?.longitude ?? null,
          }).toPrediction(),
        );
      }
    } catch {
      if (typeof onApiResponse === "function") {
        onApiResponse({
          mode: "bus",
          url: url.toString(),
          payload: null,
          error: "request_failed",
        });
      }
      // A failed chunk should not block the whole app.
    }
  }

  const predictionsByRouteDirection = new Map();
  for (const prediction of allPredictions) {
    const key = `${prediction.route}|${prediction.direction}`;
    const group = predictionsByRouteDirection.get(key) ?? [];
    group.push(prediction);
    predictionsByRouteDirection.set(key, group);
  }

  const selectedStopIds = new Set();
  for (const group of predictionsByRouteDirection.values()) {
    const closestStops = [
      ...new Set(group.map((prediction) => String(prediction.stopId))),
    ]
      .filter((stopId) => distanceByStopId.has(stopId))
      .sort(
        (a, b) =>
          (distanceByStopId.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (distanceByStopId.get(b) ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, 2);

    for (const stopId of closestStops) {
      const topTwo = group
        .filter((prediction) => String(prediction.stopId) === stopId)
        .sort((a, b) => predictionTimestamp(a) - predictionTimestamp(b))
        .slice(0, 2);

      if (!topTwo.length) {
        continue;
      }

      selectedStopIds.add(stopId);
      const stopPredictions = results.get(stopId) ?? [];
      stopPredictions.push(...topTwo);
      results.set(stopId, stopPredictions);
    }
  }

  for (const [stopId, predictions] of results.entries()) {
    predictions.sort((a, b) => predictionTimestamp(a) - predictionTimestamp(b));
    results.set(stopId, predictions);
  }

  const arrivals = [...results.values()]
    .flat()
    .map((prediction) => TransitArrival.fromPrediction(prediction));

  return {
    arrivals,
    predictionsByStop: results,
    selectedStopIds,
  };
}
