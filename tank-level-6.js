// SPDX-License-Identifier: GPL-2.0-or-later
//
// Copyright (C) 2024, Tzvetomir Stoyanov <tz.stoyanov@gmail.com>
//

let CONFIG = {
	scanInterval_ms: 100,   // miliseconds: read the sensors on every 100 ms
	calcInterval: 10,      // times * scanInterval_ms: check the tanks state
	samplesCount: 10,	 // count: Number of samples to collect on each measurement 
	uptime_ms: 0,
	scan_run: 0,
	runInProgress: false,
 // WebHook notifications
 notify: { delaySec: 120, // seconds: minimal interval between notifications
					 filter: 5, // Max number of notification within notifyDelaySec interval
					 queueCount: 10, // Max unsend notifications
					 inProgress: false,
					 url: 'http://192.168.10.137:8123/api/webhook/',  // URL for the webhook notifications
					 whId: '-0vJZOQ7D9NCj3Iz3p63uSMAI',  // ID of the webhook notification
				},  
};

// Remote Shelly, controling tank 6000L
let TANK = {
	name: "Tank 6000L",
	controlTankFill: true,
	controlTankHydro: false,
	fillRequest: false, 
	fetchSwInProgerss: false,
	fetchSwIdx: 0,
	switches: [ {id: 0, name: "valves", state: false, desiredState: false},
						{id: 1, name: "hydro 6000L", state: false, desiredState: false} ],
	hydroOnState: true, // State of the hydro swtich to run the hydrophore
	voltmeter: {id: 100, samples: new Array(CONFIG.samplesCount), idx: -1,  fetchInProgerss: false},
	level: {max: 6.0, min: 2.0, current: 0, pcnt: 0},
	pumpThreshold: {low: 4.0, high: 5.0}, // Water level threshold for stopping and satrting the pump
	hydroThreshold: {low: 2.2, high: 2.5}, // Water level threshold for stopping and satrting the hydrophore
	notify: { lastSent_ms: 0, queuePushIdx: 0, send: 0,
			queuePopIdx: 0, queue: new Array(CONFIG.notify.queueCount)},  
};

function sentNotify(str) {
	console.log("Notify: ", str);
	TANK.notify.queue[TANK.notify.queuePushIdx] = str;
	TANK.notify.queuePushIdx++;
	if (TANK.notify.queuePushIdx >= CONFIG.notify.queueCount) {
		 TANK.notify.queuePushIdx = 0;
	}
}

function sentNotifyTask() {
	if (CONFIG.notify.inProgress) { return; }
	if (TANK.notify.queue[TANK.notify.queuePopIdx] == undefined) {
		return;
	}
	if ((CONFIG.uptime_ms - TANK.notify.lastSent_ms) < (CONFIG.notify.delaySec*1000)) {
			if (TANK.notify.send >= CONFIG.notify.filter) { return; }
	} else {
		TANK.notify.send = 0;
	}

	CONFIG.notify.inProgress = true;
	str = TANK.notify.queue[TANK.notify.queuePopIdx];
	TANK.notify.queue[TANK.notify.queuePopIdx] = undefined;
	TANK.notify.queuePopIdx++;
	if (TANK.notify.queuePopIdx >= CONFIG.notify.queueCount) {
		TANK.notify.queuePopIdx = 0;
	}
	TANK.notify.send++;
	Shelly.call("http.post",
	 { url: CONFIG.notify.url+CONFIG.notify.whId,  content_type: "application/json", 
		 timeout: CONFIG.callTimeout, body:{message: str}},
		 function (result, err_code, err_message) {
									if (err_code === 0) { TANK.notify.lastSent_ms = CONFIG.uptime_ms; }
									CONFIG.notify.inProgress = false;
		 });
}

function setSwitchState(sw_id, state) {
	Shelly.call("Switch.Set", {id: TANK.switches[sw_id].id, on: state});
	TANK.switches[sw_id].desiredState = state;
	console.log(TANK.switches[sw_id].name, " -> ", state);  
	return (TANK.switches[sw_id].state === TANK.switches[sw_id].desiredState);
}

function checkSwitchState() {
	let mismatch = false;
	
	for (let i = 0; i < TANK.switches.length; i++) {
		if (TANK.switches[i].state != TANK.switches[i].desiredState) {
			console.log(TANK.switches[i].name + ' mismatch: ' + TANK.switches[i].desiredState);
 			setSwitchState(i, TANK.switches[i].desiredState);
			mismatch = true;
		}
	}
	
	return mismatch;
}

function checkFillState() {
		if (TANK.controlTankFill !== true) {
			return;
		}
		if (TANK.level.current <= TANK.pumpThreshold.low) {
			if (!TANK.fillRequest) {
				let levelPcnt = (TANK.level.current - TANK.level.min)/TANK.level.pcnt;
				sentNotify(TANK.name + " is empty (" + levelPcnt.toFixed(2) + "%).");
			}
			TANK.fillRequest = true;
			return;
		}
		if (TANK.level.current >= TANK.pumpThreshold.high) {
			if (TANK.fillRequest) {
				let levelPcnt = (TANK.level.current - TANK.level.min)/TANK.level.pcnt;
				sentNotify(TANK.name + " is full (" + levelPcnt.toFixed(2) + "%).");
			}    
			TANK.fillRequest = false;
	 }
}

function checkHydroState() {
		if (TANK.controlTankHydro !== true) {
			return;
		}
		if (TANK.level.current >= TANK.hydroThreshold.high) {
					 setSwitchState(1, TANK.hydroOnState)
		}
		if (TANK.level.current <= TANK.hydroThreshold.low) {
					 setSwitchState(1, !TANK.hydroOnState)
		}
}

function checkState() {
	checkSwitchState();
	checkHydroState();
	checkFillState();
}

function calcVoltage(val) {
	if(TANK.voltmeter.idx < 0) {
		 for (let i = 0; i < TANK.voltmeter.samples.length; i++) {
			 TANK.voltmeter.samples[i] = val;
		 }
		 TANK.voltmeter.idx = 0;
	} else {
		TANK.voltmeter.samples[TANK.voltmeter.idx] = val;
		TANK.voltmeter.idx++;
		if (TANK.voltmeter.idx >= TANK.voltmeter.samples.length) {
			TANK.voltmeter.idx = 0;
		}
	}
	let v = 0.0; 
	for (let i = 0; i < TANK.voltmeter.samples.length; i++) {
		v += TANK.voltmeter.samples[i];
	}
	TANK.level.current = (v / (TANK.voltmeter.samples.length)).toFixed(2);
}

function readSensors() {
	if (TANK.voltmeter.fetchInProgerss) {
		return;
	}
	TANK.voltmeter.fetchInProgerss = true;
	//Fetch the voltmeter component
	const voltmeter = Shelly.getComponentStatus(
		"voltmeter:" + JSON.stringify(TANK.voltmeter.id)
	);

	//exit if can't find the component
	if (typeof voltmeter == undefined || voltmeter === null) {
		console.log("Can't find the voltmeter component");
		TANK.voltmeter.fetchInProgerss = false;
		return undefined;
	}

	const voltage = voltmeter["voltage"];

	//exit if can't read the voltage
	if (typeof voltage !== "number") {
		console.log("can't read the voltage or it is NaN");
		TANK.voltmeter.fetchInProgerss = false;
		return undefined;
	}
	calcVoltage(voltage);
	TANK.voltmeter.fetchInProgerss = false;
}

function readSwState(sw_id) {
 if (TANK.fetchSwInProgerss) {
	 return false;
 }
 TANK.fetchSwInProgerss = true;
 Shelly.call("Switch.GetStatus",
		{ id: TANK.switches[sw_id].id },
		function (result, err_code, err_message) {
			if (err_code === 0 && result != undefined) {
				if (result.id === TANK.switches[sw_id].id) {
					TANK.switches[sw_id].state = result.output;
				}
			} else {
				if (err_message) { console.log(TANK.switches[sw_id].name + ": " + err_message) }
			}
			TANK.fetchSwInProgerss = false;
	 });
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
	CONFIG.uptime_ms += CONFIG.scanInterval_ms;
	if (CONFIG.runInProgress) {
		return;
	}
	CONFIG.runInProgress = true;
	CONFIG.scan_run++;
	readSensors();
	readStates();
	if (CONFIG.scan_run >= CONFIG.calcInterval) {
		CONFIG.scan_run = 0;
		checkState();
	}
	sentNotifyTask();
	CONFIG.runInProgress = false;
}

function getQueryParams(str) {
 let result = {};
 let params = str.split('&');
 params.forEach(function(param) 
 {
	 let paramParts = param.split('=');
	 result[paramParts[0]] = paramParts[1];
 });
 return result;
}

function fetchDataEndpoint(req, res) {
	let read = false;
	params = getQueryParams(req.query)
	if (params.sw0) {
		let state = (params['sw0'] === "true");
		if (TANK.switches[0].state != state) {
 			console.log("Requested ", TANK.switches[0].name, ": ", state);
			setSwitchState(0, state);
			read = true;
		}
	}
	if (params.sw1) {
		let state = (params['sw1'] === "true");
		if (TANK.switches[1].state != state) {
 			console.log("Requested ", TANK.switches[0].name, ": ",  state);    
					 setSwitchState(1, state);
			 		 read = true;
		}        
	}
	if (read) {
		readStates();   
	}
	res.code = 200;
	res.headers = {"Content-Type": "application/json"}
	let levelPcnt = (TANK.level.current - TANK.level.min)/TANK.level.pcnt;
	let jres = { sw0: TANK.switches[0].state, 
							 sw1: TANK.switches[1].state, 
							 level: TANK.level.current,
				 			 fillRequest: TANK.fillRequest
	};
	res.body = JSON.stringify(jres)
	res.send();
}

//init the script
function init() {
	TANK.level.pcnt = (TANK.level.max - TANK.level.min)/100;
	HTTPServer.registerEndpoint('fetchData', fetchDataEndpoint);
	//start the timer
	Timer.set(CONFIG.scanInterval_ms, true, tankRun);
	
	//Read sensor data at start
	tankRun();
}

init();
