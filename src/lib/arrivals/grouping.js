import {
  busDirectionOnly,
  compactClock,
  destinationOrDirection,
  distanceOnlyText,
  etaTimingClass,
  walkingAwayText,
  walkingMinutesFromMiles,
} from "$lib/arrivals/formatting";

function predictionSortTime(prediction) {
  return prediction.arrival?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
}

function normalizeEtas(predictions, walkMinutes) {
  return [...predictions]
    .sort((a, b) => predictionSortTime(a) - predictionSortTime(b))
    .slice(0, 2)
    .map((eta) => ({
      minutes: eta.minutes,
      descriptor: eta.minutes <= 0 ? "now" : "later",
      clockText: compactClock(eta.arrival),
      timingClass: etaTimingClass(eta.minutes, walkMinutes),
      sortTime: predictionSortTime(eta),
    }));
}

function compareLocaleWithFallback(
  primaryLeft,
  primaryRight,
  fallbackLeft,
  fallbackRight,
) {
  const primaryCompare = primaryLeft.localeCompare(primaryRight, undefined, {
    numeric: true,
    sensitivity: "base",
  });

  if (primaryCompare !== 0) {
    return primaryCompare;
  }

  return fallbackLeft - fallbackRight;
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

export function buildUpcomingStops(nearbyStops, { walkSpeedMph = 2 } = {}) {
  return nearbyStops
    .filter((stop) => (stop.predictions?.length ?? 0) > 0)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .map((stop) => {
      const walkMinutes = walkingMinutesFromMiles(
        stop.distanceMiles,
        walkSpeedMph,
      );
      let directions = [];
      let routes = [];

      if (stop.type === "train") {
        const groupedByRoute = new Map();

        for (const prediction of stop.predictions ?? []) {
          const routeName = String(prediction.route);
          const directionLabel = destinationOrDirection(prediction);
          const routeGroup = groupedByRoute.get(routeName) ?? {
            route: routeName,
            typeLabel: "Line",
            destinations: new Map(),
          };

          const destinationGroup =
            routeGroup.destinations.get(directionLabel) ?? [];
          destinationGroup.push(prediction);
          routeGroup.destinations.set(directionLabel, destinationGroup);
          groupedByRoute.set(routeName, routeGroup);
        }

        routes = [...groupedByRoute.values()]
          .map((routeGroup) => ({
            route: routeGroup.route,
            typeLabel: routeGroup.typeLabel,
            destinations: [...routeGroup.destinations.entries()]
              .map(([direction, destinationPredictions]) => ({
                direction,
                etas: normalizeEtas(destinationPredictions, walkMinutes),
              }))
              .sort((a, b) =>
                compareLocaleWithFallback(
                  a.direction,
                  b.direction,
                  a.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
                  b.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
                ),
              ),
          }))
          .sort((a, b) =>
            compareLocaleWithFallback(
              a.route,
              b.route,
              a.destinations[0]?.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
              b.destinations[0]?.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
            ),
          );
      } else {
        const groupedByDirection = new Map();

        for (const prediction of stop.predictions ?? []) {
          const routeName = String(prediction.route);
          const directionLabel = busDirectionOnly(prediction);
          const directionGroup = groupedByDirection.get(directionLabel) ?? {
            direction: directionLabel,
            routes: new Map(),
          };
          const routeGroup = directionGroup.routes.get(routeName) ?? {
            route: routeName,
            typeLabel: "Bus",
            etas: [],
          };

          routeGroup.etas.push(prediction);
          directionGroup.routes.set(routeName, routeGroup);
          groupedByDirection.set(directionLabel, directionGroup);
        }

        directions = [...groupedByDirection.values()]
          .map((directionGroup) => ({
            direction: directionGroup.direction,
            routes: [...directionGroup.routes.values()]
              .map((routeGroup) => ({
                route: routeGroup.route,
                typeLabel: routeGroup.typeLabel,
                etas: normalizeEtas(routeGroup.etas, walkMinutes),
              }))
              .sort((a, b) =>
                compareLocaleWithFallback(
                  a.route,
                  b.route,
                  a.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
                  b.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
                ),
              ),
          }))
          .sort((a, b) =>
            compareLocaleWithFallback(
              a.direction,
              b.direction,
              a.routes[0]?.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
              b.routes[0]?.etas[0]?.sortTime ?? Number.MAX_SAFE_INTEGER,
            ),
          );
      }

      return {
        stopId: stop.stopId,
        type: stop.type,
        icon: stop.type === "train" ? "🚉 " : "🚌",
        distanceText: distanceOnlyText(stop.distanceMiles),
        walkText: walkingAwayText(stop.distanceMiles, walkSpeedMph),
        stopName: stop.displayName,
        stopCategory: stop.type === "train" ? "Station" : "Bus Stop",
        routes,
        directions,
      };
    });
}
