import { minutesUntil, parseBusApiDate, parseTrainApiDate, trainDisplayFromRoute } from '$lib/cta';

function parseStopId(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStationId(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDelayFlag(value) {
  if (value === true || value === false) {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') {
    return true;
  }

  if (normalized === '0' || normalized === 'false') {
    return false;
  }

  return false;
}

function normalizedString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export class TransitArrival {
  constructor({
    type,
    stationId = null,
    stopId,
    route,
    direction,
    arrivalTime,
    predictionTime,
    vId,
    isDelayed,
    stopName,
    stopLatitude = null,
    stopLongitude = null,
    latitude = null,
    longitude = null,
    heading = null,
    destination = '',
    etaMinutes = null
  }) {
    this.type = type;
    this.stationId = stationId;
    this.stopId = stopId;
    this.route = route;
    this.direction = direction;
    this.arrivalTime = arrivalTime;
    this.predictionTime = predictionTime;
    this.vId = vId;
    this.isDelayed = isDelayed;
    this.stopName = stopName;
    this.stopLatitude = stopLatitude;
    this.stopLongitude = stopLongitude;
    this.latitude = latitude;
    this.longitude = longitude;
    this.heading = heading;
    this.destination = destination;
    this.etaMinutes = Number.isFinite(etaMinutes) ? etaMinutes : null;
  }

  static fromBusPrediction(prediction, { stopLatitude = null, stopLongitude = null } = {}) {
    const arrivalTime = parseBusApiDate(prediction.prdtm);
    const countdown = Number(prediction.prdctdn);
    const fallbackMinutes = minutesUntil(arrivalTime);
    const etaMinutes = Number.isFinite(countdown)
      ? Math.max(0, countdown)
      : prediction.prdctdn === 'DUE'
        ? 0
        : fallbackMinutes;

    return new TransitArrival({
      type: 'bus',
      stationId: null,
      stopId: parseStopId(prediction.stpid),
      route: normalizedString(prediction.rt, 'Bus'),
      direction: normalizedString(prediction.rtdir, 'Inbound'),
      arrivalTime,
      predictionTime: parseBusApiDate(prediction.tmstmp),
      vId: normalizedString(prediction.vid) || null,
      isDelayed: parseDelayFlag(prediction.dly),
      stopName: normalizedString(prediction.stpnm),
      stopLatitude: parseOptionalNumber(stopLatitude),
      stopLongitude: parseOptionalNumber(stopLongitude),
      destination: normalizedString(prediction.des),
      etaMinutes
    });
  }

  static fromTrainEta(
    eta,
    {
      fallbackStopId = null,
      fallbackStationId = null,
      fallbackStopName = '',
      stopLatitude = null,
      stopLongitude = null
    } = {}
  ) {
    const displayRoute = trainDisplayFromRoute(eta.rt);
    const destination = normalizedString(eta.destNm, 'Unknown destination');
    const stationId = parseStationId(eta.staId ?? fallbackStationId ?? fallbackStopId);

    return new TransitArrival({
      type: 'train',
      stationId,
      stopId: parseStopId(eta.staId ?? fallbackStopId),
      route: normalizedString(displayRoute.name, 'Train'),
      direction: destination,
      arrivalTime: parseTrainApiDate(eta.arrT),
      predictionTime: parseTrainApiDate(eta.prdt),
      vId: normalizedString(eta.rn) || null,
      isDelayed: parseDelayFlag(eta.isDly),
      stopName: normalizedString(eta.staNm, fallbackStopName),
      stopLatitude: parseOptionalNumber(stopLatitude),
      stopLongitude: parseOptionalNumber(stopLongitude),
      latitude: parseOptionalNumber(eta.lat),
      longitude: parseOptionalNumber(eta.lon),
      heading: parseOptionalNumber(eta.heading),
      destination
    });
  }

  static fromPrediction(prediction = {}) {
    const type = normalizedString(prediction.type ?? prediction.mode, 'bus');
    const arrivalTime = prediction.arrivalTime ?? prediction.arrival ?? null;
    const predictionTime = prediction.predictionTime ?? null;

    return new TransitArrival({
      type,
      stationId: parseStationId(prediction.stationId),
      stopId: parseStopId(prediction.stopId),
      route: normalizedString(prediction.route, type === 'train' ? 'Train' : 'Bus'),
      direction: normalizedString(prediction.direction, type === 'train' ? 'Unknown destination' : 'Inbound'),
      arrivalTime: arrivalTime instanceof Date ? arrivalTime : parseTrainApiDate(arrivalTime),
      predictionTime: predictionTime instanceof Date ? predictionTime : parseTrainApiDate(predictionTime),
      vId: normalizedString(prediction.vId) || null,
      isDelayed: parseDelayFlag(prediction.isDelayed),
      stopName: normalizedString(prediction.stopName),
      stopLatitude: parseOptionalNumber(prediction.stopLatitude),
      stopLongitude: parseOptionalNumber(prediction.stopLongitude),
      latitude: parseOptionalNumber(prediction.latitude),
      longitude: parseOptionalNumber(prediction.longitude),
      heading: parseOptionalNumber(prediction.heading),
      destination: normalizedString(prediction.destination, normalizedString(prediction.direction)),
      etaMinutes: Number.isFinite(prediction.minutes)
        ? prediction.minutes
        : Number.isFinite(prediction.etaMinutes)
          ? prediction.etaMinutes
          : null
    });
  }

  getEtaMinutes() {
    return Number.isFinite(this.etaMinutes) ? this.etaMinutes : minutesUntil(this.arrivalTime);
  }

  toPrediction() {
    return {
      type: this.type,
      stationId: this.stationId,
      stopId: this.stopId,
      route: this.route,
      direction: this.direction,
      arrivalTime: this.arrivalTime,
      predictionTime: this.predictionTime,
      vId: this.vId,
      isDelayed: this.isDelayed,
      stopName: this.stopName,
      stopLatitude: this.stopLatitude,
      stopLongitude: this.stopLongitude,
      latitude: this.latitude,
      longitude: this.longitude,
      heading: this.heading,
      mode: this.type,
      destination: this.destination,
      arrival: this.arrivalTime,
      minutes: this.getEtaMinutes()
    };
  }
}
