// MQTT client setup
var client = new Paho.MQTT.Client("192.168.0.18", 9001, "DroneControlDashboard");

client.onConnectionLost = onConnectionLost;
client.onMessageArrived = onMessageArrived;

client.connect({onSuccess:onConnect});

function onConnect() {
    console.log("Connected to MQTT broker");
    client.subscribe("drone/+/status");
    client.subscribe("drone/+/telemetry");
    client.subscribe("drone/+/status_messages"); 
    const rtkHandler = new RTKBaseHandler(client);
}

function onConnectionLost(responseObject) {
    if (responseObject.errorCode !== 0) {
        console.log("Connection lost: " + responseObject.errorMessage);
    }
}

function onMessageArrived(message) {
    const topic = message.destinationName; 
    console.log(topic) 
    let payload;
    try {
        payload = JSON.parse(message.payloadString);
    } catch (error) {
        console.error("Error parsing payload:", error);
        return;
    }

    if (topic.includes('/status') && !topic.includes('/status_messages')) {
        console.log("1)status topic:", payload);
        updateDroneStatus(topic, payload);
    } else if (topic.includes('/telemetry')) {
        console.log("2)telemetry topic:", payload);
        updateDroneTelemetry(topic, payload);
    } else if (topic.includes('/status_messages')) {
        updateStatusMessages(topic, payload);
    } else {
        console.log("Unhandled topic:", topic);
    }
}

function formatTimestamp(timestamp) {
    if (typeof timestamp === 'number') {
        try {
            // Convert to BigInt to handle large numbers
            const timestampBigInt = BigInt(Math.floor(timestamp));

            // Split into seconds and microseconds
            const seconds = Number(timestampBigInt / 1000000n);
            const microseconds = Number(timestampBigInt % 1000000n);

            // Create a Date object with the seconds
            const date = new Date(seconds * 1000);

            // Check if the date is valid
            if (isNaN(date.getTime())) {
                throw new Error('Invalid date');
            }

            // Format the date and time
            const formattedDate = date.toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            // Add microseconds to the formatted string
            return `${formattedDate}.${microseconds.toString().padStart(6, '0')}`;
        } catch (error) {
            console.error('Error formatting timestamp:', error);
            return `Error formatting: ${timestamp}`;
        }
    } else {
        // If timestamp is not a number, return it as is (e.g., "sync_failed" or "not_initialized")
        return timestamp;
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

function updateStatusMessages(topic, payload) {
    const droneId = topic.split('/')[1];
    let droneCard = document.getElementById(`drone-${droneId}`);
    
    if (!droneCard) {
        droneCard = createDroneCard(droneId);
    }

    const statusMessagesElement = droneCard.querySelector('.status-messages');
    if (!statusMessagesElement) {
        const messagesContainer = document.createElement('div');
        messagesContainer.className = 'status-messages mt-4 h-20 overflow-y-auto text-sm';
        droneCard.appendChild(messagesContainer);
    }

    const messageElement = document.createElement('div');
    messageElement.textContent = payload.message;
    statusMessagesElement.insertBefore(messageElement, statusMessagesElement.firstChild);

    // Keep only the last 100 messages
    while (statusMessagesElement.childNodes.length > 100) {
        statusMessagesElement.removeChild(statusMessagesElement.lastChild);
    }
}

function updateDroneTelemetry(topic, payload) {
    const droneId = topic.split('/')[1];
    let droneCard = document.getElementById(`drone-${droneId}`);
    
    
    if (!droneCard) {
        droneCard = createDroneCard(droneId);
    }
    
    droneCard.classList.remove('connected', 'disconnected');
    droneCard.classList.add('connected');

    const telemetryElement = droneCard.querySelector('.telemetry');
    const formattedTimestamp = formatTimestamp(payload.timestamp);
    telemetryElement.innerHTML = `
        <p>Altitude: ${payload.altitude.toFixed(2)} m</p>
        <p>Battery: ${payload.battery.toFixed(2)} V</p>
        <p>Mode: ${payload.mode}</p>
        <p>Onboard Time: ${formattedTimestamp}</p>
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
        <div class="status-messages mt-4 h-20 overflow-y-auto text-sm"></div>
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

function startMission() {
    const takeoffAltitude = document.getElementById('takeoffAltitude').value;
    if (!takeoffAltitude) {
        alert("Please enter a takeoff altitude.");
        return;
    }
    sendMQTTMessage(`drone/command`, {
        command: "start_mission",
        takeoffAltitude: parseFloat(takeoffAltitude)
    });
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