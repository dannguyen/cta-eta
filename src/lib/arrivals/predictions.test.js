import { describe, expect, it } from "vitest";
import {
  fetchBusPredictions,
  fetchTrainPredictions,
} from "$lib/arrivals/predictions";

function jsonResponse(payload) {
  return {
    json: async () => payload,
  };
}

describe("fetchTrainPredictions", () => {
  it("selects the closest station per route+destination and up to two ETAs", async () => {
    const stops = [
      { stopId: "30170", stationId: "30170", distanceMiles: 0.2 },
      { stopId: "30200", stationId: "30200", distanceMiles: 0.4 },
    ];

    const payloadByMapId = {
      30170: {
        ctatt: {
          errCd: "0",
          eta: [
            {
              staId: "30170",
              rt: "Red",
              destNm: "Howard",
              arrT: "2030-01-01T12:05:00",
            },
            {
              staId: "30170",
              rt: "Red",
              destNm: "Howard",
              arrT: "2030-01-01T12:10:00",
            },
            {
              staId: "30170",
              rt: "Red",
              destNm: "95th/Dan Ryan",
              arrT: "2030-01-01T12:12:00",
            },
          ],
        },
      },
      30200: {
        ctatt: {
          errCd: "0",
          eta: [
            {
              staId: "30200",
              rt: "Red",
              destNm: "Howard",
              arrT: "2030-01-01T12:01:00",
            },
            {
              staId: "30200",
              rt: "Blue",
              destNm: "O'Hare",
              arrT: "2030-01-01T12:15:00",
            },
          ],
        },
      },
    };

    const fetchFn = async (url) => {
      const mapId = new URL(url.toString()).searchParams.get("mapid");
      return jsonResponse(payloadByMapId[mapId]);
    };

    const result = await fetchTrainPredictions(stops, {
      endpoint: "/api/train",
      fetchFn,
      baseOrigin: "https://example.test",
    });

    expect(result.selectedStopIds.has("30170")).toBe(true);
    expect(result.selectedStopIds.has("30200")).toBe(true);

    const station30170 = result.predictionsByStop.get("30170");
    const redHoward = station30170.filter(
      (prediction) =>
        prediction.route === "Red" && prediction.destination === "Howard",
    );
    expect(redHoward).toHaveLength(2);
    expect(redHoward.every((prediction) => prediction.stopId === "30170")).toBe(
      true,
    );

    const station30200 = result.predictionsByStop.get("30200");
    expect(station30200.some((prediction) => prediction.route === "Blue")).toBe(
      true,
    );
  });
});

describe("fetchBusPredictions", () => {
  it("selects two closest stops per route+direction and keeps up to two ETAs per stop", async () => {
    const stops = [
      { stopId: "A", distanceMiles: 0.1 },
      { stopId: "B", distanceMiles: 0.2 },
      { stopId: "C", distanceMiles: 0.3 },
    ];

    const payload = {
      "bustime-response": {
        prd: [
          {
            stpid: "A",
            stpnm: "Stop A",
            rt: "147",
            rtdir: "Northbound",
            des: "Howard",
            prdtm: "20300101 12:05",
            prdctdn: "5",
          },
          {
            stpid: "A",
            stpnm: "Stop A",
            rt: "147",
            rtdir: "Northbound",
            des: "Howard",
            prdtm: "20300101 12:12",
            prdctdn: "12",
          },
          {
            stpid: "B",
            stpnm: "Stop B",
            rt: "147",
            rtdir: "Northbound",
            des: "Howard",
            prdtm: "20300101 12:03",
            prdctdn: "3",
          },
          {
            stpid: "B",
            stpnm: "Stop B",
            rt: "147",
            rtdir: "Southbound",
            des: "Downtown",
            prdtm: "20300101 12:07",
            prdctdn: "7",
          },
          {
            stpid: "C",
            stpnm: "Stop C",
            rt: "147",
            rtdir: "Southbound",
            des: "Downtown",
            prdtm: "20300101 12:04",
            prdctdn: "4",
          },
          {
            stpid: "C",
            stpnm: "Stop C",
            rt: "36",
            rtdir: "Northbound",
            des: "Devon",
            prdtm: "20300101 12:06",
            prdctdn: "6",
          },
        ],
      },
    };

    const fetchFn = async () => jsonResponse(payload);

    const result = await fetchBusPredictions(stops, {
      endpoint: "/api/bus",
      fetchFn,
      baseOrigin: "https://example.test",
    });

    expect([...result.selectedStopIds].sort()).toEqual(["A", "B", "C"]);
    expect(result.predictionsByStop.get("A")).toHaveLength(2);
    expect(result.predictionsByStop.get("B")).toHaveLength(2);
    expect(result.predictionsByStop.get("C")).toHaveLength(2);
  });
});
