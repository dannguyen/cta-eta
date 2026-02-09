import { formatClock } from "$lib/cta";

export function etaValueText(minutes) {
  if (minutes === null || minutes === undefined) {
    return "unknown time";
  }

  if (minutes <= 0) {
    return "now";
  }

  return String(minutes);
}

export function etaUnitText(minutes) {
  if (minutes === null || minutes === undefined || minutes <= 0) {
    return "";
  }

  return "min";
}

export function etaTimingClass(etaMinutes, walkMinutes) {
  if (!Number.isFinite(etaMinutes) || !Number.isFinite(walkMinutes)) {
    return "eta-normal";
  }

  if (etaMinutes <= 0 || etaMinutes < walkMinutes) {
    return "eta-too-far";
  }

  const delta = etaMinutes - walkMinutes;
  if (delta >= 1 && delta <= 3) {
    return "eta-near";
  }

  return "eta-normal";
}

export function compactClock(date) {
  return formatClock(date).replace(/\s/g, "");
}

export function walkingMinutesFromMiles(miles, walkSpeedMph = 2) {
  if (!Number.isFinite(miles)) {
    return null;
  }

  const feet = miles * 5280;
  const baseMinutes = Math.ceil((miles / walkSpeedMph) * 60);
  const extraMinutes = Math.ceil(feet / 500);
  return Math.max(0, baseMinutes + extraMinutes);
}

export function distanceOnlyText(miles) {
  if (!Number.isFinite(miles)) {
    return "";
  }

  return miles < 0.6
    ? `${Math.round(miles * 5280)} ft`
    : `${miles.toFixed(2)} mi`;
}

export function walkingAwayText(miles, walkSpeedMph = 2) {
  const walkMinutes = walkingMinutesFromMiles(miles, walkSpeedMph);
  return walkMinutes === 1 ? "1 min away" : `${walkMinutes} min walk`;
}

export function distanceWithWalkText(miles, walkSpeedMph = 2) {
  if (!Number.isFinite(miles)) {
    return "";
  }

  return `${distanceOnlyText(miles)}, ${walkingAwayText(miles, walkSpeedMph)}`;
}
