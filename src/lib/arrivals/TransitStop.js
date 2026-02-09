import { TransitArrival } from "$lib/arrivals/TransitArrival";
import {
  compactClock,
  distanceOnlyText,
  etaTimingClass,
  walkingAwayText,
  walkingMinutesFromMiles,
} from "$lib/arrivals/formatting";

function predictionSortTime(arrival) {
  const value = arrival?.arrivalTime?.getTime?.();
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareLocaleWithFallback(
  primaryLeft,
  primaryRight,
  fallbackLeft,
  fallbackRight,
) {
  const primaryCompare = String(primaryLeft ?? "").localeCompare(
    String(primaryRight ?? ""),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );

  if (primaryCompare !== 0) {
    return primaryCompare;
  }

  return fallbackLeft - fallbackRight;
}

function normalizeEtas(arrivals, walkMinutes) {
  return [...arrivals]
    .sort((a, b) => predictionSortTime(a) - predictionSortTime(b))
    .slice(0, 2)
    .map((arrival) => {
      const etaMinutes = arrival.getEtaMinutes();
      return {
        minutes: etaMinutes,
        descriptor:
          (etaMinutes ?? Number.MAX_SAFE_INTEGER) <= 0 ? "now" : "later",
        clockText: compactClock(arrival.arrivalTime),
        timingClass: etaTimingClass(etaMinutes, walkMinutes),
        sortTime: predictionSortTime(arrival),
      };
    });
}

export class TransitStop {
  constructor({ stopId, name, type, distanceMiles, arrivals = [] }) {
    this.stopId = stopId;
    this.name = name;
    this.type = type;
    this.distanceMiles = distanceMiles;
    this.arrivals = arrivals.map((arrival) => {
      if (!(arrival instanceof TransitArrival)) {
        throw new TypeError(
          "TransitStop.arrivals must be TransitArrival instances",
        );
      }

      return arrival;
    });
  }

  static fromStopData(stop) {
    const stopData = {
      stopId: stop.stopId,
      name: stop.displayName,
      type: stop.type,
      distanceMiles: stop.distanceMiles,
      arrivals: stop.predictions ?? [],
    };

    if (stop.type === "train") {
      return new TrainStop(stopData);
    }

    if (stop.type === "bus") {
      return new BusStop(stopData);
    }

    return new TransitStop(stopData);
  }

  distanceFromUser({ walkSpeedMph = 2 } = {}) {
    const feet = Number.isFinite(this.distanceMiles)
      ? Math.round(this.distanceMiles * 5280)
      : null;
    const walkMinutes = walkingMinutesFromMiles(
      this.distanceMiles,
      walkSpeedMph,
    );

    return {
      feet,
      walkMinutes,
      distanceText: distanceOnlyText(this.distanceMiles),
      walkText: walkingAwayText(this.distanceMiles, walkSpeedMph),
    };
  }

  groupArrivals({ walkSpeedMph = 2 } = {}) {
    return { routes: [], directions: [] };
  }

  GroupArrivals(options = {}) {
    return this.groupArrivals(options);
  }

  get icon() {
    return this.type === "train" ? "🚉 " : "🚌";
  }

  get stopCategory() {
    return this.type === "train" ? "Station" : "Bus Stop";
  }

  toUpcomingStop({ walkSpeedMph = 2 } = {}) {
    const distance = this.distanceFromUser({ walkSpeedMph });
    const grouped = this.groupArrivals({ walkSpeedMph });

    return {
      stopId: this.stopId,
      type: this.type,
      icon: this.icon,
      distanceText: distance.distanceText,
      walkText: distance.walkText,
      stopName: this.name,
      stopCategory: this.stopCategory,
      routes: grouped.routes,
      directions: grouped.directions,
    };
  }
}

export class BusStop extends TransitStop {
  constructor(stop) {
    super({ ...stop, type: "bus" });
  }

  groupArrivals({ walkSpeedMph = 2 } = {}) {
    const walkMinutes = walkingMinutesFromMiles(
      this.distanceMiles,
      walkSpeedMph,
    );
    const groupedByDirection = new Map();

    for (const arrival of this.arrivals) {
      const routeName = String(arrival.route);
      const directionLabel = String(arrival.direction || "Inbound");
      const directionGroup = groupedByDirection.get(directionLabel) ?? {
        direction: directionLabel,
        routes: new Map(),
      };
      const routeGroup = directionGroup.routes.get(routeName) ?? {
        route: routeName,
        typeLabel: "Bus",
        arrivals: [],
      };

      routeGroup.arrivals.push(arrival);
      directionGroup.routes.set(routeName, routeGroup);
      groupedByDirection.set(directionLabel, directionGroup);
    }

    const directions = [...groupedByDirection.values()]
      .map((directionGroup) => ({
        direction: directionGroup.direction,
        routes: [...directionGroup.routes.values()]
          .map((routeGroup) => ({
            route: routeGroup.route,
            typeLabel: routeGroup.typeLabel,
            etas: normalizeEtas(routeGroup.arrivals, walkMinutes),
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

    return { routes: [], directions };
  }

  get icon() {
    return "🚌";
  }

  get stopCategory() {
    return "Bus Stop";
  }
}

export class TrainStop extends TransitStop {
  constructor(stop) {
    super({ ...stop, type: "train" });
  }

  groupArrivals({ walkSpeedMph = 2 } = {}) {
    const walkMinutes = walkingMinutesFromMiles(
      this.distanceMiles,
      walkSpeedMph,
    );
    const groupedByRoute = new Map();

    for (const arrival of this.arrivals) {
      const routeName = String(arrival.route);
      const directionLabel = String(arrival.direction);
      const routeGroup = groupedByRoute.get(routeName) ?? {
        route: routeName,
        typeLabel: "Line",
        directions: new Map(),
      };

      const directionGroup = routeGroup.directions.get(directionLabel) ?? [];
      directionGroup.push(arrival);
      routeGroup.directions.set(directionLabel, directionGroup);
      groupedByRoute.set(routeName, routeGroup);
    }

    const routes = [...groupedByRoute.values()]
      .map((routeGroup) => ({
        route: routeGroup.route,
        typeLabel: routeGroup.typeLabel,
        destinations: [...routeGroup.directions.entries()]
          .map(([direction, directionArrivals]) => ({
            direction,
            etas: normalizeEtas(directionArrivals, walkMinutes),
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

    return { routes, directions: [] };
  }

  get icon() {
    return "🚉 ";
  }

  get stopCategory() {
    return "Station";
  }
}
