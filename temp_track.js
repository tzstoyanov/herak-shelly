//  SPDX-License-Identifier: GPL-2.0-or-later
//  Copyright (C) 2025, Zoya Pandeva <zoya.pandeva@gmail.com>
//  shelly model Shelly 2PM Gen3s

let CONFIG = {
  debug: false,
  scanInterval_ms: 5000, // miliseconds: read the sensors on every 5000 ms
  fetchSwInProgerss: false,
  temperature: {id: 101, current: 6, min: 4, max: 6}, // °C
  switch: { id: 0, name: "heater", state: false, desiredState: false },
};

function readTempSensor() {
  CONFIG.temperature.current = Shelly.getComponentStatus("Temperature", CONFIG.temperature.id).tC;
  if (CONFIG.debug) {
    console.log("Current temperature is ", CONFIG.temperature.current);
  }
}

function readSwState() {
  if (CONFIG.fetchSwInProgerss) {
    return false;
  }
  CONFIG.fetchSwInProgerss = true;
  Shelly.call(
    "Switch.GetStatus",
    { id: CONFIG.switch.id },
    function (result, err_code, err_message) {
      if (err_code === 0 && result != undefined) {
        if (result.id === CONFIG.switch.id) {
          CONFIG.switch.state = result.output;
        }
      }
      CONFIG.fetchSwInProgerss = false;
    }
  );
  return true;
}

function checkState() {
  if (CONFIG.temperature.current <= CONFIG.temperature.min) {
    CONFIG.switch.desiredState = true
    if (CONFIG.debug) {
      console.log("Going to start the heater");
    }
  }
  if (CONFIG.temperature.current >= CONFIG.temperature.max) {
    CONFIG.switch.desiredState = false
    if (CONFIG.debug) {
      console.log("Going to stop the heater");
    }
  }
}

function setSwitch() {
  if (CONFIG.switch.state != CONFIG.switch.desiredState) {
    Shelly.call("Switch.Set", { id: CONFIG.switch.id, on: CONFIG.switch.desiredState });
    if (CONFIG.debug) {
      console.log("Set heater to ", CONFIG.switch.desiredState ? "On" : "Off");
    }
  }
}

function tempTracker() {
  try {
    readTempSensor();
    readSwState();
    checkState();
    setSwitch();
  } catch (e) {
    print(e);
  }
}
//init the script
function init() {
  //start the timer
  Timer.set(CONFIG.scanInterval_ms, true, tempTracker);

  //Run tempTracker at start
  tempTracker();
}

init();
