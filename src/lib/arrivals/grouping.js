import { TransitStop } from "$lib/arrivals/TransitStop";

function predictionSortTime(prediction) {
  return prediction.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
}

function predictionArrivalTime(prediction) {
  if (prediction?.arrival instanceof Date && !Number.isNaN(prediction.arrival.getTime())) {
    return prediction.arrival.getTime();
  }

  return Number.MAX_SAFE_INTEGER;
}

function stopIdString(value) {
  return String(value ?? '');
}

function midpoint(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function groupBusStopsByName(candidateBusStops, busData) {
  const stopById = new Map(
    candidateBusStops.map((stop) => [String(stop.stopId), stop]),
  );
  const grouped = new Map();

  for (const stopId of busData.selectedStopIds) {
    const stop = stopById.get(String(stopId));
    if (!stop) {
      continue;
    }

    const predictions = busData.predictionsByStop.get(String(stopId)) ?? [];
    for (const prediction of predictions) {
      const stopName =
        String(prediction.stopName || stop.displayName || "").trim() ||
        stop.displayName;
      const key = stopName.toUpperCase();

      let group = grouped.get(key);
      if (!group) {
        group = {
          type: "bus",
          stopId: `bus:${key}`,
          displayName: stopName,
          members: new Map(),
          routeDirections: new Map(),
        };
        grouped.set(key, group);
      }

      group.members.set(String(stop.stopId), stop);

      const route = String(prediction.route || "Bus").trim() || "Bus";
      const direction =
        String(prediction.direction || "Inbound").trim() || "Inbound";
      const routeKey = `${route}|${direction}`;

      const directionPredictions = group.routeDirections.get(routeKey) ?? [];
      directionPredictions.push({
        ...prediction,
        route,
        direction,
      });
      group.routeDirections.set(routeKey, directionPredictions);
    }
  }

  return [...grouped.values()].map((group) => {
    const members = [...group.members.values()];
    const latitude =
      members.reduce((sum, member) => sum + member.latitude, 0) /
      Math.max(1, members.length);
    const longitude =
      members.reduce((sum, member) => sum + member.longitude, 0) /
      Math.max(1, members.length);
    const distanceMiles = members.reduce(
      (minDistance, member) => Math.min(minDistance, member.distanceMiles),
      Number.MAX_SAFE_INTEGER,
    );

    const predictions = [...group.routeDirections.values()]
      .flatMap((directionPredictions) =>
        [...directionPredictions]
          .sort((a, b) => predictionSortTime(a) - predictionSortTime(b))
          .slice(0, 2),
      )
      .sort((a, b) => predictionSortTime(a) - predictionSortTime(b));

    return {
      type: "bus",
      stopId: group.stopId,
      displayName: group.displayName,
      latitude,
      longitude,
      distanceMiles,
      predictions,
    };
  });
}

export function buildTrainStopsFromArrivals(candidateTrainStations, arrivals) {
  const stationById = new Map(
    candidateTrainStations.map((station) => [String(station.stationId ?? station.stopId), station]),
  );
  const grouped = new Map();

  for (const arrival of arrivals) {
    const stationId = stopIdString(arrival.stationId ?? arrival.stopId);
    if (!stationId) {
      continue;
    }

    const group = grouped.get(stationId) ?? [];
    group.push(arrival);
    grouped.set(stationId, group);
  }

  return [...grouped.entries()]
    .map(([stationId, stationArrivals]) => {
      const station = stationById.get(stationId);
      const predictions = stationArrivals
        .map((arrival) => arrival.toPrediction())
        .sort((a, b) => predictionArrivalTime(a) - predictionArrivalTime(b));

      return {
        type: 'train',
        stopId: stationId,
        displayName: station?.displayName ?? stationArrivals[0]?.stopName ?? `Station ${stationId}`,
        latitude: station?.latitude ?? stationArrivals[0]?.stopLatitude ?? null,
        longitude: station?.longitude ?? stationArrivals[0]?.stopLongitude ?? null,
        distanceMiles: station?.distanceMiles ?? Number.MAX_SAFE_INTEGER,
        lines: station?.lines ?? [],
        predictions
      };
    })
    .filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function buildBusStopsFromArrivals(candidateBusStops, arrivals) {
  const stopById = new Map(candidateBusStops.map((stop) => [String(stop.stopId), stop]));
  const grouped = new Map();

  for (const arrival of arrivals) {
    const stopName = String(arrival.stopName || '').trim();
    if (!stopName) {
      continue;
    }

    const key = stopName.toUpperCase();
    let group = grouped.get(key);
    if (!group) {
      group = {
        stopId: `bus:${key}`,
        displayName: stopName,
        arrivals: [],
        members: new Map(),
        routeDirections: new Map()
      };
      grouped.set(key, group);
    }

    const arrivalStopId = stopIdString(arrival.stopId);
    const staticStop = stopById.get(arrivalStopId);
    const stopLatitude = staticStop?.latitude ?? arrival.stopLatitude ?? null;
    const stopLongitude = staticStop?.longitude ?? arrival.stopLongitude ?? null;
    const stopDistance = staticStop?.distanceMiles ?? Number.MAX_SAFE_INTEGER;

    if (Number.isFinite(stopLatitude) && Number.isFinite(stopLongitude)) {
      group.members.set(arrivalStopId, {
        latitude: stopLatitude,
        longitude: stopLongitude,
        distanceMiles: stopDistance
      });
    }

    group.arrivals.push(arrival);

    const routeDirectionKey = `${arrival.route}|${arrival.direction}`;
    const directionGroup = group.routeDirections.get(routeDirectionKey) ?? [];
    directionGroup.push(arrival);
    group.routeDirections.set(routeDirectionKey, directionGroup);
  }

  return [...grouped.values()]
    .map((group) => {
      const members = [...group.members.values()];
      const latitude = midpoint(members.map((member) => member.latitude));
      const longitude = midpoint(members.map((member) => member.longitude));
      const distanceMiles = members.reduce(
        (minDistance, member) => Math.min(minDistance, member.distanceMiles),
        Number.MAX_SAFE_INTEGER,
      );

      const predictions = [...group.routeDirections.values()]
        .flatMap((directionArrivals) =>
          [...directionArrivals]
            .sort((a, b) => predictionArrivalTime(a.toPrediction()) - predictionArrivalTime(b.toPrediction()))
            .slice(0, 2)
            .map((arrival) => arrival.toPrediction()),
        )
        .sort((a, b) => predictionArrivalTime(a) - predictionArrivalTime(b));

      return {
        type: 'bus',
        stopId: group.stopId,
        displayName: group.displayName,
        latitude,
        longitude,
        distanceMiles,
        predictions
      };
    })
    .filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function buildUpcomingStops(nearbyStops, { walkSpeedMph = 2 } = {}) {
  return nearbyStops
    .filter((stop) => (stop.predictions?.length ?? 0) > 0)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .map((stop) => TransitStop.fromStopData(stop).toUpcomingStop({ walkSpeedMph }));
}
