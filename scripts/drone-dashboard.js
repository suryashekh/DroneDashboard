// MQTT client setup
var client = new Paho.MQTT.Client("127.0.0.1", 9001, "DroneControlDashboard");

client.onConnectionLost = onConnectionLost;
client.onMessageArrived = onMessageArrived;

client.connect({onSuccess:onConnect});

let baseStationCoordinates = null;


function onConnect() {
    console.log("Connected to MQTT broker");
    client.subscribe("drone/+/status");
    client.subscribe("drone/+/telemetry");
    client.subscribe("drone/+/status_messages"); 
    const rtkHandler = new RTKBaseHandler(client);
}

function promptBaseStationCoordinates() {
    return new Promise((resolve, reject) => {
        const latLongHTML = `
            <div class="mb-4">
    <label class="block text-gray-700 text-sm font-bold mb-2">Base Station Latitude (°N):</label>
    <input type="number" id="baseLat" step="any" min="6.5546" max="35.6745" 
           placeholder="Between 6.5546° and 35.6745°"
           class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" 
           required>
</div>
<div class="mb-4">
    <label class="block text-gray-700 text-sm font-bold mb-2">Base Station Longitude (°E):</label>
    <input type="number" id="baseLong" step="any" min="68.1113" max="97.395"
           placeholder="Between 68.1113° and 97.395°"
           class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" 
           required>
</div>
        `;

        const dialog = document.createElement('dialog');
        dialog.className = 'p-6 rounded-lg shadow-xl';
        dialog.innerHTML = `
            <form method="dialog" class="space-y-4">
                <h2 class="text-xl font-bold mb-4">Enter Base Station Coordinates</h2>
                ${latLongHTML}
                <div class="flex justify-end space-x-2">
                    <button type="submit" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                        Confirm
                    </button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);
        dialog.showModal();

        dialog.querySelector('form').addEventListener('submit', (e) => {
            e.preventDefault();
            const lat = parseFloat(document.getElementById('baseLat').value);
            const long = parseFloat(document.getElementById('baseLong').value);

            if (isNaN(lat) || isNaN(long)) {
                alert('Please enter valid coordinates');
                return;
            }

            baseStationCoordinates = { lat, long };
            console.log('Base station coordinates set:', baseStationCoordinates);
            dialog.close();
            document.body.removeChild(dialog);
            resolve();
        });

        dialog.addEventListener('cancel', () => {
            document.body.removeChild(dialog);
            reject(new Error('Base station coordinate entry cancelled'));
        });
    });
}

// Coordinate conversion functions
function metersToLatLong(x, y, baseCoords) {
    const EARTH_RADIUS = 6378137.0; // Earth's radius in meters
    
    // Convert meters to degrees
    const latChange = (y / EARTH_RADIUS) * (180 / Math.PI);
    const longChange = (x / (EARTH_RADIUS * Math.cos(baseCoords.lat * Math.PI / 180))) * (180 / Math.PI);
    
    return {
        lat: baseCoords.lat + latChange,
        long: baseCoords.long + longChange
    };
}

function convertWaypoints(waypoints, baseCoords) {
    return waypoints.map(waypoint => {
        // Debug log each waypoint before conversion
        console.log('Converting waypoint:', waypoint);
        
        const converted = metersToLatLong(waypoint.x, waypoint.y, baseCoords);
        
        // Debug log conversion result
        console.log('Conversion result:', converted);
        
        return {
            time: waypoint.time,
            lat: converted.lat,
            lon: converted.long,
            alt: waypoint.z
        };
    });
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
        // console.log("1)status topic:", payload);
        updateDroneStatus(topic, payload);
    } else if (topic.includes('/telemetry')) {
        // console.log("2)telemetry topic:", payload);
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
            const formattedDate = date.toLocaleString('en-IN', {
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

    // Get the title element
    const titleElement = droneCard.querySelector('h3');

    // Check for mission upload status
    if (payload.status === "waypoint mission uploaded successfully") {
        if (!titleElement.textContent.includes("(mission uploaded)")) {
            titleElement.innerHTML = `Drone ${droneId} <span><i>(mission uploaded)</i></span>`;
        }
    }
    
    
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
    
    // Format accuracy values with proper units
    const formatAccuracy = (value) => {
        return typeof value === 'number' ? `${value.toFixed(2)}m` : 'N/A';
    };
    console.log(payload);
    telemetryElement.innerHTML = `
        <div class="grid grid-cols-2 gap-4">
            <!-- Left Column - Original Status -->
            <div>
                <h4 class="font-semibold mb-2">Status Info</h4>
                <p>Altitude: ${payload.altitude.toFixed(2)} m</p>
                <p>Battery: ${payload.battery.toFixed(2)} V</p>
                <p>GPS: ${payload.gps_fix} (Sats: ${payload.satellites_visible || 'N/A'})</p>
                <p>Mode: ${payload.mode}</p>
                <p>Time: ${formattedTimestamp}</p>
            </div>
            
            <!-- Right Column - Position Data -->
            <div>
                <h4 class="font-semibold mb-2">Position Accuracy</h4>
            <!-- <p>Estimated: ${formatAccuracy(payload.accuracy?.estimated)}</p> -->
                <p>Latitude: ${payload.latitude}</p>
                <p>Longitude: ${payload.longitude}</p>
                <p>Horizontal: ${formatAccuracy(payload.accuracy?.horizontal)}</p>
                <p>Vertical: ${formatAccuracy(payload.accuracy?.vertical)}</p>
                <p>RTCM Age: ${payload.accuracy?.rtcm_age?.toFixed(1) || 'N/A'}s</p>
            </div>
        </div>
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

async function uploadMissions() {
    const fileInput = document.getElementById("jsonFile");
    const firstDroneId = parseInt(document.getElementById("firstDroneId").value);
    const lastDroneId = parseInt(document.getElementById("lastDroneId").value);

    if (!fileInput.files.length) {
        alert("Please select mission files first.");
        return;
    }

    // Convert FileList to Array and create a map of drone IDs to their files
    const fileMap = new Map();
    Array.from(fileInput.files).forEach(file => {
        const droneId = parseInt(file.name.split('.')[0]);
        if (!isNaN(droneId)) {
            fileMap.set(droneId, file);
        }
    });

    // Validate that we have files for all drones in range
    for (let droneId = firstDroneId; droneId <= lastDroneId; droneId++) {
        if (!fileMap.has(droneId)) {
            alert(`Missing mission file for drone ${droneId}`);
            return;
        }
    }

    try {
        // Get base station coordinates once for all conversions
        await promptBaseStationCoordinates();

        // Process each drone's mission file
        for (let droneId = firstDroneId; droneId <= lastDroneId; droneId++) {
            const file = fileMap.get(droneId);
            console.log(`Processing mission for Drone ${droneId}: ${file.name}`);
            
            // Read and process file
            const missionData = await readFileAsync(file);
            const parsedMission = JSON.parse(missionData);
            
            if (!parsedMission.waypoints || !Array.isArray(parsedMission.waypoints)) {
                throw new Error(`Invalid format in ${file.name}: Expected waypoints array`);
            }

            // Clean and validate waypoints
            const cleanedWaypoints = parsedMission.waypoints.map((waypoint, index) => {
                const cleanWaypoint = {};
                Object.entries(waypoint).forEach(([key, value]) => {
                    const cleanKey = key.trim().toLowerCase();
                    if (cleanKey === 'time' || cleanKey === 'time ') {
                        cleanWaypoint.time = value;
                    } else if (cleanKey === 'x') {
                        cleanWaypoint.x = parseFloat(value);
                    } else if (cleanKey === 'y') {
                        cleanWaypoint.y = parseFloat(value);
                    } else if (cleanKey === 'z') {
                        cleanWaypoint.z = parseFloat(value);
                    }
                });

                if (!Object.keys(cleanWaypoint).length) {
                    throw new Error(`Invalid waypoint at index ${index} in ${file.name}`);
                }

                return cleanWaypoint;
            });

            // Convert coordinates
            const convertedWaypoints = convertWaypoints(cleanedWaypoints, baseStationCoordinates);
            
            // Prepare mission payload for this drone
            const finalMissionPayload = {
                drone_id: droneId.toString(),
                waypoints: convertedWaypoints,
                light_sequence: parsedMission.light_sequence
            };

            // Split and send mission in chunks
            const missionJson = JSON.stringify(finalMissionPayload);
            console.log(missionJson);
            const CHUNK_SIZE = 512;
            const totalSize = missionJson.length;
            const chunks = Math.ceil(totalSize / CHUNK_SIZE);

            console.log(`Splitting mission for Drone ${droneId} into ${chunks} chunks`);

            for (let i = 0; i < chunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, totalSize);
                const chunk = missionJson.slice(start, end);
                const isLightSequenceOnly = document.getElementById('lightSequenceOnly').checked;
                console.log(isLightSequenceOnly);
                const chunkObj = {
                    chunk: i,
                    totalChunks: chunks,
                    totalSize: totalSize,
                    data: chunk
                };

                const topic = `drone/${droneId}/mission`;
                console.log(`Uploading chunk ${i + 1}/${chunks} to ${topic}`);
                sendMQTTMessage(topic, {chunk : chunkObj, light_sequence_only : isLightSequenceOnly});
                
                // Add delay between chunks
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Add delay between drones
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        document.getElementById("status").innerHTML = 
            `Mission upload complete for drones ${firstDroneId} through ${lastDroneId}`;

    } catch (error) {
        console.error("Error processing missions:", error);
        document.getElementById("status").innerHTML = `Error: ${error.message}`;
    }
}

// Helper function to read file contents
function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}


function startMission() {
    const takeoffAltitude = document.getElementById('takeoffAltitude').value;
    const startTimeInput = document.getElementById('startTime').value;
    if (!takeoffAltitude || !startTimeInput) {
        alert("Please enter a takeoff altitude to start the mission.");
        return;
    }

    // Convert local time input to UTC
    const now = new Date();
    const [hours, minutes, seconds] = startTimeInput.split(':').map(Number);
    
    // Create date object with today's date and input time
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds);
    
    // Convert to UTC seconds since midnight
    const utcHours = targetDate.getUTCHours();
    const utcMinutes = targetDate.getUTCMinutes();
    const utcSeconds = targetDate.getUTCSeconds();
    const startTimeSeconds = utcHours * 3600 + utcMinutes * 60 + utcSeconds;
    
    console.log(`Local time: ${hours}:${minutes}:${seconds}`);
    console.log(`UTC time: ${utcHours}:${utcMinutes}:${utcSeconds}`);
    console.log(`Seconds since midnight UTC: ${startTimeSeconds}`);

    sendMQTTMessage(`drone/command`, {
        command: "start_mission",
        takeoffAltitude: parseFloat(takeoffAltitude),
        startTimeSeconds: startTimeSeconds
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

function cancelMission() {
    // Send cancel command to all drones
    sendMQTTMessage("drone/command", {
        command: "cancel_mission"
    });
}
// Function to initialize time sync for all drones
function initializeDroneTime() {
    const timestamp = BigInt(new Date().getTime()) * 1000n; // Convert to microseconds
    const payload = {
        command: "time_sync",
        timestamp: timestamp.toString()
    };
    
    // Send to all drones
    sendMQTTMessage("drone/command", payload);
    console.log("Time sync initialization sent to all drones");
}

document.addEventListener('DOMContentLoaded', function() {
    const lightSequenceToggle = document.getElementById('lightSequenceOnly');
    const uploadButton = document.getElementById('uploadButton');

    if (lightSequenceToggle && uploadButton) {  // Check if both elements exist
        lightSequenceToggle.addEventListener('change', function() {
            uploadButton.textContent = this.checked ? 'Upload Light Sequence' : 'Upload Missions';
        });
    } else {
        console.error('Could not find required elements:', {
            toggle: !!lightSequenceToggle,
            button: !!uploadButton
        });
    }
});