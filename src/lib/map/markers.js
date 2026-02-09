import { escapeHtml, formatClock, formatMinutes } from "$lib/cta";
import {
  busDirectionOnly,
  destinationOrDirection,
  distanceWithWalkText,
  etaTimingClass,
  walkingMinutesFromMiles,
} from "$lib/arrivals/formatting";

function predictionSortTime(arrival) {
  return arrival?.arrivalTime?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
}

export function markerBackground(stop) {
  if (stop.type === "bus") {
    return "#151515";
  }

  const colors = (stop.lines ?? []).map((line) => line.color);

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
  const routes = [
    ...new Set(
      (stop.predictions ?? []).map((prediction) => String(prediction.route)),
    ),
  ]
    .map((route) => route.trim())
    .filter(Boolean);

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
  const walkMinutes = walkingMinutesFromMiles(stop.distanceMiles, walkSpeedMph);
  const predictions = [...(stop.predictions ?? [])]
    .sort((a, b) => predictionSortTime(a) - predictionSortTime(b))
    .slice(0, 8);

  const predictionMarkup = predictions.length
    ? predictions
      .map(
          (arrival) => {
            const etaMinutes =
              typeof arrival.getEtaMinutes === "function"
                ? arrival.getEtaMinutes()
                : null;
            return `
            <li>
              <strong>${escapeHtml(arrival.route)}</strong>
              ${escapeHtml(
                arrival.type === "bus"
                  ? busDirectionOnly(arrival)
                  : destinationOrDirection(arrival),
              )}
              <span class="${etaTimingClass(etaMinutes, walkMinutes)}">${escapeHtml(
                formatMinutes(etaMinutes),
              )} (${escapeHtml(formatClock(arrival.arrivalTime))})</span>
            </li>
          `;
          },
        )
        .join("")
    : "<li>No live predictions at this time.</li>";

  return `
    <div class="popup">
      <h3>${escapeHtml(stop.displayName)}</h3>
      <p>${escapeHtml(stop.type === "bus" ? "Bus stop" : "Train station")} • ${escapeHtml(distanceWithWalkText(stop.distanceMiles, walkSpeedMph))}</p>
      <ul>${predictionMarkup}</ul>
    </div>
  `;
}
