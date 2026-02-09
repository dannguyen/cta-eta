import { escapeHtml, formatClock, formatMinutes } from "$lib/cta";
import { TransitArrival } from "$lib/arrivals/TransitArrival";
import { TransitStop as TransitStopModel } from "$lib/arrivals/TransitStop";
import {
  distanceWithWalkText,
  etaTimingClass,
  walkingMinutesFromMiles,
} from "$lib/arrivals/formatting";

function predictionSortTime(arrival) {
  return arrival?.arrivalTime?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
}

export function markerBackground(stop) {
  if (!(stop instanceof TransitStopModel)) {
    throw new TypeError("markerBackground expects a TransitStop instance");
  }

  if (stop.type === "bus") {
    return "#151515";
  }

  const colors = (stop.lineColors?.() ?? []).map((line) => line.color);

  if (colors.length === 0) {
    return "#4c566a";
  }

  if (colors.length === 1) {
    return colors[0];
  }

  const slice = 100 / colors.length;
  const parts = colors.map((color, index) => {
    const start = (slice * index).toFixed(2);
    const end = (slice * (index + 1)).toFixed(2);
    return `${color} ${start}% ${end}%`;
  });

  return `conic-gradient(${parts.join(", ")})`;
}

export function busMarkerLines(stop) {
  if (!(stop instanceof TransitStopModel)) {
    throw new TypeError("busMarkerLines expects a TransitStop instance");
  }

  const routes = [
    ...new Set(
      (stop.arrivals ?? []).map((prediction) => String(prediction.route)),
    ),
  ]
    .map((route) => route.trim())
    .filter(Boolean)
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );

  if (!routes.length) {
    return ["Bus"];
  }

  const visibleRoutes = routes.slice(0, 3);
  if (routes.length > 3) {
    visibleRoutes.push("...");
  }

  return visibleRoutes;
}

export function markerIcon(leaflet, stop) {
  if (!(stop instanceof TransitStopModel)) {
    throw new TypeError("markerIcon expects a TransitStop instance");
  }

  if (stop.type === "bus") {
    const lines = busMarkerLines(stop);
    const lineHtml = lines
      .map((line) => `<span class="bus-marker-line">${escapeHtml(line)}</span>`)
      .join("");
    const height = 10 + lines.length * 11;

    return leaflet.divIcon({
      className: "stop-marker-wrapper",
      html: `<span class="bus-marker">${lineHtml}</span>`,
      iconSize: [56, height],
      iconAnchor: [28, Math.round(height / 2)],
      popupAnchor: [0, -10],
    });
  }

  return leaflet.divIcon({
    className: "stop-marker-wrapper",
    html: `<span class="stop-marker" style="background:${markerBackground(stop)}"><span class="stop-marker-emoji">🚆</span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -12],
  });
}

export function popupHtml(stop, { walkSpeedMph = 2 } = {}) {
  if (!(stop instanceof TransitStopModel)) {
    throw new TypeError("popupHtml expects a TransitStop instance");
  }

  const walkMinutes = walkingMinutesFromMiles(stop.distanceMiles, walkSpeedMph);
  const closestByRouteDirection = new Map();
  for (const arrival of stop.arrivals ?? []) {
    if (!(arrival instanceof TransitArrival)) {
      continue;
    }

    const route = String(arrival.route ?? "").trim();
    const direction = String(arrival.direction ?? "").trim();
    const key = `${route}|${direction}`;
    const etaMinutes =
      typeof arrival.getEtaMinutes === "function"
        ? arrival.getEtaMinutes()
        : Number.POSITIVE_INFINITY;
    const existing = closestByRouteDirection.get(key);
    const existingEta =
      existing && typeof existing.getEtaMinutes === "function"
        ? existing.getEtaMinutes()
        : Number.POSITIVE_INFINITY;
    if (!existing || etaMinutes < existingEta) {
      closestByRouteDirection.set(key, arrival);
    }
  }

  const predictions = [...closestByRouteDirection.values()].sort((a, b) => {
    const routeCompare = String(a.route ?? "").localeCompare(
      String(b.route ?? ""),
      undefined,
      { numeric: true, sensitivity: "base" },
    );
    if (routeCompare !== 0) {
      return routeCompare;
    }

    const directionCompare = String(a.direction ?? "")
      .trim()
      .localeCompare(String(b.direction ?? "").trim(), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    if (directionCompare !== 0) {
      return directionCompare;
    }

    const aEta =
      typeof a.getEtaMinutes === "function"
        ? a.getEtaMinutes()
        : Number.POSITIVE_INFINITY;
    const bEta =
      typeof b.getEtaMinutes === "function"
        ? b.getEtaMinutes()
        : Number.POSITIVE_INFINITY;
    return aEta - bEta;
  });

  const predictionMarkup = predictions.length
    ? predictions
        .map((arrival) => {
          const etaMinutes =
            typeof arrival.getEtaMinutes === "function"
              ? arrival.getEtaMinutes()
              : null;
          return `
            <li>
              <strong>${escapeHtml(arrival.route)}</strong>
              ${escapeHtml(String(arrival.direction ?? "").trim())}
              <span class="${etaTimingClass(etaMinutes, walkMinutes)}">${escapeHtml(
                formatMinutes(etaMinutes),
              )} (${escapeHtml(formatClock(arrival.arrivalTime))})</span>
            </li>
          `;
        })
        .join("")
    : "<li>No live predictions at this time.</li>";

  return `
    <div class="popup">
      <h3>${escapeHtml(stop.name)}</h3>
      <p>${escapeHtml(stop.type === "bus" ? "Bus stop" : "Train station")} • ${escapeHtml(distanceWithWalkText(stop.distanceMiles, walkSpeedMph))}</p>
      <ul>${predictionMarkup}</ul>
      <p class="popup-more"><a href="#${escapeHtml(stop.anchorId)}">See more...</a></p>
    </div>
  `;
}
