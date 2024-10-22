class RTKBaseHandler {
    constructor(mqttClient) {
        this.port = null;
        this.reader = null;
        this.mqttClient = mqttClient;
        this.bytesReceived = 0;
        this.isConnected = false;
        this.initializeUI();
    }

    initializeUI() {
        this.portSelect = document.getElementById('portSelect');
        this.connectButton = document.getElementById('connectRTKBase');
        this.disconnectButton = document.getElementById('disconnectRTKBase');
        this.refreshButton = document.getElementById('refreshPorts');
        this.statusSpan = document.getElementById('connectionStatus');
        this.bytesSpan = document.getElementById('bytesReceived');
        this.lastUpdateSpan = document.getElementById('lastUpdate');

        this.connectButton.addEventListener('click', () => this.connect());
        this.disconnectButton.addEventListener('click', () => this.disconnect());
        this.refreshButton.addEventListener('click', () => this.listPorts());

        // Initial port list
        this.listPorts();
    }

    async listPorts() {
        if (!navigator.serial) {
            alert('Web Serial API not supported in this browser. Please use Chrome or Edge.');
            return;
        }

        try {
            const ports = await navigator.serial.getPorts();
            // Request user permission to access any new ports
            await navigator.serial.requestPort({ filters: [] })
                .then(port => {
                    if (!ports.includes(port)) {
                        ports.push(port);
                    }
                })
                .catch(e => {
                    console.log('No new port selected');
                });

            // Clear existing options
            this.portSelect.innerHTML = '<option value="">Select a port</option>';

            // Add available ports
            for (let i = 0; i < ports.length; i++) {
                const port = ports[i];
                const info = port.getInfo();
                const option = document.createElement('option');
                option.value = i;
                option.text = `${info.usbVendorId ? 'VID: ' + info.usbVendorId + ' ' : ''}${info.usbProductId ? 'PID: ' + info.usbProductId : 'Port ' + i}`;
                this.portSelect.appendChild(option);
            }
        } catch (err) {
            console.error('Error listing ports:', err);
            this.updateStatus('Error listing ports');
        }
    }

    async connect() {
        if (this.isConnected) return;

        try {
            const ports = await navigator.serial.getPorts();
            const selectedIndex = this.portSelect.value;
            if (!selectedIndex) {
                alert('Please select a port');
                return;
            }

            this.port = ports[selectedIndex];
            await this.port.open({
                baudRate: 57600,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
                flowControl: "none"
            });

            this.reader = this.port.readable.getReader();
            this.isConnected = true;
            this.updateUI(true);
            this.startReading();
        } catch (err) {
            console.error('Failed to connect:', err);
            this.updateStatus('Connection failed');
        }
    }

    async startReading() {
        const RTCM_PREAMBLE = 0xD3;
        let buffer = [];
        let inMessage = false;
        let messageLength = 0;
        let currentIndex = 0;

        while (this.isConnected) {
            try {
                const { value, done } = await this.reader.read();
                if (done) break;

                this.bytesReceived += value.length;
                this.updateBytesReceived();

                // Process each byte
                for (const byte of value) {
                    if (!inMessage) {
                        if (byte === RTCM_PREAMBLE) {
                            buffer = [byte];
                            inMessage = true;
                            currentIndex = 1;
                        }
                    } else {
                        buffer.push(byte);
                        currentIndex++;

                        if (currentIndex === 3) {
                            // Extract message length from bytes 2 and 3
                            messageLength = ((buffer[1] << 8) + buffer[2]) & 0x3FF;
                            messageLength += 6; // Add 3 bytes header and 3 bytes CRC
                        }

                        if (currentIndex === messageLength) {
                            // We have a complete message
                            this.sendRTCMMessage(buffer);
                            inMessage = false;
                            buffer = [];
                        }
                    }
                }
            } catch (err) {
                console.error('Error reading:', err);
                break;
            }
        }

        this.disconnect();
    }

    sendRTCMMessage(rtcmData) {
        console.log("sending rtcm data",rtcmData);
        if (this.mqttClient && this.mqttClient.isConnected()) {
            // Send as MAVLink GPS_RTCM_DATA message
            const message = new Paho.MQTT.Message(JSON.stringify({
                type: 'rtcm',
                data: Array.from(rtcmData)
            }));
            message.destinationName = "drone/rtcm";
            this.mqttClient.send(message);
            this.updateLastUpdate();
        }
    }

    async disconnect() {
        this.isConnected = false;
        if (this.reader) {
            await this.reader.cancel();
            this.reader = null;
        }
        if (this.port) {
            await this.port.close();
            this.port = null;
        }
        this.updateUI(false);
    }

    updateUI(connected) {
        this.connectButton.disabled = connected;
        this.disconnectButton.disabled = !connected;
        this.portSelect.disabled = connected;
        this.statusSpan.textContent = connected ? 'Connected' : 'Not Connected';
        this.statusSpan.style.color = connected ? 'green' : 'red';
    }

    updateStatus(status) {
        this.statusSpan.textContent = status;
    }

    updateBytesReceived() {
        this.bytesSpan.textContent = this.bytesReceived.toString();
    }

    updateLastUpdate() {
        this.lastUpdateSpan.textContent = new Date().toLocaleTimeString();
    }
}