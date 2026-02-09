# Chicago Transit ETA Web App

## Project description

Make a one-page static web app that reads the visitor's current geospatial location that uses Chicago Transit Authority (CTA) data APIs to find the nearest Chicago transit bus stops and rail stations, and then lists the estimated arrival times (in either direction) for each stop/station.

### Technical requirements

- Use Svelte 5.0
- The app should be a static single page app, as it relies on static data files (in static/data) or calling APIs

### Cloudflare Pages + Worker Functions

This repo is configured to call same-origin proxy endpoints at `/api/train` and `/api/bus`.
Those endpoints are implemented as Cloudflare Pages Functions in:

- `functions/api/train.js`
- `functions/api/bus.js`

Set these Cloudflare project secrets:

- `TRAIN_API_KEY`
- `BUS_API_KEY`

Cloudflare Pages build settings:

- Build command: `npm run build`
- Build output directory: `build`

### Detailed flow description

- User visits the CTA ETA Webapp page
- Webapp requests permission to get user geospatial location
- Using the user's coordinates, the webapp then reads the following static data files of stop locations:
  - read bus stop data [static/data/cta-bus-stops.csv](static/data/cta-bus-stops.csv)
    - find the nearest 10 bus stops within 0.5 miles of the user

  - read train station data from [static/data/cta-train-stations.csv](static/data/cta-train-stations.csv)
    - find all the train stations within a 0.5 mile radius from the user

- Now that you've gathered bus stop IDs(`STOP_ID`) and train station IDs (`STATION_ID`), use them to call the respective CTA APIs:
  - Iterating through each train station `STATION_ID`, call the [Train Tracker Arrivals API](#mark-train-tracker-arrivals-api) and find all the closest trains per arriving route/line (i.e. `rt` attribute) per direction (i.e. `destNm`)
    - Use the [color key](#mark-train-color-key) to translate the `rt` values to human readable colors

  - Iterating through each bus stop STOP_ID, call the [Bus Get Predictions API](#mark-bus-get-predictions-api) (the `stpid` parameter can take up to 10 STOP_ID values.
    - Find all the distinct combinations of route name and route direction — `rt` and `rtDir`, respectively
    - Find the closest arriving bus per route and per direction, and collect their respective stop IDs (go to the [Bus arrivals/stops filtering](#mark-bus-stop-filtering) section for more details)
    -

- Render the bus and train stops on a Leaflet OpenStreetMap
  - NOTE: for bus stops, we don't want to render all 10 bus stops. We want to render just the bus stops for the closest buses (per route and per direction). So you'll have to use collect the corresponding `stpid` (stop id) in the bus API response, and only map the bus stops that have stop ids collected from the list of nearest buses.
  - attach click eventhandlers that show the ETAs for each clicked stop
- Render a text list of the bus and train stops, with the ETAs of arriving trains/buses

### Mapping

The web app should also use a Leaflet + Openstreet map to show the user's current location and the locations of the nearest stops.

For the map icons:

- the map marker color for bus stops should be in black
- the map marker color for rail stops should be based on the name of the rail line, e.g. the Red line stops should have red map markers
- Some train stations have multiple lines, indicated as a comma-delimited list of colors in the `LINES` column. In that case, the map marker should show a combination of those colors, e.g. like a round icon containing a red, blue, and brown circle for a station with red, blue, and brown lines
- clicking on a map marker should pop up a balloon that shows the ETAs for their nearest train/bus, for all routes and their respective directions

Below the map should be a simple list of the nearest stops, along with the closest ETAs for the closest trains/buses per route/line at each stop.

By default, the app should find the stops within a half-mile radius of the user's location.

## Data details

This web app uses a combination of data cached in `static/data` and APIs from the CTA data portal.

### Static data

#### CTA L Stations

[static/data/cta-train-stations.csv](./static/data/cta-train-stations.csv)

This is a CSV that lists all the train stops.

The `LINES` column contains a comma-delimited string of human readable color names: use this to make the corresponding map marker.

The `STATION_ID` is passed to the Train Tracker API's `mapid` parameter.

#### CTA Bus Stops

[static/data/cta-bus-stops.csv](./static/data/cta-bus-stops.csv)

The `STOP_ID` value is passed to the Bus tracker `stpid` API parameter

### APIs

When the visitor loads the web page, the app should call the relevant CTA APIs via the Cloudflare Functions proxy endpoints (`/api/train` and `/api/bus`), which attach the API keys server-side from Cloudflare secrets.

CTA API Developer homepage: https://www.transitchicago.com/developers/

<div id="mark-bus-get-predictions-api"></div>

#### Bus Get Predictions API

Documentation stored locally:

[docs/apis/cta-bus-tracker-api-developer-guide.pdf](./docs/apis/cta-bus-tracker-api-developer-guide.pdf)

Sample call:
https://www.ctabustracker.com/bustime/api/v3/getpredictions?key=API_DEV_KEY&format=json&stpid=14545

Sample data: [tests/samples/bus-predictions.json](./tests/samples/bus-predictions.json)

The API JSON response returns a `prd` array, with each entry consisting of a predicted bus arrival. However, we don't want to list EVERY bus, just the nearest bus, per route (`rt` attribute) and direction (`rtdir` attribute).

<div id="mark-bus-stop-filtering"></div>

##### Bus arrivals and stops filtering

For any given bus route+direction, there will be multiple stops near the user (as many as one every two blocks). We don't want to show all those stops, just the 2 stops nearest to the user for every route+direction. And we want to see the 2 closest buses (by ETA) per bus stop and route+direction.

So the bus tracker API might return 10 arrival records for buses with route=151 and rtdir=North. First, I want to find the two closest stops (by `stpid`) found in those 10 arrival records for 151 North.

Then for each of those stops, I want to find the 2 closest 151 North buses.

In the end, we may map as many as 2 stops that service 151 North buses, and show the user the 2 closest buses for each of those stops. There may be other 151 North bus stops within 0.5 miles of the user that are farther away, but we don't want to show those, or the bus arrivals for those stops (because the user presumably only cares about the closest bus)

The data flow process for bus data is thus:

- Get the 10 nearest stops to the user from the static cta-bus-stops.csv file (within 0.5 miles)
- Call the bus tracker getPredictions API using those stop ids
- In the returned `prd` array, find every distinct combination of `rt` and `rtdir`
- For each rt/rtdir combination, find the two stops (collect `stpid`) nearest to the user that service each rt/rtdir combination — that way we give the user a choice of which bus stop on the route to walk to.
- Then for each rt/rtdir combination per each stop, find the two closest buses by ETA — that way if the user won't catch the most recent bus+route at a stop, they know when the next one is coming
- Map only the bus stops whose stop IDs are found in that filtered list of closest buses per rt/rtdirs

###### Additional bus stop filtering

Bus stops for different directions (e.g. Northbound and Southbound) for given route (e.g. 36) tend to be across the street from each other and share the same name (e.g. the corner closest to them, like "Bryn Mawr & Clark St". So after all the close bus stops and arriving bus data is collected, I want to do an additional level of filtering.

Group together bus data that, in the API, have the same stop name — i.e. the `stpnm: "Sheridan & Winthrop"` attribute, and route (i.e. `rt: 147` attribute) — even if they have different directions (e.g. `rtdir` is "Northbound" and "Southbound").

Create one "stop" group with the name of "Sheridan & Winthrop", that contains all the arrival entries for Route 147 buses, whether they're going north or south.

That way, when we list the "Upcoming Arrivals", we can list the groupings as such:

- Name of stop (Sheridan & Winthrop)
  - Name of route (147)
    - Northbound: arriving in x minutes and y minutes
    - Southbound: arriving in z minutes and q minutes

For map marking, keep track of the lat/lng for the Northbound and Southbound version of the stop. Place the marker at the midpoint of those coordinates. There should be one map marker for the "Sheridan & Winthrop" stop

<div id="mark-train-tracker-arrivals-api"></div>

#### Train Tracker Arrivals API

Documentation:

Stored locally at:
[docs/apis/cta-train-tracker-api-developer-guide.pdf](./docs/apis/cta-train-tracker-api-developer-guide.pdf)

Sample call:
http://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=API_DEV_KEY&outputType=JSON&mapid=40380

Sample data: [tests/samples/train-ttarrivals.json](./tests/samples/train-ttarrivals.json)

Make a call for each nearby train station (`mapid=STATION_ID`). This will return a JSON object with an array `eta` consisting of every incoming train and its estimated arrival time.

As with buses, we don't want to map every train station, just the stations corresponding to the closest train (via ETA) for every route (aka line) and destination.

Unlike bus stops, train stations are spaced farther away. So instead of collecting the closest two stations per route+destination, we just need to find the closest station per route+destination, and then the 2 closest trains per route+destination at that station.

So from the `eta` array, gather every distinct combination of line/route (`rt`) and destination name (`destNm`).

Then find the two stations (the `staId` attribute in the API response) nearest to the user for each of those rt+destNm combinations.

Then for each station + rt+destName combination, find the two closest trains by ETA

Map/list the collected stations and their closest trains

- Get every train station within 0.5 miles from the user from the static cta-train-stations.csv file. Gather the `STATION_ID`
- Call the `ttarrivals` API for each station ID
- Collect and combine the `eta` arrays in each API response
- Then find every distinct combination of `rt` and `destNm`
- then find the closest station (staId) to the user per rt + destNm combo
- Then find the two closest ETA trains per station + rt + destNm combination
- Map only the train stations whose STATION_ID are found in that list of `staId` collected for the closest trains via the API.

<div id="mark-train-color-key"></div>

##### Color key

Each entry in the `eta` array has a `rt` attribute. Use the following key to translate each `rt` identifier with a human readable color:

• Red = Red
• Blue = Blue
• Brn = Brown
• G = Green
• Org = Orange
• P = Purple
• Pink = Pink
• Y = Yellow
