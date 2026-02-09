import { describe, expect, it } from "vitest";
import { BusArrival, TrainArrival } from "$lib/arrivals/TransitArrival";
import { BusStop, TrainStop } from "$lib/arrivals/TransitStop";

function makeArrival(route, direction, minutesFromNow, type = "bus") {
  const now = new Date();
  const arrivalTime = new Date(now.getTime() + minutesFromNow * 60_000);
  const payload = {
    stopId: 12345,
    route,
    direction,
    arrivalTime,
    predictionTime: now,
    vId: "veh-1",
    isDelayed: false,
    stopName: "Test Stop",
    etaMinutes: minutesFromNow,
  };

  return type === "train"
    ? new TrainArrival({ ...payload, stationId: 12345 })
    : new BusArrival(payload);
}

describe("TransitStop distanceFromUser", () => {
  it("returns distance in feet and walking minutes", () => {
    const stop = new BusStop({
      stopId: "bus:sample",
      name: "Sheridan & Winthrop",
      type: "bus",
      distanceMiles: 0.2,
      arrivals: [],
    });

    const distance = stop.distanceFromUser({ walkSpeedMph: 2 });
    expect(distance.feet).toBe(1056);
    expect(distance.walkMinutes).toBe(9);
  });
});

describe("TransitStop grouping", () => {
  it("groups bus arrivals by direction then route", () => {
    const stop = new BusStop({
      stopId: "bus:sample",
      name: "Sheridan & Winthrop",
      type: "bus",
      distanceMiles: 0.2,
      arrivals: [
        makeArrival("147", "Northbound", 5, "bus"),
        makeArrival("147", "Northbound", 11, "bus"),
        makeArrival("146", "Southbound", 8, "bus"),
      ],
    });

    const grouped = stop.groupArrivals({ walkSpeedMph: 2 });
    expect(grouped.routes).toEqual([]);
    expect(
      grouped.directions.map((direction) => direction.direction).sort(),
    ).toEqual(["Northbound", "Southbound"]);

    const northbound = grouped.directions.find(
      (direction) => direction.direction === "Northbound",
    );
    expect(northbound.routes).toHaveLength(1);
    expect(northbound.routes[0].route).toBe("147");
    expect(northbound.routes[0].etas).toHaveLength(2);
  });

  it("groups train arrivals by route then direction", () => {
    const stop = new TrainStop({
      stopId: "train:sample",
      name: "Thorndale",
      type: "train",
      distanceMiles: 0.3,
      arrivals: [
        makeArrival("Red", "Howard", 4, "train"),
        makeArrival("Red", "Howard", 10, "train"),
        makeArrival("Red", "95th/Dan Ryan", 7, "train"),
      ],
    });

    const grouped = stop.GroupArrivals({ walkSpeedMph: 2 });
    expect(grouped.directions).toEqual([]);
    expect(grouped.routes).toHaveLength(1);
    expect(grouped.routes[0].route).toBe("Red");

    const destinationLabels = grouped.routes[0].destinations.map(
      (destination) => destination.direction,
    );
    expect(destinationLabels).toContain("Howard");
    expect(destinationLabels).toContain("95th/Dan Ryan");
  });
});
