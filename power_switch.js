// SPDX-License-Identifier: GPL-3.0-or-later
//
// Copyright (C) 2026, Tzvetomir Stoyanov <tz.stoyanov@gmail.com>
//

let CFG = {
  scanInterval_ms: 1000, // milliseconds: check the battery on every 1s
  uptime_ms: 0,
  scan_run: 0,
  runInProgress: false,
  fetchSwInProgress: false,
  lowPower: false,
  battValidState: false,
  // WebHook notifications
  notify: {
    delaySec: 120, // seconds: minimal interval between notifications
    filter: 5, // Max number of notification within notifyDelaySec interval
    queueCount: 15, // Max unsend notifications
    inProgress: false,
    url: "http://192.168.10.137:8123/api/webhook/", // URL for the webhook notifications
    whId: "-0vJZOQ7D9NCj3Iz3p63uSMAI", // ID of the webhook notification
    lastSent_ms: 0,
    queuePushIdx: 0,
    send: 0,
    queuePopIdx: 0,
    queue: new Array(15), // must match queueCount
  },
  batteries: [
    { id: "6k", name: "6.2Kw", stateOn: true, hasPower: false, validState: false},
    { id: "4k", name: "4Kw", stateOn: false, hasPower: false, validState: false},
  ],
  switches: [
    { id: 0, name: "MasterSwitch", state: true, control: true},
  ],  
};

function sentNotify(str) {
  console.log("Notify: ", str);
  CFG.notify.queue[CFG.notify.queuePushIdx] = str;
  CFG.notify.queuePushIdx++;
  if (CFG.notify.queuePushIdx >= CFG.notify.queueCount) {
    CFG.notify.queuePushIdx = 0;
  }
}

function sentNotifyTask() {
  if (CFG.notify.inProgress) {
    return;
  }
  if (CFG.notify.queue[CFG.notify.queuePopIdx] == undefined) {
    return;
  }
  if (CFG.uptime_ms - CFG.notify.lastSent_ms < CFG.notify.delaySec * 1000) {
    if (CFG.notify.send >= CFG.notify.filter) {
      return;
    }
  } else {
    CFG.notify.send = 0;
  }

  CFG.notify.inProgress = true;
  str = CFG.notify.queue[CFG.notify.queuePopIdx];
  CFG.notify.queue[CFG.notify.queuePopIdx] = undefined;
  CFG.notify.queuePopIdx++;
  if (CFG.notify.queuePopIdx >= CFG.notify.queueCount) {
    CFG.notify.queuePopIdx = 0;
  }
  CFG.notify.send++;
  Shelly.call(
    "http.post",
    {
      url: CFG.notify.url + CFG.notify.whId,
      content_type: "application/json",
      timeout: CFG.callTimeout,
      body: { message: str },
    },
    function (result, err_code, err_message) {
      if (err_code === 0) {
        CFG.notify.lastSent_ms = CFG.uptime_ms;
      }
      CFG.notify.inProgress = false;
    }
  );
}

function setLowPower(state) {
  if (CFG.lowPower != state) {
    CFG.lowPower = state;
    if (CFG.lowPower) {
      sentNotify("Low power");
    } else {
      sentNotify("Power restored");
    }
  }
}

function setSwitchState(sw_id, state) {
  if (CFG.switches[sw_id].control) {
    Shelly.call("Switch.Set", { id: CFG.switches[sw_id].id, on: state });
  }
  console.log(CFG.switches[sw_id].name, " -> ", state);
}

function selectBattery() {
  if (!CFG.battValidState)
      return;
  for (let i = 0; i < CFG.batteries.length; i++) {
    if (CFG.switches[0].state == CFG.batteries[i].stateOn) {
      if (CFG.batteries[i].hasPower) {
        // Current battery has enough power
        setLowPower(false);
        return;
      }
      break;
    }
  }

  for (let i = 0; i < CFG.batteries.length; i++) {
    if (CFG.batteries[i].hasPower) {
        // Select a battery that has power
        sentNotify("Switch to battery " + CFG.batteries[i].name, "");
        setSwitchState(0, CFG.batteries[i].stateOn);
        setLowPower(false);
    }
  }

  setLowPower(true);
}

function readSwState() {
  if (CFG.fetchSwInProgress) {
    return false;
  }
  CFG.fetchSwInProgress = true;
  Shelly.call(
    "Switch.GetStatus",
    { id: CFG.switches[0].id },
    function (result, err_code, err_message) {
      if (err_code === 0 && result != undefined) {
        if (result.id === CFG.switches[0].id) {
          CFG.switches[0].state = result.output;
        }
      } else {
        if (err_message) {
          sentNotify(CFG.switches[0].name + ": " + err_message);
        }
      }
      CFG.fetchSwInProgress = false;
    }
  );
  return true;
}

function battRun() {
  CFG.uptime_ms += CFG.scanInterval_ms;
  if (CFG.runInProgress) {
    return;
  }
  CFG.runInProgress = true;
  CFG.scan_run++;
  readSwState();
  selectBattery();
  sentNotifyTask();
  CFG.runInProgress = false;
}

function logStatus() {
  console.log("Status: ");
  console.log(" battValidState: ",  CFG.battValidState);
  for (let i = 0; i < CFG.batteries.length; i++) {
    console.log(" batt ",  i, " id: ", CFG.batteries[i].id,
                " name: ", CFG.batteries[i].name,
                " hasPower: ", CFG.batteries[i].hasPower, 
                " validState: ", CFG.batteries[i].validState,
                " stateOn: ", CFG.batteries[i].stateOn);
  }
  console.log(" sw0State: ",  CFG.switches[0].state);
}

function setBatteryState(id, state) {
  for (let i = 0; i < CFG.batteries.length; i++) {
    if (id === CFG.batteries[i].id) {
      CFG.batteries[i].hasPower = state;
      CFG.batteries[i].validState = true;
      break;
    }
  }
  if (CFG.battValidState)
    return;
  for (let i = 0; i < CFG.batteries.length; i++) {
    if (!CFG.batteries[i].validState)
      return;
  }
  CFG.battValidState = true;
}

// http://<dev ip>/script/1/user_command?4k=<on/off>
// http://<dev ip>/script/1/user_command?6k=<on/off>
// http://<dev ip>/script/1/user_command?status
function onUserCommand(request, response) {
  code = 400;
  body = "Bad Request";
  let cmd = request.query.split("=");

  if (cmd[0] === "4k" || cmd[0] === "6k") {
    if (cmd[1] == "on") {
      setBatteryState(cmd[0], true);
      body = "0";
      code = 200;
    } else if (cmd[1] == "off"){
      setBatteryState(cmd[0], false);
      body = "0";
      code = 200;
    }
  }

  if (cmd[0] === "status") {
    logStatus();
    body = "0";
    code = 200;
  }

  response.code = code;
  response.body = body;
  response.send();
}

//init the script
function init() {
  HTTPServer.registerEndpoint("user_command", onUserCommand);
  //start the timer
  Timer.set(CFG.scanInterval_ms, true, battRun);
}
init();
