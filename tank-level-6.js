// SPDX-License-Identifier: GPL-3.0-or-later
//
// Copyright (C) 2024-2026, Tzvetomir Stoyanov <tz.stoyanov@gmail.com>
//

// Shelly controlling tank 6000L
let TANK = {
  name: "Tank 6000L",
  scanInterval_ms: 100, // miliseconds: read the sensors on every 100 ms
  runInProgress: false,
  fetchSwInProgerss: false,
  setSwInProgress: false,
  fetchSwIdx: 0,
  switches: [
    { id: 0, name: "valves", state: false, desiredState: false, control: true },
    { id: 1, name: "hydro 6000L", state: false, desiredState: false, control: false },
  ],
  hydroOnState: true, // State of the hydro switch to run the hydrophore
};

function setSwitchState(sw_id, state) {
  if (!TANK.switches[sw_id].control || TANK.setSwInProgress) {
    return;
  }

  TANK.setSwInProgress = true;
  TANK.switches[sw_id].desiredState = state;
  console.log("Setting ", TANK.switches[sw_id].name, " -> ", state);

  Shelly.call("Switch.Set", { id: TANK.switches[sw_id].id, on: state });
  Shelly.call(
    "Switch.Set",
    { id: TANK.switches[sw_id].id, on: state },
    function (result, err_code, err_message) {
      if (err_code === 0) {
        TANK.switches[sw_id].state = state;
      } else {
        if (err_message) {
          console.log("Error setting switch:", err_message);
        }
      }
      TANK.setSwInProgress = false; // Release lock when RPC completes
    }
  );
}

function checkSwitchState() {
  let mismatch = false;

  for (let i = 0; i < TANK.switches.length; i++) {
    if (!TANK.switches[i].control) {
      continue;
    }
    if (TANK.switches[i].state != TANK.switches[i].desiredState) {
      console.log(
        TANK.switches[i].name + " mismatch: " + TANK.switches[i].desiredState
      );
      setSwitchState(i, TANK.switches[i].desiredState);
      mismatch = true;
    }
  }

  return mismatch;
}

function checkState() {
  checkSwitchState();
}

function readSwState(sw_id) {
  if (TANK.fetchSwInProgerss) {
    return false;
  }
  TANK.fetchSwInProgerss = true;
  Shelly.call(
    "Switch.GetStatus",
    { id: TANK.switches[sw_id].id },
    function (result, err_code, err_message) {
      if (err_code === 0 && result != undefined) {
        if (result.id === TANK.switches[sw_id].id) {
          TANK.switches[sw_id].state = result.output;
        }
      } else {
        if (err_message) {
          console.log(TANK.switches[sw_id].name + ": " + err_message);
        }
      }
      TANK.fetchSwInProgerss = false;
    }
  );
  return true;
}

function readStates() {
  if (readSwState(TANK.fetchSwIdx)) {
    TANK.fetchSwIdx++;
    if (TANK.fetchSwIdx >= TANK.switches.length) {
      TANK.fetchSwIdx = 0;
    }
  }
}

function tankRun() {
  if (TANK.runInProgress) {
    return;
  }
  TANK.runInProgress = true;
  readStates();
  checkSwitchState();
  TANK.runInProgress = false;
}

function getQueryParams(str) {
  let result = {};
  let params = str.split("&");
  params.forEach(function (param) {
    let paramParts = param.split("=");
    result[paramParts[0]] = paramParts[1];
  });
  return result;
}

function setSwRequestEndpoint(req, res) {
  let read = false;
  params = getQueryParams(req.query);
  if (params.sw0) {
    let state = params["sw0"] === "true";
    if (TANK.switches[0].control && TANK.switches[0].state != state) {
      console.log("Requested ", TANK.switches[0].name, ": ", state);
      setSwitchState(0, state);
      read = true;
    }
  }
  if (params.sw1) {
    let state = params["sw1"] === "true";
    if (TANK.switches[1].control && TANK.switches[1].state != state) {
      console.log("Requested ", TANK.switches[0].name, ": ", state);
      setSwitchState(1, state);
      read = true;
    }
  }
  if (read) {
    readStates();
  }
  res.code = 200;
  res.headers = { "Content-Type": "application/json" };
  let jres = {
    sw0: TANK.switches[0].state,
    sw1: TANK.switches[1].state,
  };
  res.body = JSON.stringify(jres);
  res.send();
}

//init the script
function init() {
  HTTPServer.registerEndpoint("setSwRequest", setSwRequestEndpoint);
  //start the timer
  Timer.set(TANK.scanInterval_ms, true, tankRun);

  //Read sensor data at start
  tankRun();
}

init();
