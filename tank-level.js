let CONFIG = {
  scanInterval: 10, // seconds: run a timer on every 10 seconds, that will fetch the voltage
  voltmeterID: 100, // Shelly ID of the voltmeter: - when the add on is installed, the Shelly device will define and report this number
  levelMax: 6.3,  // voltmeter max measurement
  levelMin: 2.0,   // voltmeter min measurement
  highLevelThreshold: 6.0,      // Water level threshold for stopping the pump
  lowLevelPumpThreshold: 5.0,   // Water level threshold for starting the pump
  lowLevelHydroThreshold: 2.2,  // Water level threshold for stopping the hydrophore
  highLevelHydroThreshold: 2.5, // Water level threshold for starting the hydrophore
  notifyDelaySec: 120, // seconds: minimal interval between notifications
  pumpSwitchId: 0,   // Shelly ID of the pump switch
  hydroSwitchId: 1,  // Shelly ID of the hydrophore switch
  notifyUrl: 'https://home.zico.biz/api/webhook/',  // URL for the webhook notifications
  whId: '-0vJZOQ7D9NCj3Iz3p63uSMAI',                // ID of the webhook notification
};

let currentLevel;
let lvlPcnt = (CONFIG.levelMax - CONFIG.levelMin)/100;
let uptime = 0;
let pumpState = false;
let hydroState = false;
let lastNotiy = 0;
let fillInProgress = false

function sentNotify() {

  if ((uptime - lastNotiy) < CONFIG.notifyDelaySec) {
      return;
  }
  
  if (pumpState === true) {
    pumpStr = "running"
  } else {
    pumpStr = "stopped"
  }

  if (hydroState === true) {
    hyroStr = "stopped"
  } else {
    hyroStr = "running"
  }
   
  levelPcnt = (currentLevel - CONFIG.levelMin)/lvlPcnt
  console.log("Water level is " + levelPcnt.toFixed(2) + "% (" + currentLevel + "), the pump is " + pumpStr + ", the hydrophore is " + hyroStr);
  Shelly.call("http.post",
              {
                 url: CONFIG.notifyUrl+CONFIG.whId, 
                 content_type: "application/json", 
                 timeout: 10, 
                 body:{level: levelPcnt.toFixed(2), value: currentLevel, pump: pumpStr, hydro: hyroStr},
              },
              function (result, err_code, err_message) {
                  if (err_code === 0) {
                      lastNotiy = uptime;
                  }
                });
}

function sentError(str) {

  if ((uptime - lastNotiy) < CONFIG.notifyDelaySec) {
      return;
  }
  
  levelPcnt = (currentLevel - CONFIG.levelMin)/lvlPcnt
  console.log("ERROR: ", str);
  Shelly.call("http.post",
              {
                 url: CONFIG.notifyUrl+CONFIG.whId, 
                 content_type: "application/json", 
                 timeout: 10, 
                 body:{level: -1, value: currentLevel, pump: "Error", hydro: str},
              },
              function (result, err_code, err_message) {
                  if (err_code === 0) {
                      lastNotiy = uptime;
                  }
                });
}

function resetState() {
  fillInProgress = false
  Shelly.call("Switch.Set", {id: CONFIG.pumpSwitchId, on: false});
  Shelly.call("Switch.Set", {id: CONFIG.hydroSwitchId, on: false});
  sentError("Turn off the pumps")
}

function checkState() {
 let notify = false;

  if (currentLevel >= CONFIG.highLevelThreshold) {
     fillInProgress = false
     notify = pumpState
  }
  
  if (currentLevel <= CONFIG.lowLevelPumpThreshold) {
     fillInProgress = true
     notify = !pumpState
  }
  
  if (fillInProgress === true && pumpState === false) {
      Shelly.call("Switch.Set", {id: CONFIG.pumpSwitchId, on: !pumpState});
  }
  if (fillInProgress === false && pumpState === true) {
      Shelly.call("Switch.Set", {id: CONFIG.pumpSwitchId, on: !pumpState});
  }

  // The hydrophore switch is configured with reverse logic:
  // When the switch is ON, the hydrophore is stopped
  // When the switch is OFF, the hydrophore is running
  if (currentLevel <= CONFIG.lowLevelHydroThreshold) {
    if (hydroState === false) {
      Shelly.call("Switch.Set", {id: CONFIG.hydroSwitchId, on: !hydroState});
      notify = true;
    }
  } 
  if (currentLevel > CONFIG.highLevelHydroThreshold) {
    if (hydroState === true) {
      Shelly.call("Switch.Set", {id: CONFIG.hydroSwitchId, on: !hydroState});
      notify = true;
    }
  }
  
  if (notify) {
      sentNotify();
  }
}

function getPumpState(res, err_code, err_msg, ud) {
  if (typeof res === "undefined" || res === null || err_code !== 0) {
    if (err_code !== 0) {
      let str = "Getting the pump state " + err_code + " - [" + err_msg + "]"
      console.log("Error:" + str);
      sentError(str)
    }
    return;
  }
  if (res.id !== CONFIG.pumpSwitchId) {
    return;
  }
  pumpState = res.output;
}

function getHydroState(res, err_code, err_msg, ud) {
  if (typeof res === "undefined" || res === null || err_code !== 0) {
    if (err_code !== 0) {
      let str = "Getting the hydro state " + err_code + " - [" + err_msg + "]"
      console.log("Error " + str);
      sentError(str)
    }
    return;
  }
  if (res.id !== CONFIG.hydroSwitchId) {
    return;
  }
  
  hydroState = res.output;
  
  checkState();
}

function getShellyState(res, err_code, err_msg, ud) {
   if (typeof res === "undefined" || res === null || err_code !== 0) {
    if (err_code !== 0) {
      let str = "Getting the Shelly state " + err_code + " - [" + err_msg + "]"
      console.log("Error " + str);
    }
    return;
  }
  uptime = res.sys.uptime;
}

function fetchVoltage() {
  //Fetch the voltmeter component
  const voltmeter = Shelly.getComponentStatus(
    "voltmeter:" + JSON.stringify(CONFIG.voltmeterID)
  );

  //exit if can't find the component
  if (typeof voltmeter === "undefined" || voltmeter === null) {
    console.log("Can't find the voltmeter component");
    return;
  }

  const voltage = voltmeter["voltage"];

  //exit if can't read the voltage
  if (typeof voltage !== "number") {
    console.log("can't read the voltage or it is NaN");
    return;
  }
  currentLevel = voltage;
  Shelly.call("Shelly.GetStatus", {}, getShellyState);
  Shelly.call("Switch.GetStatus", {id: CONFIG.pumpSwitchId,}, getPumpState);
  Shelly.call("Switch.GetStatus", {id: CONFIG.hydroSwitchId,}, getHydroState);
}

//init the script
function init() {
  //start the timer
  Timer.set(CONFIG.scanInterval * 1000, true, fetchVoltage);

  //fetch the voltage at run
  fetchVoltage();
}

init();
