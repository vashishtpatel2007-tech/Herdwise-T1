import fs from 'fs';

let collar = fs.readFileSync('firmware/collar/collar.ino', 'utf-8');

// 1. Change VIBRATION_PIN
collar = collar.replace('#define VIBRATION_PIN 6', '#define VIBRATION_PIN 4');

// 2. Add GSM headers and setup at the top
const gsmHeaders = `
// --- LEADER COAR GSM INCLUDES ---
#define TINY_GSM_MODEM_EC200U
#include <TinyGsmClient.h>
#include <ArduinoHttpClient.h>

#define GSM_RX 7
#define GSM_TX 6
#define GSM_BAUD 115200

HardwareSerial SerialGSM(1);
TinyGsm modem(SerialGSM);
TinyGsmClientSecure clientSecure(modem);
HttpClient http(clientSecure, "YOUR_PROJECT.supabase.co", 443);
String anonKey = "YOUR_ANON_KEY";

// Follower IDs
const String followers[] = {"COLLAR_002", "COLLAR_003"};
const int numFollowers = 2;
int currentFollowerIdx = 0;
unsigned long lastPollTime = 0;
// --------------------------------
`;

collar = collar.replace('#include <Wire.h>', '#include <Wire.h>\n' + gsmHeaders);

// 3. Add GSM Initialization to setup()
const setupGSM = `
  Serial.println("Initializing GSM...");
  SerialGSM.begin(GSM_BAUD, SERIAL_8N1, GSM_RX, GSM_TX);
  if (!modem.restart()) {
    Serial.println("GSM restart failed!");
  } else {
    Serial.println("Waiting for network...");
    if (modem.waitForNetwork()) {
      modem.gprsConnect("airtelgprs.com", "", "");
      Serial.println("GPRS Connected.");
    }
  }
`;
collar = collar.replace('Serial.println("Initialization complete. Entering loop...");', setupGSM + '\n  Serial.println("Initialization complete. Entering loop...");');

// 4. Modify Loop to include Polling Follower
const leaderLoop = `
void loop() {
  // 1. Self Tracking (Run original prediction and telemetry)
  if (millis() - lastGpsUpdate >= GPS_INTERVAL_MS) {
    updateGPS();
    lastGpsUpdate = millis();
  }
  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    runPrediction();
    sendTelemetry(); // We will redefine this below to use GSM
    lastTelemetryTime = millis();
  }
  
  // 2. Poll Followers via LoRa
  if (millis() - lastPollTime >= 5000) { // Poll a follower every 5s
    String target = followers[currentFollowerIdx];
    String pollCmd = "CMD|POLL|" + target;
    Serial.println("Polling Follower: " + target);
    radio.transmit(pollCmd);
    
    // Wait for response
    String response = "";
    int state = radio.receive(response, 3000, 0); // 3s timeout
    if (state == RADIOLIB_ERR_NONE) {
      Serial.println("Received from follower: " + response);
      if (response.startsWith("TEL|")) {
         forwardTelemetryToCloud(response);
      }
    } else {
      Serial.println("Follower timeout.");
    }
    
    currentFollowerIdx = (currentFollowerIdx + 1) % numFollowers;
    lastPollTime = millis();
  }
}

void forwardTelemetryToCloud(String loraPacket) {
  Serial.println("Forwarding to Cloud: " + loraPacket);
  // Implementation of parsing TEL|... to JSON and HTTP POST
}

void sendTelemetryGSM() {
  Serial.println("Sending LEADER telemetry to Cloud...");
  // HTTP POST for leader
}

// Rename original loop to loop_original so it is preserved but inactive
void loop_original() {
`;

collar = collar.replace('void loop() {', leaderLoop);

fs.writeFileSync('firmware/leader_collar/leader_collar.ino', collar);
console.log("Built leader_collar.ino");
