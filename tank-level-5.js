// SPDX-License-Identifier: GPL-2.0-or-later
//
// Copyright (C) 2024, Tzvetomir Stoyanov <tz.stoyanov@gmail.com>
//

let CFG = {
	scanInterval_ms: 100,   // miliseconds: read the sensors on every 100 ms
	calcInterval: 10,      // times * scanInterval_ms: check the tanks state
	samplesCount: 10,	 // count: Number of samples to collect on each measurement 
	callTimeout: 2,	// seconds: Time to wait for a responce on a remote call
	uptime_ms: 0,
	scan_run: 0,
	runInProgress: false,
	errCountThreshold: 20,
 // WebHook notifications
 notify: { delaySec: 120, // seconds: minimal interval between notifications
					 filter: 5, // Max number of notification within notifyDelaySec interval
					 queueCount: 15, // Max unsend notifications
					 inProgress: false,
					 url: 'http://192.168.10.137:8123/api/webhook/',  // URL for the webhook notifications
					 whId: '-0vJZOQ7D9NCj3Iz3p63uSMAI',  // ID of the webhook notification
				},
};

// Local Shelly, controling tank 5000L
let TANK = {
	name: "Tank 5000L",
	controlTankFill: true,
	controlTankHydro: true,
	priority: 1,
	fillInProgress: false,
	fillRequestUser: false,
	fill_ms: 0,
	fetchSwInProgerss: false,
	fetchSwIdx: 0,
	notify: { lastSent_ms: 0, queuePushIdx: 0, send: 0,
	queuePopIdx: 0, queue: new Array(CFG.notify.queueCount)},
	switches: [
	 {id: 0, name: "pump", state: false, desiredState: false, control: true},
	 {id: 1, name: "hydro 5000L", state: false, desiredState: false, control: false}],
	valvesFillState: false, // State of the valves to fill this tank
	hydroOnState: false, // State of the hydro swtich to run the hydrophore
	voltmeter: {id: 100, samples: new Array(CFG.samplesCount), idx: -1, fetchInProgerss: false},
	level: {max: 5.63, min: 2.0, current: 0, pcnt: 0},
	pumpThreshold: {low: 4.0, high: 5.2}, // Water level threshold for stopping and satrting the pump
	hydroThreshold: {low: 2.5, high: 3.0}, // Water level threshold for stopping and satrting the hydrophore
	valves: {shelly_id: 0, sw_id: 0, name: "valves", control: true},
	fetchRemInProgerss: false,
	fetchRemIdx: 0,  
	shellyRemote: [
	{ id: 0, name: "Tank 6000L", url: 'http://192.168.10.227/script/2/fetchData', 
			valvesFillState: true, fillRequest: false, fillRequestUser: false,
			currentLevel: 0.0, fillInProgress: false, err_count: 0,  err_ms: 0, fill_ms: 0,
			notify: { lastSent_ms: 0, queuePushIdx: 0, send: 0,
								queuePopIdx: 0, queue: new Array(CFG.notify.queueCount)},      
			switches: [ {id: 0, state: false, control: true, desiredState: false}, 
	 								{id: 1, state: false, control: false, desiredState: false} ],
		}],
};

function sentNotify(str) {
	console.log("Notify: ", str);
	TANK.notify.queue[TANK.notify.queuePushIdx] = str;
	TANK.notify.queuePushIdx++;
	if (TANK.notify.queuePushIdx >= CFG.notify.queueCount) {
		 TANK.notify.queuePushIdx = 0;
	}
}

function sentNotifyTask() {
	if (CFG.notify.inProgress) { return; }
	if (TANK.notify.queue[TANK.notify.queuePopIdx] == undefined) {
		return;
	}
	if ((CFG.uptime_ms - TANK.notify.lastSent_ms) < (CFG.notify.delaySec*1000)) {
			if (TANK.notify.send >= CFG.notify.filter) { return; }
	} else {
		TANK.notify.send = 0;
	}

	CFG.notify.inProgress = true;
	str = TANK.notify.queue[TANK.notify.queuePopIdx];
	TANK.notify.queue[TANK.notify.queuePopIdx] = undefined;
	TANK.notify.queuePopIdx++;
	if (TANK.notify.queuePopIdx >= CFG.notify.queueCount) {
		TANK.notify.queuePopIdx = 0;
	}
	TANK.notify.send++;
	Shelly.call("http.post",
	 { url: CFG.notify.url+CFG.notify.whId,  content_type: "application/json", 
		 timeout: CFG.callTimeout, body:{message: str}},
		 function (result, err_code, err_message) {
									if (err_code === 0) { TANK.notify.lastSent_ms = CFG.uptime_ms; }
									CFG.notify.inProgress = false;
		 });
}

function setSwitchState(sw_id, state) {
	if (!TANK.switches[sw_id].control) { return; }
	Shelly.call("Switch.Set", {id: TANK.switches[sw_id].id, on: state});
	TANK.switches[sw_id].desiredState = state;
	console.log(TANK.switches[sw_id].name, " -> ", state);  
	return (TANK.switches[sw_id].state === TANK.switches[sw_id].desiredState);
}

function setPumpState(state) {
	if (state != TANK.switches[0].desiredState) {
		if (state) {
			sentNotify("The pump has been started.");
		} else {
			sentNotify("The pump has been stopped.");
		}
	}
	return setSwitchState(0, state);
}

function setValvesState(state) {
	if (!TANK.valves.control) { return true; }
	if (state != TANK.shellyRemote[TANK.valves.shelly_id].switches[TANK.valves.sw_id].desiredState) {
		if (state) {
			sentNotify("The valves has been turned on.");
		} else {
			sentNotify("The valves has been turned off.");
		}
	}
	TANK.shellyRemote[TANK.valves.shelly_id].switches[TANK.valves.sw_id].desiredState = state;
	callShellyRemote(TANK.valves.shelly_id);
	return (TANK.shellyRemote[TANK.valves.shelly_id].switches[TANK.valves.sw_id].state == state);
}

function checkSwitchState() {
	let mismatch = false;
	for (let i = 0; i < TANK.switches.length; i++) {
		if (!TANK.switches[i].control) { continue; }
		if (TANK.switches[i].state != TANK.switches[i].desiredState) {
			console.log(TANK.switches[i].name + ' mismatch: ' + TANK.switches[i].desiredState);
			setSwitchState(i, TANK.switches[i].desiredState);
			mismatch = true;
		}
	}
	if (TANK.valves.control && 
			TANK.shellyRemote[TANK.valves.shelly_id].switches[TANK.valves.sw_id].desiredState != TANK.shellyRemote[TANK.valves.shelly_id].switches[TANK.valves.sw_id].state) {
		let missLog = TANK.valves.name + ' mismatch: ' + TANK.shellyRemote[TANK.valves.shelly_id].switches[TANK.valves.sw_id].desiredState;
		setValvesState(TANK.shellyRemote[TANK.valves.shelly_id].switches[TANK.valves.sw_id].desiredState);
		console.log(missLog);
		mismatch = true;
	}
	return mismatch;
}

function checkFillState() {
	let fillStop = false;
	if (TANK.controlTankFill && TANK.level.current >= TANK.pumpThreshold.high) {
		if (TANK.fillInProgress) {
			setPumpState(false);
			setValvesState(false);
			let levelPcnt = (TANK.level.current - TANK.level.min)/TANK.level.pcnt;
			let ftime = Math.floor((CFG.uptime_ms - TANK.fill_ms) / (60000));
			sentNotify(TANK.name + " is full (" + levelPcnt.toFixed(2) + "%), took " + ftime + "min.");
			TANK.fillInProgress = false;
			TANK.fill_ms = 0;
			fillStop = true;
		}
	}
	if (!TANK.shellyRemote[0].fillRequest && TANK.shellyRemote[0].fillInProgress) {
		setPumpState(false);
		setValvesState(false);
		let levelPcnt = (TANK.shellyRemote[0].level.current - TANK.shellyRemote[0].level.min)/TANK.shellyRemote[0].level.pcnt;
		let ftime = Math.floor((CFG.uptime_ms - TANK.shellyRemote[0].fill_ms) / (60000));
		sentNotify(TANK.shellyRemote[0].name + " is full (" + levelPcnt.toFixed(2) + "%), took " + ftime + "min.");
		TANK.shellyRemote[0].fillInProgress = false;
		TANK.shellyRemote[0].fill_ms = 0;
 		fillStop = true;
	}
 return fillStop;
}

function checkEmptyState() {
	if (TANK.controlTankFill) {
		if (TANK.fillInProgress) {
			TANK.fillRequestUser = false;
			return true;
		}
		if (TANK.level.current <= TANK.pumpThreshold.low || TANK.fillRequestUser) {
			if (!setValvesState(TANK.valvesFillState)) { return true; }
			let levelPcnt = (TANK.level.current - TANK.level.min)/TANK.level.pcnt;
			setPumpState(true);
			TANK.fillInProgress = true;
			TANK.fillRequestUser = false;
			TANK.fill_ms = CFG.uptime_ms;
			sentNotify("Filling " + TANK.name + " now ... (" + levelPcnt.toFixed(2) + "%).");
			return true;
		}	
	}
	for (let i = 0; i < TANK.shellyRemote.length; i++) { 
		if (TANK.shellyRemote[i].fillInProgress) {
			TANK.shellyRemote[i].fillRequestUser = false
			return true;
		}
		if (TANK.shellyRemote[i].fillRequest || TANK.shellyRemote[i].fillRequestUser) {
			 if (!setValvesState(TANK.shellyRemote[i].valvesFillState)) { return true;  }
			 setPumpState(true);
			 TANK.shellyRemote[i].fillInProgress = true;
			 TANK.shellyRemote[i].fill_ms = CFG.uptime_ms;
			 TANK.shellyRemote[i].fillRequestUser = false;
			 sentNotify("Filling " + TANK.shellyRemote[i].name + " now.");
			 return true;
		}
 }
 return false;
}

function checkHydroState() {
		if (TANK.controlTankHydro !== true) { return; }
		if (TANK.level.current >= TANK.hydroThreshold.high) {
			setSwitchState(1, TANK.hydroOnState);
		}
		if (TANK.level.current <= TANK.hydroThreshold.low) {
			setSwitchState(1, !TANK.hydroOnState);
		}
}
function checkState() {
	if (checkSwitchState()) { return; }
	checkHydroState();  
	if (checkFillState()) { return; }
	checkEmptyState();
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
	if (TANK.voltmeter.fetchInProgerss) { return; }
	TANK.voltmeter.fetchInProgerss = true;
	const voltmeter = Shelly.getComponentStatus(
		"voltmeter:" + JSON.stringify(TANK.voltmeter.id)
	);
	if (typeof voltmeter == undefined || voltmeter === null) {
		console.log("Can't find the voltmeter component");
		TANK.voltmeter.fetchInProgerss = false;
		return undefined;
	}
	const voltage = voltmeter["voltage"];
	if (typeof voltage !== "number") {
		console.log("can't read the voltage or it is NaN");
		TANK.voltmeter.fetchInProgerss = false;
		return undefined;
	}
	calcVoltage(voltage);
	TANK.voltmeter.fetchInProgerss = false;
}

function readSwState(sw_id) {
 if (TANK.fetchSwInProgerss) { return false; }
 TANK.fetchSwInProgerss = true;
 Shelly.call("Switch.GetStatus",
	{ id: TANK.switches[sw_id].id },
	function (result, err_code, err_message) {
		if (err_code === 0 && result != undefined) {
		 if (result.id === TANK.switches[sw_id].id) { 
			 TANK.switches[sw_id].state = result.output;
		 }
		} else {
			if (err_message) {
			 sentNotify(TANK.switches[sw_id].name + ": " + err_message);
		}
	 }
	 TANK.fetchSwInProgerss = false;
	 });
	 return true;
}

function callShellyRemote(id) {
	if (TANK.fetchRemInProgerss) { return false; }
	TANK.fetchRemInProgerss = true;
	let body = "";
	for (let i = 0; i < TANK.shellyRemote[id].switches.length; i++) {
		if (!TANK.shellyRemote[id].switches[i].control) { continue; }
		if (body=="") { body = "?"; }
		else { body += "&"; }
		body += "sw" + TANK.shellyRemote[id].switches[i].id + "=" + TANK.shellyRemote[id].switches[i].desiredState;
	}
	Shelly.call("http.get",
	 { url: TANK.shellyRemote[id].url + body, timeout: CFG.callTimeout },
	 function (result, err_code, err_message) {
		if (err_code === 0) {
			try {
			 let val = JSON.parse(result.body);
			 TANK.shellyRemote[id].switches[0].state = val.sw0;
			 TANK.shellyRemote[id].switches[1].state = val.sw1;
			 TANK.shellyRemote[id].currentLevel = val.level;
			 TANK.shellyRemote[id].fillRequest = val.fillRequest;
			 if (TANK.shellyRemote[id].err_count >= CFG.errCountThreshold ) {
				 let err_s = (CFG.uptime_ms - TANK.shellyRemote[id].err_ms) / 1000;
				 sentNotify("Connection to " + TANK.shellyRemote[id].name + " restored in " + err_s + "seconds");
			 }
			 TANK.shellyRemote[id].err_count = 0;
			 TANK.shellyRemote[id].err_ms = 0;
		 } catch (e) { 
			if (TANK.shellyRemote[id].err_count == 0 ) {
				TANK.shellyRemote[id].err_ms = CFG.uptime_ms;
			}
			TANK.shellyRemote[id].err_count++;
			if (TANK.shellyRemote[id].err_count == CFG.errCountThreshold ) {
			 sentNotify("Broken connection to " + TANK.shellyRemote[id].name + ": invalid reply.");
			}
		 }
		} else {
			if (TANK.shellyRemote[id].err_count == 0 ) {
				TANK.shellyRemote[id].err_ms = CFG.uptime_ms;
			}
			TANK.shellyRemote[id].err_count++;
			if (TANK.shellyRemote[id].err_count == CFG.errCountThreshold ) {
			 sentNotify("Lost connection to " + TANK.shellyRemote[id].name + ": " + err_message + ".");
			}
		}
	TANK.fetchRemInProgerss= false;
	});
	return true;
}
function readStates() {
	 if (callShellyRemote(TANK.fetchRemIdx)) {
		 TANK.fetchRemIdx++;
		 if (TANK.fetchRemIdx >= TANK.shellyRemote.length) {
			 TANK.fetchRemIdx = 0;
		 }
	 }
	 if (readSwState(TANK.fetchSwIdx)) {
		 TANK.fetchSwIdx++;
		 if (TANK.fetchSwIdx >= TANK.switches.length) {
			 TANK.fetchSwIdx = 0;
		 }
	 }
}
function tankRun() {
	CFG.uptime_ms += CFG.scanInterval_ms;
	if (CFG.runInProgress) { return; }
	CFG.runInProgress = true;
	CFG.scan_run++;
	readSensors();
	readStates();
	if (CFG.scan_run >= CFG.calcInterval) {
		CFG.scan_run = 0;
		checkState();
	}
	sentNotifyTask();
	CFG.runInProgress = false;
}

// http://<dev ip>/script/1/user_command?fill=<5/6>
function onUserCommand(request, response)
{
	code = 400;
	body = 'Bad Request'
	let cmd = request.query.split("=");
	if (cmd[0] === 'fill') {
    if (cmd[1] == 5) {
			TANK.fillRequestUser = true;
			body = "0";
			code = 200;
		} else if (cmd[1] == 6 ) {
			TANK.shellyRemote[0].fillRequestUser = true;
			body = "0";
			code = 200;
		}
	}
	response.code = code;
	response.body = body;
	response.send();
}

//init the script
function init() {
	HTTPServer.registerEndpoint("user_command", onUserCommand);
	TANK.level.pcnt = (TANK.level.max - TANK.level.min)/100;
	//start the timer
	Timer.set(CFG.scanInterval_ms, true, tankRun);
		//Read sensor data at start
	tankRun();
}
init();
