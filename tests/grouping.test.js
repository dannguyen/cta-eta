import { describe, expect, it } from "vitest";
import {
  buildUpcomingStops,
  groupBusStopsByName,
} from "$lib/arrivals/grouping";

function makeArrival(minutesFromNow) {
  return new Date(Date.now() + minutesFromNow * 60_000);
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
          {
            stopId: "1001",
            stopName: "Sheridan & Winthrop",
            route: "147",
            direction: "Northbound",
            arrival: makeArrival(4),
            minutes: 4,
          },
        ],
      ],
      [
        "1002",
        [
          {
            stopId: "1002",
            stopName: "Sheridan & Winthrop",
            route: "147",
            direction: "Southbound",
            arrival: makeArrival(6),
            minutes: 6,
          },
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

describe("buildUpcomingStops", () => {
  it("builds train view model grouped by route and destination", () => {
    const nearbyStops = [
      {
        stopId: "train:thorndale",
        type: "train",
        displayName: "Thorndale",
        distanceMiles: 0.29,
        predictions: [
          {
            route: "Red",
            direction: "Howard",
            destination: "Howard",
            arrival: makeArrival(3),
            minutes: 3,
          },
          {
            route: "Red",
            direction: "Howard",
            destination: "Howard",
            arrival: makeArrival(9),
            minutes: 9,
          },
          {
            route: "Red",
            direction: "95th/Dan Ryan",
            destination: "95th/Dan Ryan",
            arrival: makeArrival(6),
            minutes: 6,
          },
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
          {
            route: "147",
            direction: "Northbound",
            destination: "Howard",
            arrival: makeArrival(5),
            minutes: 5,
          },
          {
            route: "147",
            direction: "Northbound",
            destination: "Howard",
            arrival: makeArrival(13),
            minutes: 13,
          },
          {
            route: "146",
            direction: "Southbound",
            destination: "Downtown",
            arrival: makeArrival(8),
            minutes: 8,
          },
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
