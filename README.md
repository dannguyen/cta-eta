# Chicago Transit ETA Web App

## Project description

Make a one-page static web app that reads the visitor's current geospatial location that uses Chicago Transit Authority (CTA) data APIs to find the nearest Chicago transit bus stops and rail stations, and then lists the estimated arrival times (in either direction) for each stop/station.

### Technical requirements

- Use Svelte 5.0
- The app should be a static single page app, as it relies on static data files (in static/data) or calling APIs

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

When the visitor loads the web page, the app should call the relevant CTA APIs.

The [keys.toml](keys.toml) file contains my API developer keys for the train and bus API endpoints.

CTA API Developer homepage: https://www.transitchicago.com/developers/


<div id="mark-train-tracker-arrivals-api"></div>

#### Train Tracker Arrivals API

Documentation:

Stored locally at:
[docs/apis/cta-train-tracker-api-developer-guide.pdf](./docs/apis/cta-train-tracker-api-developer-guide.pdf)

Sample call:
http://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=API_DEV_KEY&outputType=JSON&mapid=40380

Sample data: [tests/samples/train-ttarrivals.json](./tests/samples/train-ttarrivals.json)

Make a call for each nearby train station (`mapid=STATION_ID`). This will return a JSON object with an array `eta` consisting of every incoming train and its estimated arrival time.

Gather the distinct combinations of line/route (`rt`) and destination name (`destNm`) per station. For each one, display the ETA of the nearest train. The API will return all incoming trains for a given line and destination — but we just want to show the trains for that line/destination that is closest to a given station in terms of estimated arrival time.

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



<div id="mark-bus-get-predictions-api"></div>

#### Bus Get Predictions API

Documentation stored locally:

[docs/apis/cta-bus-tracker-api-developer-guide.pdf](./docs/apis/cta-bus-tracker-api-developer-guide.pdf)

Sample call:
https://www.ctabustracker.com/bustime/api/v3/getpredictions?key=API_DEV_KEY&format=json&stpid=14545


Sample data: [tests/samples/bus-predictions.json](./tests/samples/bus-predictions.json)


The API JSON response returns a `prd` array, with each entry consisting of a predicted bus arrival. As with the trains, we don't want to collect EVERY bus, just the nearest bus, per route (`rt` attribute) and direction (`rtdir` attribute).


<div id="mark-bus-stop-filtering"></div>

##### Bus arrivals and stops filtering

Unlike the trains, we don't want to map EVERY bus stop that we fetched data for. We just want to map the bus stops for which the nearest bus (per route and per direction) is arriving. So the bus tracker API might return 10 records for buses with route=151 and rtdir=North. I want the closest bus by ETA for route 151 North, and I want to show on the map the bus stop (`stpid`) that that bus arrives at. There may also be arrival data for a later 151 North bus at a stop farther away — I would NOT want to map that stop (because the user presumably only cares about the closest bus)

The data flow process for bus data is thus:

- Get the 10 nearest stops to the user from the static cta-bus-stops.csv file (within 0.5 miles)
- Call the bus tracker getPredictions API using those stop ids
- In the returned `prd` array, find every distinct combination of `rt` and `rtdir`
- Then find the closest bus per rt/rtdir combination
- Map only the bus stops whose stop IDs are found in that list of closest buses per rt/rtdirs






