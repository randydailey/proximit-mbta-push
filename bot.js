var request = require('request');
var UA = require('./urban-airship');
var config = require('./config');
var crypto = require('crypto');
var winston = require('winston');
var time = require('time');
var _ = require('underscore');

var now;

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.File)({ filename: config.logDirectory + 'info.json' })
  ]
});

var sent = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)(),
    new (winston.transports.File)({ filename: config.logDirectory + 'sent.json' })
  ]
});

//
// Constants
//

var TESTING = false;

var routeTagMap = {
  "903_" : "MBTA Line Orange",
  "913_" : "MBTA Line Orange",
  "931_" : "MBTA Line Red",
  "933_" : "MBTA Line Red",
  "946_" : "MBTA Line Blue",
  "9462" : "MBTA Line Blue",
  "948"  : "MBTA Line Blue",
  "9482" : "MBTA Line Blue"
}

var params = {
  qs: {
    api_key: config.key
  },
  url: 'http://realtime.mbta.com/developer/api/v1/alerts',
  json: true
};


function defaultCallback(err) {
  if (err) {
    return logger.info(err);
  }
};

function start() {
  logger.info('Run #', ++i);

  now = new time.Date();
  now.setTimezone("America/New_York");

  if (isQuietTime())
  {
    logger.info('Quiet time enforced');
    return;
  }

  request(params, function(e, r, b) {
    if (b && b.alerts) {
      dumbCache(b.alerts, function(alerts) {
        return processAlerts(alerts);
      });
    } else {
      logger.info(e, r, b);
    }
    return true;
  });
  return true;
};

function isQuietTime()
{
  return (now.getHours >= 2 && now.getHours <= 5);
}

function currentlyNearEffectivePeriod(alert)
{  
  return _.some(alert.effect_periods, function(period) {    
    // Pretend the effective date is 3 hours earlier than it is
    var startOfNotificationWindow = period["effect_start"] * 1000;
    startOfNotificationWindow = startOfNotificationWindow - (60 * 60 * 2 * 1000);
    logger.info(startOfNotificationWindow, now.getTime());
    return (now.getTime() > startOfNotificationWindow);
  });
}

function processAlerts(alerts) {
  alertsToProcess = filterInvalidAlerts(alerts);

  if (TESTING) {
    _.each(alertsToProcess, function(alert) {
      sendPush(alert, audienceTagsForAlert(alert));
    });

    return;
  }

  _.each(alertsToProcess, function(alert) {
    logger.info("Evaluating alert: " + JSON.stringify(alert));
    alreadySentAlert(alert, function (alertWasNotSent) {
      // Callback will only be called if alert has not been sent
      markAsSent(alert, function (alertMarkedAsSent) {
        // Callback will only be called if alert was marked as sent  
        sendPush(alert, audienceTagsForAlert(alert));
      });
    });
  });
}

function filterInvalidAlerts(alerts) {
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
  logger.info("Filtering alerts by type: " + JSON.stringify(filteredAlerts));

  // Filter all alerts that are not in/about to be effective
  filteredAlerts = _.filter(filteredAlerts, function(alert) {
    return currentlyNearEffectivePeriod(alert);
  });
  logger.info("Filtered alerts by effective period: " + JSON.stringify(filteredAlerts));

  // Filter alerts that are minor
  filteredAlerts = _.reject(filteredAlerts, function(alert) {
    return alert.severity == "Minor";
  })
  logger.info("Filtered alerts by non-minor severity: " + JSON.stringify(filteredAlerts));

  // Filter alerts that we don't have subscribed audiences for
  filteredAlerts = _.filter(filteredAlerts, function(alert) {
    return audienceTagsForAlert(alert).length > 0
  });
  logger.info("Filtered alerts by valid routes: " + JSON.stringify(filteredAlerts));

  return filteredAlerts;
}

function audienceTagsForAlert(alert) {
  var tags = [];
  alert.affected_services.services.forEach(function(service) {
    tag = audienceTagsForRoute(service);
    if (tag) tags.push(audienceTagsForRoute(service));
  });

  return _.uniq(tags);
}

function audienceTagsForRoute(service) {
  if (service && routeTagMap[service["route_id"]])
    return routeTagMap[service["route_id"]];
}

function sendPush(alert, tags) {
  if (!tags || tags.length == 0) {
    logger.info("No audience determined for this alert. Aborting");
    return;
  }

  ua = new UA(config.ua.appKey, config.ua.appSecret, config.ua.masterSecret);
  var payload =  {
                   "audience": {
                      "tag" : tags
                   },
                   "notification": {
                      "ios": {
                         "alert" : alert.header_text,
                         "expiry" : 3600
                      }
                    },
                   "device_types": ["ios"] 
                 };


  sent.info("Sending payload: " + JSON.stringify(payload));
  ua.pushNotification("/api/push/", payload, function(error) {});
};

function alreadySentAlert(alert, successCallback) {
  var nParams = {
    url: "http://" + config.couch.server + "/" + config.couch.db + "/" + alert['alert_id'].toString(),
    json: true
  };

  request(nParams, function(e, r, b) {
    if (e) {
      logger.info (e);
    } 
    else if (r.statusCode === 200) {
      logger.info ("Alert was already sent");
    } 
    else {
      successCallback();
    }
  });
};

function markAsSent(alert, successCallback) {
  var nParams = {
    url: "http://" + config.couch.server + "/" + config.couch.db + "/" + alert['alert_id'].toString(),
    json: true,
    method: 'put',
    body: alert
  };

  request(nParams, function(e, r, b) {
    if (r.statusCode === 201) {
      logger.info("Alert successfully marked as sent");
      successCallback();
    } 
  });
};

lastHash = false;

function dumbCache(alerts, cb) {
  var hash, newHash;
  hash = crypto.createHash('sha512');
  hash.update(JSON.stringify(alerts), 'utf8');
  newHash = hash.digest('base64');
  if (lastHash === newHash) {
    logger.info('No change');
  } else {
    lastHash = newHash;
    cb(alerts);
  }
  return true;
};

i = 0;

start();

setInterval(start, 60000);
