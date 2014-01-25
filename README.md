MBTA Push Alerts
===========

### Overview
MBTA Push Alerts powers remote push notifications for the ProximiT iOS app [ProximiT iOS app](http://www.proximitapp.com "ProximiT's Homepage"). ProximiT additionally uses a seperate notification structure based around UILocalNotifications for geofence based alerts which is not included in this project.

### Background 
The original code for this project and node/couchdb architecture was borrowed from the Twitter-based [mbta_alerts](https://github.com/codeforboston/mbta-alerts "MBTA Alerts Repo") project. Thank you to [calvinmetcalf](https://github.com/calvinmetcalf) and the folks at codeforboston!

Much of the project was subsequently rewritten/repurposed by [Randy Dailey](https://github.com/randydailey) and [Jeff Lopes](https://github.com/jefflopes).

### When Will You Send A Push? To Who?
This project checks the [MBTA Alerts Feed](http://realtime.mbta.com/developer/api/v1/alerts?api_key=wX9NwuHnZU2ToO7GmGR9uw "MBTA Alerts Feed") every minute and sends push messages via Urban Airship to registered audiences when a moderate/severe service disruption is detected. 

Alerts are only sent during T operating hours and they are sent only to the audiences that are impacted (In the targeting code, we target people who are opted into 'tags' which include "MBTA Red Line", "MBTA Blue Line" and "MBTA Orange Line."

Our core filter/reject logic is captured here:

 ```javascript
  // Filter all alerts that do not affect Subway
  filteredAlerts = _.filter(alerts, function(alert) {
    return _.some(alert.affected_services.services, function(service) {
      return service['mode_name'] == 'Subway';
    });
  });

  // Filter all alerts that are not related to a delay/detours
  filteredAlerts = _.filter(filteredAlerts, function(alert) {
    return alert.effect_name == "Delay" || alert.effect_name == "Detour";
  });

  // Filter all alerts that are not in/about to be effective
  filteredAlerts = _.filter(filteredAlerts, function(alert) {
    return currentlyNearEffectivePeriod(alert);
  });

  // Filter alerts that are minor
  filteredAlerts = _.reject(filteredAlerts, function(alert) {
    return alert.severity == "Minor";
  })

  // Filter alerts that we don't have subscribed audiences for
  filteredAlerts = _.filter(filteredAlerts, function(alert) {
    return audienceTagsForAlert(alert).length > 0
  });
 ```

### Tech Notes
ProximiT Push Alerts uses:

+ nodejs
+ couchdb
+ urbanairship (NOTE: We modified the urban-airship node module to use v3 of the UrbanAirship API and then directly included it in the project)

### Getting Set Up for Development

```bash
brew install couchdb
curl -X PUT http://127.0.0.1:5984/mbta
npm install
./server.js
```

