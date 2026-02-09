import { describe, expect, it } from "vitest";
import {
  buildBusStopsFromArrivals,
  buildTrainStopsFromArrivals,
  buildUpcomingStops,
  groupBusStopsByName,
} from "$lib/arrivals/grouping";
import { BusArrival, TrainArrival } from "$lib/arrivals/TransitArrival";

function makeArrival(minutesFromNow) {
  return new Date(Date.now() + minutesFromNow * 60_000);
}

function makeBusArrival({
  stopId,
  route,
  direction,
  stopName = "Stop",
  stopLatitude = null,
  stopLongitude = null,
  destination = "",
  minutes = 0,
}) {
  return new BusArrival({
    stopId,
    route,
    direction,
    arrivalTime: makeArrival(minutes),
    predictionTime: new Date(),
    vId: "bus-1",
    isDelayed: false,
    stopName,
    stopLatitude,
    stopLongitude,
    destination,
    etaMinutes: minutes,
  });
}

function makeTrainArrival({
  stationId,
  stopId,
  route,
  direction,
  stopName = "Station",
  destination = "",
  minutes = 0,
}) {
  return new TrainArrival({
    stationId,
    stopId,
    route,
    direction,
    arrivalTime: makeArrival(minutes),
    predictionTime: new Date(),
    vId: "train-1",
    isDelayed: false,
    stopName,
    destination,
    etaMinutes: minutes,
  });
}

describe("groupBusStopsByName", () => {
  it("merges opposite-direction stop ids into one named stop group", () => {
    const candidateBusStops = [
      {
        stopId: "1001",
        displayName: "A",
        latitude: 41.98,
        longitude: -87.66,
        distanceMiles: 0.2,
      },
      {
        stopId: "1002",
        displayName: "B",
        latitude: 41.9804,
        longitude: -87.6596,
        distanceMiles: 0.25,
      },
    ];

    const predictionsByStop = new Map([
      [
        "1001",
        [
          makeBusArrival({
            stopId: 1001,
            stopName: "Sheridan & Winthrop",
            route: "147",
            direction: "Northbound",
            minutes: 4,
          }),
        ],
      ],
      [
        "1002",
        [
          makeBusArrival({
            stopId: 1002,
            stopName: "Sheridan & Winthrop",
            route: "147",
            direction: "Southbound",
            minutes: 6,
          }),
        ],
      ],
    ]);

    const grouped = groupBusStopsByName(candidateBusStops, {
      predictionsByStop,
      selectedStopIds: new Set(["1001", "1002"]),
    });

    expect(grouped).toHaveLength(1);
    expect(grouped[0].displayName).toBe("Sheridan & Winthrop");
    expect(grouped[0].distanceMiles).toBe(0.2);
    expect(
      grouped[0].predictions.map((prediction) => prediction.direction).sort(),
    ).toEqual(["Northbound", "Southbound"]);
  });
});

describe("build stops from TransitArrival instances", () => {
  it("groups train arrivals by stationId", () => {
    const trainStations = [
      {
        stopId: "30170",
        stationId: "30170",
        displayName: "Thorndale",
        latitude: 41.99,
        longitude: -87.66,
        distanceMiles: 0.2,
        lines: [{ code: "RED", id: "Red", color: "#d7263d" }],
      },
    ];

    const arrivals = [
      makeTrainArrival({
        stationId: 30170,
        stopId: 30170,
        route: "Red",
        direction: "Howard",
        stopName: "Thorndale",
        destination: "Howard",
        minutes: 4,
      }),
      makeTrainArrival({
        stationId: 30170,
        stopId: 30170,
        route: "Red",
        direction: "95th/Dan Ryan",
        stopName: "Thorndale",
        destination: "95th/Dan Ryan",
        minutes: 7,
      }),
    ];

    const stops = buildTrainStopsFromArrivals(trainStations, arrivals);
    expect(stops).toHaveLength(1);
    expect(stops[0].stopId).toBe("30170");
    expect(stops[0].predictions).toHaveLength(2);
  });

  it("groups bus arrivals by stopName and places stop at midpoint", () => {
    const candidateBusStops = [
      {
        stopId: "1001",
        displayName: "Sheridan & Winthrop",
        latitude: 41.98,
        longitude: -87.66,
        distanceMiles: 0.2,
      },
      {
        stopId: "1002",
        displayName: "Sheridan & Winthrop",
        latitude: 41.9804,
        longitude: -87.6596,
        distanceMiles: 0.24,
      },
    ];

    const arrivals = [
      makeBusArrival({
        stopId: 1001,
        route: "147",
        direction: "Northbound",
        stopName: "Sheridan & Winthrop",
        stopLatitude: 41.98,
        stopLongitude: -87.66,
        destination: "Howard",
        minutes: 4,
      }),
      makeBusArrival({
        stopId: 1002,
        route: "147",
        direction: "Southbound",
        stopName: "Sheridan & Winthrop",
        stopLatitude: 41.9804,
        stopLongitude: -87.6596,
        destination: "Downtown",
        minutes: 6,
      }),
    ];

    const stops = buildBusStopsFromArrivals(candidateBusStops, arrivals);
    expect(stops).toHaveLength(1);
    expect(stops[0].displayName).toBe("Sheridan & Winthrop");
    expect(stops[0].latitude).toBeCloseTo((41.98 + 41.9804) / 2, 6);
    expect(stops[0].longitude).toBeCloseTo((-87.66 + -87.6596) / 2, 6);
  });
});

describe("buildUpcomingStops", () => {
  it("builds train view model grouped by route and destination", () => {
    const nearbyStops = [
      {
        stopId: "train:thorndale",
        type: "train",
        displayName: "Thorndale",
        distanceMiles: 0.29,
        predictions: [
          makeTrainArrival({
            stationId: 30170,
            stopId: 30170,
            route: "Red",
            direction: "Howard",
            destination: "Howard",
            minutes: 3,
          }),
          makeTrainArrival({
            stationId: 30170,
            stopId: 30170,
            route: "Red",
            direction: "Howard",
            destination: "Howard",
            minutes: 9,
          }),
          makeTrainArrival({
            stationId: 30170,
            stopId: 30170,
            route: "Red",
            direction: "95th/Dan Ryan",
            destination: "95th/Dan Ryan",
            minutes: 6,
          }),
        ],
      },
    ];

    const upcoming = buildUpcomingStops(nearbyStops, { walkSpeedMph: 2 });

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].routes).toHaveLength(1);
    expect(upcoming[0].routes[0].route).toBe("Red");

    const destinationLabels = upcoming[0].routes[0].destinations.map(
      (d) => d.direction,
    );
    expect(destinationLabels).toContain("Howard");
    expect(destinationLabels).toContain("95th/Dan Ryan");
  });

  it("builds bus view model grouped by direction then route", () => {
    const nearbyStops = [
      {
        stopId: "bus:SHERIDAN_WINTHROP",
        type: "bus",
        displayName: "Sheridan & Winthrop",
        distanceMiles: 0.21,
        predictions: [
          makeBusArrival({
            stopId: 1001,
            route: "147",
            direction: "Northbound",
            destination: "Howard",
            stopName: "Sheridan & Winthrop",
            minutes: 5,
          }),
          makeBusArrival({
            stopId: 1001,
            route: "147",
            direction: "Northbound",
            destination: "Howard",
            stopName: "Sheridan & Winthrop",
            minutes: 13,
          }),
          makeBusArrival({
            stopId: 1002,
            route: "146",
            direction: "Southbound",
            destination: "Downtown",
            stopName: "Sheridan & Winthrop",
            minutes: 8,
          }),
        ],
      },
    ];

    const upcoming = buildUpcomingStops(nearbyStops, { walkSpeedMph: 2 });

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].directions.map((d) => d.direction).sort()).toEqual([
      "Northbound",
      "Southbound",
    ]);

    const northbound = upcoming[0].directions.find(
      (direction) => direction.direction === "Northbound",
    );
    expect(northbound.routes).toHaveLength(1);
    expect(northbound.routes[0].route).toBe("147");
    expect(northbound.routes[0].etas).toHaveLength(2);
  });
});
