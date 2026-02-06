# Chicago Transit ETA Web App

## Project description

Make a one-page static web app that reads the visitor's current geospatial location that uses Chicago Transit Authority (CTA) data APIs to find the nearest Chicago transit bus stops and rail stations, and then lists the estimated arrival times (in either direction) for each stop.

### Technical requirements

- Use Svelte 5.0
- The app should be a static single page app, as it relies on static data files (in static/data) or calling APIs

### Detailed flow description

- User visits the CTA ETA Webapp page
- Webapp requests permission to get user geospatial location
- Using the user's coordinates, the webapp then reads the following static data files of stop locations:
    - read bus stop data [static/data/cta-bus-stops.csv](static/data/cta-bus-stops.csv)
        - find all bus stops within 0.5 miles of the user
        - gather all the unique route numbers that pass through these stops (the `ROUTESSTPG` column contains a comma delimited list of route numbers for that stop), for each direction (column `DIR`)
        - for each route number and route direction, find the nearest stop to the user
            - this is so we don't return a list of every Route 36 bus stop within a 0.5 radius from the user, just the nearest northbound and southbound Route 36 bus stops
    - read train stop data from [static/data/cta-train-stops.csv](static/data/cta-train-stops.csv)
        - for each unique train line and direction (`DIRECTION_ID`), find the *two* nearest train stops to the user

- Now that you've gathered stop IDs from these files (`STOP_ID`), use them to call the respective CTA APIs:
    - Iterating through each train stop STOP_ID, call the [Train Tracker Arrivals API](#mark-train-tracker-arrivals-api) and find the closest train and its ETA data
    - Iterating through each bus stop STOP_ID, call the [Bus Get Predictions API](#mark-bus-get-predictions-api) (the `stpid` parameter can take more than one stop id), and find the nearest arriving buses for each stop

- Render the bus and train stops on a Leaflet OpenStreetMap
    - attach click eventhandlers that show the ETAs for each clicked stop
- Render a text list of the bus and train stops, with the ETAs of arriving trains/buses


### Mapping
The web app should also use a Leaflet + Openstreet map to show the user's current location and the locations of the nearest stops.

For the map icons:
- the map marker color for bus stops should be in black
- the map marker color for rail stops should be based on the name of the rail line, e.g. the Red line stops should have red map markers
- some rail stops have multiple lines. In that case, the map marker should show a combination of those colors
- clicking on a map marker should pop up a balloon that shows the ETAs for their nearest train/bus, for all routes and their respective directions

Below the map should be a simple list of the nearest stops, along with the closest ETAs for the closest trains/buses per route/line at each stop.

By default, the app should find the stops within a half-mile radius of the user's location.




## Data details

This web app uses a combination of data cached in `static/data` and APIs from the CTA data portal.

### Static data

#### CTA L Stops

[static/data/cta-train-stops.csv](./static/data/cta-train-stops.csv)

This is a CSV that lists all the rail lines.

The color of the stop is indicated in the columns:

    RED,BLUE,G,BRN,P,Y,Pnk,O

(P is for Pink, G is for Green, BRN is Brown, Y is Yellow, Pnk is pink, O is Orange)

Some train stops have more than one line that pass through them.

#### CTA Bus Stops

[static/data/cta-bus-stops.csv](./static/data/cta-bus-stops.csv)

Each bus stop line direction has its own row, so when gathering stops based on nearest to user location, combine entries as needed, so that each physical stop incorporates data for all directions (column `DIR`) of a given route.


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
http://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=API_DEV_KEY&outputType=JSON&stpid=30213

Sample data: [tests/samples/train-ttarrivals.json](./tests/samples/train-ttarrivals.json)

Make a call for each nearby train stop and display the ETA of the nearest train.

Note that this API is calling data per train **stop** — a station with a Red line will have two stops: a northbound and a southbound.


<div id="mark-bus-get-predictions-api"></div>

#### Bus Get Predictions API

Documentation stored locally:

[docs/apis/cta-bus-tracker-api-developer-guide.pdf](./docs/apis/cta-bus-tracker-api-developer-guide.pdf)

Sample call:
https://www.ctabustracker.com/bustime/api/v3/getpredictions?key=API_DEV_KEY&format=json&stpid=14545

Sample data: [tests/samples/bus-predictions.json](./tests/samples/bus-predictions.json)





