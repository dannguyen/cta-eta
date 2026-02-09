import { describe, expect, it } from "vitest";
import {
  BusArrival,
  TrainArrival,
  TransitArrival,
} from "$lib/arrivals/TransitArrival";

describe("TransitArrival.fromBusPrediction", () => {
  it("maps bus API fields to the shared interface", () => {
    const arrival = TransitArrival.fromBusPrediction(
      {
        stpid: "14712",
        rt: "147",
        rtdir: "Northbound",
        prdtm: "20300101 12:05",
        tmstmp: "20300101 12:00",
        vid: "4321",
        dly: "1",
        stpnm: "Sheridan & Winthrop",
        des: "Howard",
        prdctdn: "5",
      },
      {
        stopLatitude: 41.991,
        stopLongitude: -87.659,
      },
    );

    expect(arrival.type).toBe("bus");
    expect(arrival.stationId).toBeNull();
    expect(arrival.stopId).toBe(14712);
    expect(arrival.route).toBe("147");
    expect(arrival.direction).toBe("Northbound");
    expect(arrival.arrivalTime).toBeInstanceOf(Date);
    expect(arrival.predictionTime).toBeInstanceOf(Date);
    expect(arrival.vId).toBe("4321");
    expect(arrival.isDelayed).toBe(true);
    expect(arrival.stopName).toBe("Sheridan & Winthrop");
    expect(arrival.stopLatitude).toBeCloseTo(41.991, 6);
    expect(arrival.stopLongitude).toBeCloseTo(-87.659, 6);
    expect(arrival.latitude).toBeNull();
    expect(arrival.longitude).toBeNull();
    expect(arrival.heading).toBeNull();
    expect(arrival).toBeInstanceOf(BusArrival);
    expect(arrival).toBeInstanceOf(TransitArrival);
    expect(arrival.getEtaMinutes()).toBe(5);
    expect(arrival.type).toBe("bus");
    expect(arrival.stopLatitude).toBeCloseTo(41.991, 6);
    expect(arrival.stopLongitude).toBeCloseTo(-87.659, 6);
  });
});

describe("TransitArrival.fromTrainEta", () => {
  it("maps train API fields to the shared interface and translates route names", () => {
    const arrival = TransitArrival.fromTrainEta(
      {
        staId: "30170",
        rt: "Brn",
        destNm: "Kimball",
        arrT: "2030-01-01T12:10:00",
        prdt: "2030-01-01T12:00:00",
        rn: "402",
        isDly: "0",
        staNm: "Merchandise Mart",
        lat: "41.888",
        lon: "-87.633",
        heading: "270",
      },
      {
        fallbackStopId: "30170",
        fallbackStationId: "30170",
        stopLatitude: 41.967,
        stopLongitude: -87.658,
      },
    );

    expect(arrival.type).toBe("train");
    expect(arrival.stationId).toBe(30170);
    expect(arrival.stopId).toBe(30170);
    expect(arrival.route).toBe("Brown");
    expect(arrival.direction).toBe("Kimball");
    expect(arrival.arrivalTime).toBeInstanceOf(Date);
    expect(arrival.predictionTime).toBeInstanceOf(Date);
    expect(arrival.vId).toBe("402");
    expect(arrival.isDelayed).toBe(false);
    expect(arrival.stopName).toBe("Merchandise Mart");
    expect(arrival.stopLatitude).toBeCloseTo(41.967, 6);
    expect(arrival.stopLongitude).toBeCloseTo(-87.658, 6);
    expect(arrival.latitude).toBeCloseTo(41.888, 6);
    expect(arrival.longitude).toBeCloseTo(-87.633, 6);
    expect(arrival.heading).toBe(270);
    expect(arrival).toBeInstanceOf(TrainArrival);
    expect(arrival).toBeInstanceOf(TransitArrival);
    expect(arrival.getEtaMinutes()).toBeGreaterThanOrEqual(0);
    expect(arrival.type).toBe("train");
    expect(arrival.destination).toBe("Kimball");
    expect(arrival.stationId).toBe(30170);
  });
});
