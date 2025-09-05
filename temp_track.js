//  SPDX-License-Identifier: GPL-2.0-or-later
//  Copyright (C) 2025, Zoya Pandeva <zoya.pandeva@gmail.com>
//  shelly model Shelly 2PM Gen3s

let CONFIG = {
  debug: true,
  scanInterval_ms: 5000, // miliseconds: read the sensors on every 5000 ms
  tempThreshold: 3, // °C
  switch: { id: 0, name: "heater" },
};

function tempTracker() {
  try {
    Shelly.call(
      "Switch.GetStatus",
      { id: CONFIG.switch.id },
      function (result, err_code, err_message) {
        if (result !== undefined && err_code === 0) {
          if (CONFIG.debug) {
            console.log(
              "Current heater status is",
              onOffState(result.output),
              err_code,
              err_message
            );
          }
          const currentState = result.output;
          let temp = readTempSensor();
          setSwitch(temp, currentState);
        } else {
          throw err_message;
        }
      }
    );
  } catch (e) {
    print(e);
  }
}
function readTempSensor() {
  let temp = Shelly.getComponentStatus("Temperature", 100).tC; //Temp ID, mostly 100 to 102
  return temp;
}

function setSwitch(temp, currentState) {
  let desireState = temp < CONFIG.tempThreshold;
  if (currentState !== desireState) {
    Shelly.call("Switch.Set", { id: CONFIG.switch.id, on: desireState });
  }
  if (CONFIG.debug) {
    console.log("Heater is ", onOffState(desireState));
  }
}

function onOffState(state) {
  return state ? "On" : "Off";
}

//init the script
function init() {
  //start the timer
  Timer.set(CONFIG.scanInterval_ms, true, tempTracker);

  //Run tempTracker at start
  tempTracker();
}

init();
