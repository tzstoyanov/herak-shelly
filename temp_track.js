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
        console.log(
          "Current switch status:",
          result.output,
          err_code,
          err_message
        );
        const currentState = result.output;
        let temp = readTempSensor();
        setSwitch(temp, currentState);
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
  let desireState;
  if (temp < CONFIG.tempThreshold) {
    desireState = true;
  } else {
    desireState = false;
  }
  if (currentState !== desireState) {
    Shelly.call("Switch.Set", { id: CONFIG.switch.id, on: desireState });
  }
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
