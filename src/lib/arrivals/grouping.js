import { TransitStop } from "$lib/arrivals/TransitStop";

function predictionSortTime(arrival) {
  const arrivalTime = arrival?.arrivalTime;
  return arrivalTime?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
}

function predictionArrivalTime(arrival) {
  const arrivalTime = arrival?.arrivalTime;
  if (arrivalTime instanceof Date && !Number.isNaN(arrivalTime.getTime())) {
    return arrivalTime.getTime();
  }

  return Number.MAX_SAFE_INTEGER;
}

function stopIdString(value) {
  return String(value ?? "");
}

function midpoint(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getDistinctTrainRoutes(arrivals) {
  const grouped = {};

  for (const arrival of arrivals) {
    const route = String(arrival?.route ?? "").trim();
    const destination = String(
      arrival?.destination ?? arrival?.direction ?? "",
    ).trim();
    const stopName = String(arrival?.stopName ?? "").trim();
    const stopId = stopIdString(arrival?.stationId ?? arrival?.stopId);
    const arrivalTimestamp = predictionArrivalTime(arrival);
    if (!route || !destination || !stopId) {
      continue;
    }

    const key = JSON.stringify({ route, destination });
    const stops = grouped[key] ?? [];
    const existingIndex = stops.findIndex((stop) => stop.stopId === stopId);
    const stopRecord = {
      stopName: stopName || `Station ${stopId}`,
      stopId,
      arrivalTimestamp,
    };

    if (existingIndex === -1) {
      stops.push(stopRecord);
    } else if (arrivalTimestamp < stops[existingIndex].arrivalTimestamp) {
      stops[existingIndex] = stopRecord;
    }

    grouped[key] = stops;
  }

  const sortedEntries = Object.entries(grouped)
    .map(([key, stops]) => {
      let routeInfo = { route: "", destination: "" };
      try {
        routeInfo = JSON.parse(key);
      } catch {
        // Keep empty fallback values to avoid breaking sort on malformed keys.
      }

      return {
        key,
        route: String(routeInfo.route ?? ""),
        destination: String(routeInfo.destination ?? ""),
        stops: [...stops].sort(
          (a, b) => a.arrivalTimestamp - b.arrivalTimestamp,
        ),
      };
    })
    .sort((a, b) => {
      if (a.route !== b.route) {
        return a.route.localeCompare(b.route);
      }

      return a.destination.localeCompare(b.destination);
    })
    .map((entry) => [entry.key, entry.stops]);

  return Object.fromEntries(sortedEntries);
}

export function getDistinctBusRoutes(arrivals) {
  const grouped = {};

  for (const arrival of arrivals) {
    const route = String(arrival?.route ?? "").trim();
    const direction = String(arrival?.direction ?? "").trim();
    const stopName = String(arrival?.stopName ?? "").trim();
    const stopId = stopIdString(arrival?.stopId);
    const arrivalTimestamp = predictionArrivalTime(arrival);
    if (!route || !direction || !stopId) {
      continue;
    }

    const key = JSON.stringify({ route, direction });
    const stops = grouped[key] ?? [];
    const existingIndex = stops.findIndex((stop) => stop.stopId === stopId);
    const stopRecord = {
      stopName: stopName || `Stop ${stopId}`,
      stopId,
      arrivalTimestamp,
    };

    if (existingIndex === -1) {
      stops.push(stopRecord);
    } else if (arrivalTimestamp < stops[existingIndex].arrivalTimestamp) {
      stops[existingIndex] = stopRecord;
    }

    grouped[key] = stops;
  }

  const sortedEntries = Object.entries(grouped)
    .map(([key, stops]) => {
      let routeInfo = { route: "", direction: "" };
      try {
        routeInfo = JSON.parse(key);
      } catch {
        // Keep empty fallback values to avoid breaking sort on malformed keys.
      }

      return {
        key,
        route: String(routeInfo.route ?? ""),
        direction: String(routeInfo.direction ?? ""),
        stops: [...stops].sort(
          (a, b) => a.arrivalTimestamp - b.arrivalTimestamp,
        ),
      };
    })
    .sort((a, b) => {
      if (a.route !== b.route) {
        return a.route.localeCompare(b.route);
      }

      return a.direction.localeCompare(b.direction);
    })
    .map((entry) => [entry.key, entry.stops]);

  return Object.fromEntries(sortedEntries);
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
    for (const arrival of predictions) {
      const stopName =
        String(arrival.stopName || stop.displayName || "").trim() ||
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

      const route = String(arrival.route || "Bus").trim() || "Bus";
      const direction =
        String(arrival.direction || "Inbound").trim() || "Inbound";
      const routeKey = `${route}|${direction}`;

      const directionPredictions = group.routeDirections.get(routeKey) ?? [];
      directionPredictions.push(arrival);
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

export function buildTrainStopsFromArrivals(
  candidateTrainStations,
  arrivals,
  trainRoutes,
  maxClosestArrivals = 2,
) {
  if (
    !trainRoutes ||
    typeof trainRoutes !== "object" ||
    Array.isArray(trainRoutes)
  ) {
    throw new TypeError(
      "buildTrainStopsFromArrivals expects trainRoutes object from getDistinctTrainRoutes()",
    );
  }

  const stationById = new Map(
    candidateTrainStations.map((station) => [
      String(station.stationId ?? station.stopId),
      station,
    ]),
  );
  const allowedCombinations = new Set(
    Object.entries(trainRoutes).flatMap(([routeKey, stops]) => {
      let routeInfo;
      try {
        routeInfo = JSON.parse(routeKey);
      } catch {
        return [];
      }

      const route = String(routeInfo?.route ?? "").trim();
      const destination = String(routeInfo?.destination ?? "").trim();
      if (!route || !destination || !Array.isArray(stops)) {
        return [];
      }

      return stops
        .map((stop) => {
          const stopId = stopIdString(stop?.stopId);
          if (!stopId) {
            return null;
          }

          return `${route}|${destination}|${stopId}`;
        })
        .filter(Boolean);
    }),
  );

  const groupedByStation = new Map();

  for (const arrival of arrivals) {
    const route = String(arrival?.route ?? "").trim();
    const destination = String(
      arrival?.destination ?? arrival?.direction ?? "",
    ).trim();
    const stationId = stopIdString(arrival?.stationId ?? arrival?.stopId);
    if (!route || !destination || !stationId) {
      continue;
    }

    if (!allowedCombinations.has(`${route}|${destination}|${stationId}`)) {
      continue;
    }

    const stationGroup = groupedByStation.get(stationId) ?? [];
    stationGroup.push(arrival);
    groupedByStation.set(stationId, stationGroup);
  }

  return [...groupedByStation.entries()]
    .map(([stationId, stationArrivals]) => {
      const station = stationById.get(stationId);
      const groupedByRouteDestination = new Map();
      for (const arrival of stationArrivals) {
        const route = String(arrival?.route ?? "").trim();
        const destination = String(
          arrival?.destination ?? arrival?.direction ?? "",
        ).trim();
        const key = `${route}|${destination}`;
        const arrivalsForKey = groupedByRouteDestination.get(key) ?? [];
        arrivalsForKey.push(arrival);
        groupedByRouteDestination.set(key, arrivalsForKey);
      }

      const predictions = [...groupedByRouteDestination.values()]
        .flatMap((arrivalsForKey) =>
          [...arrivalsForKey]
            .sort((a, b) => predictionArrivalTime(a) - predictionArrivalTime(b))
            .slice(0, maxClosestArrivals),
        )
        .sort((a, b) => predictionArrivalTime(a) - predictionArrivalTime(b));

      return {
        type: "train",
        stopId: stationId,
        displayName:
          station?.displayName ??
          stationArrivals[0]?.stopName ??
          `Station ${stationId}`,
        latitude: station?.latitude ?? stationArrivals[0]?.stopLatitude ?? null,
        longitude:
          station?.longitude ?? stationArrivals[0]?.stopLongitude ?? null,
        distanceMiles: station?.distanceMiles ?? Number.MAX_SAFE_INTEGER,
        lines: station?.lines ?? [],
        predictions,
      };
    })
    .filter(
      (stop) =>
        Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude),
    )
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function buildBusStopsFromArrivals(
  candidateBusStops,
  arrivals,
  busRoutes,
  maxClosestArrivals = 2,
) {
  if (!busRoutes || typeof busRoutes !== "object" || Array.isArray(busRoutes)) {
    throw new TypeError(
      "buildBusStopsFromArrivals expects busRoutes object from getDistinctBusRoutes()",
    );
  }

  const stopById = new Map(
    candidateBusStops.map((stop) => [String(stop.stopId), stop]),
  );
  const allowedCombinations = new Set(
    Object.entries(busRoutes).flatMap(([routeKey, stops]) => {
      let routeInfo;
      try {
        routeInfo = JSON.parse(routeKey);
      } catch {
        return [];
      }

      const route = String(routeInfo?.route ?? "").trim();
      const direction = String(routeInfo?.direction ?? "").trim();
      if (!route || !direction || !Array.isArray(stops)) {
        return [];
      }

      return stops
        .map((stop) => {
          const stopId = stopIdString(stop?.stopId);
          if (!stopId) {
            return null;
          }

          return `${route}|${direction}|${stopId}`;
        })
        .filter(Boolean);
    }),
  );
  const grouped = new Map();

  for (const arrival of arrivals) {
    const stopName = String(arrival.stopName || "").trim();
    if (!stopName) {
      continue;
    }

    const route = String(arrival?.route ?? "").trim();
    const direction = String(arrival?.direction ?? "").trim();
    const arrivalStopId = stopIdString(arrival.stopId);
    if (!route || !direction || !arrivalStopId) {
      continue;
    }

    if (!allowedCombinations.has(`${route}|${direction}|${arrivalStopId}`)) {
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
        routeDirections: new Map(),
      };
      grouped.set(key, group);
    }

    const staticStop = stopById.get(arrivalStopId);
    const stopLatitude = staticStop?.latitude ?? arrival.stopLatitude ?? null;
    const stopLongitude =
      staticStop?.longitude ?? arrival.stopLongitude ?? null;
    const stopDistance = staticStop?.distanceMiles ?? Number.MAX_SAFE_INTEGER;

    if (Number.isFinite(stopLatitude) && Number.isFinite(stopLongitude)) {
      group.members.set(arrivalStopId, {
        latitude: stopLatitude,
        longitude: stopLongitude,
        distanceMiles: stopDistance,
      });
    }

    group.arrivals.push(arrival);

    const routeDirectionKey = `${route}|${direction}`;
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
            .sort((a, b) => predictionArrivalTime(a) - predictionArrivalTime(b))
            .slice(0, maxClosestArrivals),
        )
        .sort((a, b) => predictionArrivalTime(a) - predictionArrivalTime(b));

      return {
        type: "bus",
        stopId: group.stopId,
        displayName: group.displayName,
        latitude,
        longitude,
        distanceMiles,
        predictions,
      };
    })
    .filter(
      (stop) =>
        Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude),
    )
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function buildUpcomingStops(nearbyStops, { walkSpeedMph = 2 } = {}) {
  return nearbyStops
    .filter((stop) => (stop.predictions?.length ?? 0) > 0)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .map((stop) =>
      TransitStop.fromStopData(stop).toUpcomingStop({ walkSpeedMph }),
    );
}
