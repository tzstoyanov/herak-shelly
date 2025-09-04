/* shelly model Shelly 2PM Gen3s
 */

let CONFIG = {
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
          console.log(
            "Current heater status is",
            onOffState(result.output),
            err_code,
            err_message
          );
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
  print(temp);
  let desireState = temp < CONFIG.tempThreshold;
  if (currentState !== desireState) {
    Shelly.call("Switch.Set", { id: CONFIG.switch.id, on: desireState });
  }
  console.log("Heater is ", onOffState(desireState));
}
function onOffState(state) {
  return state ? "On" : "Off";
}

function onUserCommand(request, response) {}

//init the script
function init() {
  HTTPServer.registerEndpoint("user_command", onUserCommand);

  //start the timer
  Timer.set(CONFIG.scanInterval_ms, true, tempTracker);

  //Run tempTracker at start
  tempTracker();
}

init();