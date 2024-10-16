// MQTT client setup
var client = new Paho.MQTT.Client("192.168.0.18", 9001, "DroneControlDashboard");

client.onConnectionLost = onConnectionLost;
client.onMessageArrived = onMessageArrived;

client.connect({onSuccess:onConnect});

function onConnect() {
    console.log("Connected to MQTT broker");
    client.subscribe("drone/+/status");
    client.subscribe("drone/+/telemetry");
}

function onConnectionLost(responseObject) {
    if (responseObject.errorCode !== 0) {
        console.log("Connection lost: " + responseObject.errorMessage);
    }
}

function onMessageArrived(message) {
    const topic = message.destinationName;
    const payload = JSON.parse(message.payloadString);

    if (topic.includes('/status')) {
        updateDroneStatus(topic, payload);
    } else if (topic.includes('/telemetry')) {
        updateDroneTelemetry(topic, payload);
    }
}

function updateDroneStatus(topic, payload) {
    const droneId = topic.split('/')[1];
    let droneCard = document.getElementById(`drone-${droneId}`);
    
    if (!droneCard) {
        droneCard = createDroneCard(droneId);
    }

    const statusElement = droneCard.querySelector('.status');
    statusElement.textContent = `Status: ${payload.status}`;
    
    droneCard.classList.remove('connected', 'disconnected');
    droneCard.classList.add(payload.status === 'connected' ? 'connected' : 'disconnected');
}

function updateDroneTelemetry(topic, payload) {
    const droneId = topic.split('/')[1];
    let droneCard = document.getElementById(`drone-${droneId}`);
    
    if (!droneCard) {
        droneCard = createDroneCard(droneId);
    }

    const telemetryElement = droneCard.querySelector('.telemetry');
    telemetryElement.innerHTML = `
        <p>Altitude: ${payload.altitude.toFixed(2)} m</p>
        <p>Battery: ${payload.battery.toFixed(2)} V</p>
        <p>Mode: ${payload.mode}</p>
    `;
}

function createDroneCard(droneId) {
    const droneCards = document.getElementById('droneCards');
    const card = document.createElement('div');
    card.id = `drone-${droneId}`;
    card.className = 'drone-card bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4';
    card.innerHTML = `
        <h3 class="text-lg font-semibold mb-2">Drone ${droneId}</h3>
        <div class="status mb-2">Status: Unknown</div>
        <div class="telemetry mb-4"></div>
        <button onclick="landDrone('${droneId}')" class="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
            Land Drone ${droneId}
        </button>
    `;
    droneCards.appendChild(card);
    return card;
}

function sendMQTTMessage(topic, payload) {
    console.log(`Sending MQTT message to topic: ${topic}`);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    var message = new Paho.MQTT.Message(JSON.stringify(payload));
    message.destinationName = topic;
    client.send(message);
}

function changeMode(mode) {
    sendMQTTMessage("drone/command", {command: "change_mode", mode: mode});
}

function armDrone() {
    sendMQTTMessage("drone/command", {command: "arm"});
}

function takeoff() {
    const altitude = document.getElementById('takeoffAltitude').value;
    sendMQTTMessage("drone/command", {command: "takeoff", altitude: parseFloat(altitude)});
}

function land() {
    sendMQTTMessage("drone/command", {command: "change_mode", mode: "land"});
}

function landDrone(droneId) {
    sendMQTTMessage(`drone/${droneId}/command`, {command: "change_mode", mode: "land"});
}

function uploadMissions() {
    const file = document.getElementById("jsonFile").files[0];
    const firstDroneId = document.getElementById("firstDroneId").value;
    const lastDroneId = document.getElementById("lastDroneId").value;

    if (!file) {
        alert("Please select a mission file first.");
        return;
    }

    const drones = getDroneRange(firstDroneId, lastDroneId);

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const missionData = JSON.parse(e.target.result);
            drones.forEach(droneId => {
                const topic = `drone/${droneId}/mission`;
                console.log(`Uploading mission to topic: ${topic}`);
                console.log('Mission data:', JSON.stringify(missionData, null, 2));
                sendMQTTMessage(topic, missionData);
                console.log(`Mission uploaded for ${droneId}`);
            });
            document.getElementById("status").innerHTML = `Missions uploaded for ${drones.join(", ")}`;
        } catch (error) {
            console.error("Error parsing JSON:", error);
            document.getElementById("status").innerHTML = "Error parsing mission file. Check console for details.";
        }
    };
    reader.readAsText(file);
}

function getDroneRange(first, last) {
    if (!first || !last) {
        return [];
    }

    const start = parseInt(first.replace(/\D/g, '')) || 0;
    const end = parseInt(last.replace(/\D/g, '')) || 0;
    const prefix = first.replace(/\d/g, '');
    
    if (start === 0 || end === 0) {
        return [first]; // Return single drone ID if parsing fails
    }

    const drones = [];
    for (let i = start; i <= end; i++) {
        drones.push(`${prefix}${i}`);
    }
    return drones;
}