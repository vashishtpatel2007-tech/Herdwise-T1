/*
  ============================================================
  PAASHUGUARD
  BOARD B — GATEWAY
  FINAL PROTOTYPE BUILD
  ============================================================

  HARDWARE
    ESP32-S3
    SX1262 868 MHz

  PURPOSE
    - Wi-Fi gateway
    - Bidirectional LoRa with collar
    - Continuous collar telemetry polling
    - Live engineering telemetry dashboard
    - Boundary configuration relay
    - Road configuration relay
    - Future Supabase integration point

  ARCHITECTURE

        FARMER APP / PC
               |
             Wi-Fi
               |
               v
        +--------------+
        |   GATEWAY    |
        |   ESP32-S3   |
        |   SX1262     |
        +------+-------+
               |
              LoRa
               |
               v
        +--------------+
        |    COLLAR    |
        | GPS + IMU    |
        | ESP32 +      |
        | Prediction   |
        | Engine       |
        +--------------+

  LORA CONFIGURATION
    Frequency : 868 MHz
    SF        : 10
    Bandwidth : 125 kHz
    Coding    : 4/5
    Sync      : 0x34
    Power     : 14 dBm

  PROTOCOL

    Gateway -> Collar
      CMD|PING
      CMD|REQ_TELEMETRY
      CMD|SET_BOUNDARY|count|lat|lon|...
      CMD|SET_ROAD|index|id|risk|lat1|lon1|lat2|lon2
      CMD|CLEAR_BOUNDARY

    Collar -> Gateway
      ACK|PONG
      ACK|BOUNDARY_OK
      ACK|BOUNDARY_FAIL
      ACK|ROAD_OK
      ACK|ROAD_FAIL
      ACK|BOUNDARY_CLEARED

      TEL|seq|lat|lon|speed|heading|sat|accel|
      boundary|road|risk|type|state|action|
      buzzer|vibration|event

  IMPORTANT
    LoRa is half-duplex.

    The gateway requests telemetry.
    The collar calculates and responds.

    This prevents TX collisions.
  ============================================================
*/

#include <SPI.h>
#include <RadioLib.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <math.h>
#include <stdlib.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// ============================================================
// WIFI
// ============================================================

const char* WIFI_SSID = "Vashisht's Fusion";



const char* WIFI_PASS = "ninamman";

// ============================================================
// SUPABASE — the app's copy of the world
//
// The gateway is the only thing that ever talks to the collar, and the
// collar is the only thing that ever touches the animal. This link exists
// for one reason: so the farmer's phone, wherever it is, can see her and get
// alerted -- it is not part of the safety loop. The local LoRa link (1 Hz,
// unchanged above) is what steers her, with or without this connection.
//
// DEVICE_INGEST_SECRET authenticates every POST -- same shared secret the
// Herdwise app's ingest function checks for real collars and the simulator
// alike. Rotate it in both places together (.env locally, this constant
// here) if it is ever regenerated.
// ============================================================

const char* SUPABASE_INGEST_URL =
  "https://bzufqeuaordhrykgsiub.supabase.co/functions/v1/ingest";

const char* DEVICE_INGEST_SECRET =
  "6be3390d243cfc602fbce1b5985ef88dd320fdb79593d35640a76bc9a17da336";

// Matches devices.device_key for the one real animal (Tulsi) in Supabase.
// One device, one constant -- deliberately not a config screen.
const char* CLOUD_DEVICE_ID = "PASHU-A01";

// Moved up from beside submitBoundary() -- see the comment there. Arduino's
// auto-generated function prototypes land at the top of the file, above
// where this type used to be defined, which is what broke the build.
enum BoundarySubmitStatus {
  BOUNDARY_QUEUED = 0,
  BOUNDARY_EMPTY = 1,
  BOUNDARY_BAD_COUNT = 2,
  BOUNDARY_BAD_COORD = 3,
  BOUNDARY_BUSY = 4
};

// Forward declaration to prevent Arduino IDE prototype generation failures
BoundarySubmitStatus submitBoundary(const String &data);

// ============================================================
// SX1262 — BOARD B / GATEWAY
// ============================================================

#define LORA_SCK   12
#define LORA_MISO   4
#define LORA_MOSI  11
#define LORA_NSS   10

SX1262 radio = new Module(
  LORA_NSS,
  16,   // DIO1
  14,   // RESET
  15    // BUSY
);

// ============================================================
// WEB SERVER
// ============================================================

WebServer server(80);
Preferences gatewayPrefs;

// ============================================================
// TIMING
// ============================================================

// Exactly 1 second so browser and collar feel live.
const unsigned long TELEMETRY_INTERVAL = 1000;

// Collar considered offline after 4 seconds.
const unsigned long COLLAR_TIMEOUT = 4000;

unsigned long lastTelemetryRequest = 0;
unsigned long lastCollarSeen = 0;

// ============================================================
// COLLAR STATUS
// ============================================================

bool collarOnline = false;

// ============================================================
// LAST TELEMETRY
// ============================================================

String lastTelemetry = "";
String lastEvent = "NONE";

uint32_t telemetrySequence = 0;

double collarLat = 0.0;
double collarLon = 0.0;

double collarSpeed = 0.0;
double collarHeading = 0.0;

int collarSatellites = 0;

double acceleration = 0.0;

double boundaryDistance = -1.0;
double roadDistance = -1.0;

int riskScore = 0;

String riskType = "NO_GPS";
String riskState = "WAITING";
String action = "NONE";

bool buzzerOn = false;
bool vibrationOn = false;

// ============================================================
// COLLAR SIGNAL QUALITY
// ============================================================

float lastRSSI = 0.0;
float lastSNR = 0.0;

// ============================================================
// COMMAND STATE
// ============================================================

String pendingCommand = "";
String pendingDescription = "";

// Boundary data is only made active here after the collar acknowledges it.
// Keeping this copy lets the dashboard show the configured fence after a
// browser refresh or gateway reboot; the collar remains the safety authority.
String pendingBoundaryData = "";
String activeBoundaryData = "";
int activeBoundaryPointCount = 0;
bool boundaryConfigured = false;

String lastCommandResult = "NONE";

bool commandBusy = false;

// ============================================================
// GATEWAY BOUNDARY STATE
// ============================================================

/**
 * How many CORNERS the fence has -- not how many "lat,lon" entries are in
 * the wire string. A closed ring repeats its first point as its last (that
 * repeat is what closes the shape for the point-in-polygon math), so a
 * triangle the farmer drew with 3 taps arrives here as 4 coordinate
 * entries. Counting that raw would show "4 points" for a 3-point triangle
 * -- technically what's on the wire, but not what any farmer drew or would
 * call it.
 */
int countBoundaryPoints(const String &data) {

  if (data.length() == 0) {
    return 0;
  }

  int count = 1;

  for (size_t i = 0; i < data.length(); i++) {
    if (data[i] == ';') {
      count++;
    }
  }

  if (count >= 2) {

    int firstEnd = data.indexOf(';');
    String first = firstEnd < 0 ? data : data.substring(0, firstEnd);

    int lastStart = data.lastIndexOf(';');
    String last = lastStart < 0 ? data : data.substring(lastStart + 1);

    if (first == last) {
      count--;
    }
  }

  return count;
}

bool parseCoordinate(
  const String &text,
  double &value
) {

  char *end = nullptr;
  value = strtod(text.c_str(), &end);

  return end != text.c_str() &&
         *end == '\0' &&
         isfinite(value);
}

bool validLatLon(
  const String &latText,
  const String &lonText
) {

  double lat = 0.0;
  double lon = 0.0;

  return parseCoordinate(latText, lat) &&
         parseCoordinate(lonText, lon) &&
         lat >= -90.0 && lat <= 90.0 &&
         lon >= -180.0 && lon <= 180.0;
}

void loadGatewayBoundary() {

  gatewayPrefs.begin("gateway_cfg", true);
  activeBoundaryData = gatewayPrefs.getString("boundary", "");
  gatewayPrefs.end();

  activeBoundaryPointCount = countBoundaryPoints(activeBoundaryData);
  boundaryConfigured = activeBoundaryPointCount >= 3;
}

void saveGatewayBoundary() {

  gatewayPrefs.begin("gateway_cfg", false);
  gatewayPrefs.putString("boundary", activeBoundaryData);
  gatewayPrefs.end();
}

void clearGatewayBoundary() {

  activeBoundaryData = "";
  activeBoundaryPointCount = 0;
  boundaryConfigured = false;

  gatewayPrefs.begin("gateway_cfg", false);
  gatewayPrefs.remove("boundary");
  gatewayPrefs.end();
}

// WebServer is single-threaded.  Service cached HTTP requests during the
// short LoRa receive windows so a telemetry request never has to wait for an
// entire radio transaction.
void serviceWebClients() {

  if (WiFi.status() == WL_CONNECTED) {
    server.handleClient();
  }
}

// ============================================================
// CLEAN RADIO PACKET
// ============================================================

String cleanRadioPacket(
  const String &raw
) {

  String cleaned;
  cleaned.reserve(raw.length());

  for (
    size_t i = 0;
    i < raw.length();
    i++
  ) {

    char c = raw[i];

    // Keep printable ASCII only.
    if (
      c >= 32 &&
      c <= 126
    ) {
      cleaned += c;
    }
  }

  cleaned.trim();

  return cleaned;
}

// Radio replies can occasionally contain printable tail noise even when the
// useful protocol prefix is intact.  Canonicalise only the fixed ACK packets;
// telemetry stays unchanged because it carries variable values.
String normalizeRadioResponse(
  const String &packet
) {

  if (packet.startsWith("ACK|PONG")) {
    return "ACK|PONG";
  }

  if (packet.startsWith("ACK|BOUNDARY_OK")) {
    return "ACK|BOUNDARY_OK";
  }

  if (packet.startsWith("ACK|BOUNDARY_FAIL")) {
    return "ACK|BOUNDARY_FAIL";
  }

  if (packet.startsWith("ACK|BOUNDARY_CLEARED")) {
    return "ACK|BOUNDARY_CLEARED";
  }

  if (packet.startsWith("ACK|ROAD_OK")) {
    return "ACK|ROAD_OK";
  }

  if (packet.startsWith("ACK|ROAD_FAIL")) {
    return "ACK|ROAD_FAIL";
  }

  return packet;
}

// ============================================================
// WIFI
// ============================================================

void connectWiFi() {

  Serial.println();
  Serial.println("Connecting to Wi-Fi...");

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASS
  );

  int attempts = 0;

  while (
    WiFi.status() != WL_CONNECTED &&
    attempts < 30
  ) {

    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (
    WiFi.status() == WL_CONNECTED
  ) {

    Serial.println(
      "========================================"
    );

    Serial.println(
      "Wi-Fi CONNECTED ✓"
    );

    Serial.print(
      "Gateway IP: "
    );

    Serial.println(
      WiFi.localIP()
    );

    Serial.print(
      "Wi-Fi RSSI: "
    );

    Serial.print(
      WiFi.RSSI()
    );

    Serial.println(
      " dBm"
    );

    Serial.println(
      "========================================"
    );

    // UTC, no DST. `recorded_at` sent to Supabase must be a real wall-clock
    // timestamp -- the app's whole design rule is that a position always
    // shows its true age, never an invented one. Give the NTP client a few
    // seconds; if it never syncs, cloudCheckin() below refuses to POST rather
    // than send telemetry claiming 1970.
    configTime(
      0,
      0,
      "pool.ntp.org",
      "time.nist.gov"
    );

    Serial.println(
      "NTP sync requested."
    );

  } else {

    Serial.println(
      "Wi-Fi FAILED"
    );

    Serial.println(
      "LoRa will continue."
    );
  }
}

// ============================================================
// LORA SETUP
// ============================================================

bool setupLoRa() {

  SPI.begin(
    LORA_SCK,
    LORA_MISO,
    LORA_MOSI,
    LORA_NSS
  );

  Serial.println();
  Serial.println(
    "Initializing LoRa..."
  );

  int result = -1;

  for (
    int attempt = 1;
    attempt <= 3;
    attempt++
  ) {

    result =
      radio.begin(868.0);

    if (
      result == RADIOLIB_ERR_NONE
    ) {
      break;
    }

    Serial.printf(
      "LoRa attempt %d failed: %d\n",
      attempt,
      result
    );

    delay(400);
  }

  if (
    result != RADIOLIB_ERR_NONE
  ) {

    Serial.printf(
      "LoRa FAILED: %d\n",
      result
    );

    return false;
  }

  // ----------------------------------------------------------
  // KEEP YOUR PROVEN RADIO CONFIGURATION
  // ----------------------------------------------------------

  radio.setSpreadingFactor(10);
  radio.setBandwidth(125.0);
  radio.setCodingRate(5);
  radio.setOutputPower(14);
  radio.setSyncWord(0x34);
  radio.setCRC(true);

  Serial.println();
  Serial.println(
    "LoRa OK ✓"
  );

  Serial.println(
    "Frequency : 868 MHz"
  );

  Serial.println(
    "SF        : 10"
  );

  Serial.println(
    "Bandwidth : 125 kHz"
  );

  Serial.println(
    "Coding    : 4/5"
  );

  Serial.println(
    "Power     : 14 dBm"
  );

  Serial.println(
    "Sync      : 0x34"
  );

  return true;
}

// ============================================================
// LORA COMMAND TRANSACTION
// ============================================================

String executeLoRaCommand(
  const String &command,
  unsigned long timeoutMs
) {

  Serial.println();
  Serial.println(
    "----------------------------------------"
  );

  Serial.print(
    "GATEWAY TX -> "
  );

  Serial.println(
    command
  );

  // Mutable String for RadioLib.
  String packet = command;

  int txResult =
    radio.transmit(
      packet
    );

  if (
    txResult != RADIOLIB_ERR_NONE
  ) {

    Serial.printf(
      "LoRa TX FAILED: %d\n",
      txResult
    );

    Serial.println(
      "----------------------------------------"
    );

    return "";
  }

  Serial.println(
    "TX successful."
  );

  unsigned long start =
    millis();

  while (
    millis() - start <
    timeoutMs
  ) {

    // Keep the cached dashboard/API responsive while RadioLib waits for the
    // collar response.  Queueing a command remains safe because commandBusy
    // stays true for this whole transaction.
    serviceWebClients();

    String response;

    int rxResult =
      radio.receive(
        response,
        100,
        0
      );

    if (
      rxResult ==
      RADIOLIB_ERR_NONE
    ) {

      String clean =
        normalizeRadioResponse(
          cleanRadioPacket(
            response
          )
        );

      lastRSSI =
        radio.getRSSI();

      lastSNR =
        radio.getSNR();

      Serial.print(
        "GATEWAY RX <- "
      );

      Serial.println(
        clean
      );

      Serial.printf(
        "RSSI: %.1f dBm | SNR: %.1f dB\n",
        lastRSSI,
        lastSNR
      );

      Serial.println(
        "----------------------------------------"
      );

      return clean;
    }
  }

  Serial.println(
    "No response from collar."
  );

  Serial.println(
    "----------------------------------------"
  );

  return "";
}

// ============================================================
// PARSE TELEMETRY
//
// EXACT PACKET:
//
// TEL|seq|lat|lon|speed|heading|sat|accel|boundary|
// road|risk|type|state|action|buzzer|vibration|event
//
// TOTAL = 17 FIELDS
// ============================================================

void parseTelemetry(
  const String &msg
) {

  String fields[17];

  int fieldCount = 0;
  int cursor = 0;

  while (
    fieldCount < 17
  ) {

    int separator =
      msg.indexOf(
        '|',
        cursor
      );

    if (
      separator < 0
    ) {

      fields[fieldCount++] =
        msg.substring(
          cursor
        );

      break;
    }

    fields[fieldCount++] =
      msg.substring(
        cursor,
        separator
      );

    cursor =
      separator + 1;
  }

  if (
    fieldCount != 17
  ) {

    Serial.printf(
      "Invalid telemetry packet: "
      "expected 17 fields, got %d\n",
      fieldCount
    );

    Serial.print(
      "PACKET: "
    );

    Serial.println(
      msg
    );

    return;
  }

  if (
    fields[0] != "TEL"
  ) {

    Serial.println(
      "Invalid telemetry prefix."
    );

    return;
  }

  // ----------------------------------------------------------
  // PARSE
  // ----------------------------------------------------------

  telemetrySequence =
    fields[1].toInt();

  collarLat =
    fields[2].toDouble();

  collarLon =
    fields[3].toDouble();

  collarSpeed =
    fields[4].toDouble();

  collarHeading =
    fields[5].toDouble();

  collarSatellites =
    fields[6].toInt();

  acceleration =
    fields[7].toDouble();

  boundaryDistance =
    fields[8].toDouble();

  roadDistance =
    fields[9].toDouble();

  riskScore =
    fields[10].toInt();

  riskType =
    fields[11];

  riskState =
    fields[12];

  action =
    fields[13];

  buzzerOn =
    fields[14].toInt() != 0;

  vibrationOn =
    fields[15].toInt() != 0;

  // Keep the dashboard JSON valid if a radio packet has harmless printable
  // characters after the final event field.
  if (fields[16].startsWith("THREAT_DETECTED")) {

    lastEvent = "THREAT_DETECTED";

  } else if (fields[16].startsWith("STEERED_AWAY")) {

    lastEvent = "STEERED_AWAY";

  } else if (fields[16].startsWith("NONE")) {

    lastEvent = "NONE";

  } else {

    lastEvent = fields[16];
  }

  lastTelemetry =
    msg;

  lastCollarSeen =
    millis();

  collarOnline =
    true;

  // ----------------------------------------------------------
  // TERMINAL ENGINE DISPLAY
  // ----------------------------------------------------------

  Serial.println();
  Serial.println(
    "╔════════════════════════════════════════╗"
  );

  Serial.println(
    "║ COLLAR-001 / PREDICTION ENGINE         ║"
  );

  Serial.println(
    "╠════════════════════════════════════════╣"
  );

  Serial.printf(
    "║ GPS        %.6f, %.6f\n",
    collarLat,
    collarLon
  );

  Serial.printf(
    "║ SPEED      %.2f km/h\n",
    collarSpeed
  );

  Serial.printf(
    "║ HEADING    %.1f°\n",
    collarHeading
  );

  Serial.printf(
    "║ SATELLITES %d\n",
    collarSatellites
  );

  Serial.printf(
    "║ BOUNDARY   %.1f m\n",
    boundaryDistance
  );

  Serial.printf(
    "║ ROAD       %.1f m\n",
    roadDistance
  );

  Serial.println(
    "╠════════════════════════════════════════╣"
  );

  Serial.printf(
    "║ RISK       %d / 100\n",
    riskScore
  );

  Serial.printf(
    "║ TYPE       %s\n",
    riskType.c_str()
  );

  Serial.printf(
    "║ STATE      %s\n",
    riskState.c_str()
  );

  Serial.printf(
    "║ ACTION     %s\n",
    action.c_str()
  );

  Serial.printf(
    "║ BUZZER     %s\n",
    buzzerOn
      ? "ON"
      : "OFF"
  );

  Serial.printf(
    "║ VIBRATION  %s\n",
    vibrationOn
      ? "ON"
      : "OFF"
  );

  Serial.printf(
    "║ EVENT      %s\n",
    lastEvent.c_str()
  );

  Serial.println(
    "╚════════════════════════════════════════╝"
  );
}

// ============================================================
// QUEUE COMMAND
// ============================================================

bool queueCommand(
  const String &command,
  const String &description
) {

  if (
    commandBusy ||
    pendingCommand.length() > 0
  ) {

    return false;
  }

  pendingCommand =
    command;

  pendingDescription =
    description;

  lastCommandResult =
    "QUEUED";

  return true;
}

// ============================================================
// CLOUD COMMAND BACKLOG
// ============================================================
//
// One check-in response can contain several queued commands at once (a
// boundary push AND a beep, say) -- but the gateway can only have ONE
// command in flight at a time (pendingCommand/commandBusy above). Calling
// queueCommand() directly for each one meant only the first ever sent: the
// rest silently failed "gateway busy" and, because they were already
// marked delivered on the server the instant they appeared in this
// response, they could never be retried. This small backlog holds the
// overflow and feeds them into queueCommand() one at a time, in order, as
// the single in-flight slot frees up -- nothing queued here is ever lost.

#define CLOUD_BACKLOG_MAX 8

String cloudBacklogCommand[CLOUD_BACKLOG_MAX];
String cloudBacklogDescription[CLOUD_BACKLOG_MAX];
int cloudBacklogHead = 0;
int cloudBacklogTail = 0;

void cloudBacklogPush(
  const String &command,
  const String &description
) {

  int next =
    (cloudBacklogTail + 1) % CLOUD_BACKLOG_MAX;

  if (next == cloudBacklogHead) {
    // Backlog genuinely full (8 unsent commands already waiting) -- drop
    // the oldest rather than the newest, and say so plainly.
    Serial.println(
      "cloudBacklog: full, dropping oldest queued command."
    );
    cloudBacklogHead =
      (cloudBacklogHead + 1) % CLOUD_BACKLOG_MAX;
  }

  cloudBacklogCommand[cloudBacklogTail] = command;
  cloudBacklogDescription[cloudBacklogTail] = description;
  cloudBacklogTail = next;
}

void cloudBacklogDrain() {

  if (cloudBacklogHead == cloudBacklogTail) {
    return;   // nothing waiting
  }

  bool queued;

  // A boundary push goes back through submitBoundary() itself (same
  // validation, same downstream ACK handling the local /set-boundary page
  // uses) rather than straight into queueCommand() -- it stores the raw
  // "lat,lon;lat,lon;..." data, not a finished CMD| string.
  if (
    cloudBacklogDescription[cloudBacklogHead] ==
    "SET_BOUNDARY_DATA"
  ) {

    queued =
      submitBoundary(
        cloudBacklogCommand[cloudBacklogHead]
      ) == BOUNDARY_QUEUED;

  } else {

    queued =
      queueCommand(
        cloudBacklogCommand[cloudBacklogHead],
        cloudBacklogDescription[cloudBacklogHead]
      );
  }

  if (queued) {
    cloudBacklogHead =
      (cloudBacklogHead + 1) % CLOUD_BACKLOG_MAX;
  }
  // If not queued (slot still busy), the item stays at the head and is
  // retried on the next loop() tick -- nothing advances until it actually
  // sends.
}

// ============================================================
// PROCESS QUEUED COMMAND
// ============================================================

void processPendingCommand() {

  if (
    pendingCommand.length() == 0 ||
    commandBusy
  ) {
    return;
  }

  commandBusy =
    true;

  String command =
    pendingCommand;

  String description =
    pendingDescription;

  pendingCommand =
    "";

  pendingDescription =
    "";

  String response =
    executeLoRaCommand(
      command,
      3000
    );

  if (
    response.length() == 0
  ) {

    lastCommandResult =
      "TIMEOUT";

  } else {

    lastCommandResult =
      response;
  }

  // A fence is reported as configured only after this exact LoRa transaction
  // has a positive acknowledgement from the collar.
  if (
    description == "SET_BOUNDARY" &&
    response == "ACK|BOUNDARY_OK"
  ) {

    activeBoundaryData = pendingBoundaryData;
    activeBoundaryPointCount = countBoundaryPoints(activeBoundaryData);
    boundaryConfigured = activeBoundaryPointCount >= 3;
    saveGatewayBoundary();
    pendingBoundaryData = "";

  } else if (
    description == "CLEAR_BOUNDARY" &&
    response == "ACK|BOUNDARY_CLEARED"
  ) {

    clearGatewayBoundary();
    pendingBoundaryData = "";
  }

  commandBusy =
    false;

  if (
    response.startsWith(
      "TEL|"
    )
  ) {

    parseTelemetry(
      response
    );
  }
}

// ============================================================
// REQUEST TELEMETRY
// ============================================================

void requestTelemetry() {

  if (
    commandBusy ||
    pendingCommand.length() > 0
  ) {
    return;
  }

  String response =
    executeLoRaCommand(
      "CMD|REQ_TELEMETRY",
      1200
    );

  if (
    response.startsWith(
      "TEL|"
    )
  ) {

    parseTelemetry(
      response
    );

  } else if (
    response.length() == 0
  ) {

    if (
      lastCollarSeen > 0 &&
      millis() -
      lastCollarSeen >
      COLLAR_TIMEOUT
    ) {

      collarOnline =
        false;
    }
  }
}

// ============================================================
// WEB DASHBOARD
// ============================================================

void handleRoot() {

  String html = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>PaashuGuard — Collar Telemetry</title>

<style>

:root {
  --bg: #070a0f;
  --panel: #0d121a;
  --panel2: #111823;
  --border: #202a36;
  --muted: #7f8b9a;
  --text: #edf3f8;
  --green: #37e38d;
  --yellow: #f5c451;
  --red: #ff5f71;
  --blue: #4ea7ff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background:
    radial-gradient(
      circle at top right,
      rgba(78,167,255,.08),
      transparent 32%
    ),
    radial-gradient(
      circle at bottom left,
      rgba(55,227,141,.05),
      transparent 30%
    ),
    var(--bg);

  color: var(--text);

  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

/* =========================================================
   HEADER
   ========================================================= */

.header {
  height: 76px;

  padding:
    0 32px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  border-bottom:
    1px solid var(--border);

  background:
    rgba(7,10,15,.88);

  backdrop-filter:
    blur(18px);

  position: sticky;
  top: 0;

  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.logo {
  width: 38px;
  height: 38px;

  border-radius: 11px;

  display: grid;
  place-items: center;

  background:
    linear-gradient(
      135deg,
      #2ce294,
      #1c8bff
    );

  color: #061019;
  font-weight: 900;
}

.brand-title {
  font-size: 18px;
  font-weight: 750;
}

.brand-subtitle {
  font-size: 12px;
  color: var(--muted);

  margin-top: 2px;
}

.header-right {
  display: flex;
  gap: 10px;
  align-items: center;
}

.pill {
  padding:
    7px 12px;

  border:
    1px solid var(--border);

  border-radius: 999px;

  background:
    rgba(255,255,255,.025);

  font-size: 12px;
  color: var(--muted);
}

.live-pill {
  color: var(--green);

  border-color:
    rgba(55,227,141,.25);

  background:
    rgba(55,227,141,.06);
}

/* =========================================================
   MAIN
   ========================================================= */

.main {
  max-width: 1450px;

  margin:
    0 auto;

  padding:
    28px 32px 50px;
}

/* =========================================================
   TOP STATUS
   ========================================================= */

.hero {
  display: grid;

  grid-template-columns:
    minmax(0, 1fr)
    auto;

  gap: 18px;

  margin-bottom: 20px;
}

.hero-panel {
  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.035),
      rgba(255,255,255,.015)
    );

  border:
    1px solid var(--border);

  border-radius: 18px;

  padding: 22px;

  box-shadow:
    0 14px 45px
    rgba(0,0,0,.20);
}

.hero-label {
  color: var(--muted);

  font-size: 11px;

  text-transform: uppercase;

  letter-spacing:
    .13em;
}

.hero-title {
  font-size: 28px;

  font-weight: 780;

  margin-top: 5px;
}

.hero-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;

  margin-top: 14px;
}

.last-update {
  min-width: 260px;

  display: flex;
  flex-direction: column;
  justify-content: center;

  text-align: right;
}

.update-value {
  font-size: 17px;
  font-weight: 700;
}

/* =========================================================
   GRID
   ========================================================= */

.grid {
  display: grid;

  grid-template-columns:
    repeat(12, 1fr);

  gap: 16px;
}

.card {
  grid-column:
    span 4;

  background:
    linear-gradient(
      180deg,
      rgba(17,24,35,.95),
      rgba(12,17,25,.95)
    );

  border:
    1px solid var(--border);

  border-radius: 16px;

  padding: 20px;

  box-shadow:
    0 10px 35px
    rgba(0,0,0,.16);
}

.card.wide {
  grid-column:
    span 8;
}

.card.full {
  grid-column:
    span 12;
}

.card-header {
  display: flex;

  align-items: center;

  justify-content: space-between;

  margin-bottom: 18px;
}

.card-title {
  color: var(--muted);

  font-size: 11px;

  font-weight: 700;

  text-transform: uppercase;

  letter-spacing:
    .13em;
}

.card-badge {
  font-size: 11px;

  color: var(--blue);

  padding:
    5px 9px;

  border-radius: 999px;

  background:
    rgba(78,167,255,.08);

  border:
    1px solid
    rgba(78,167,255,.18);
}

/* =========================================================
   VALUES
   ========================================================= */

.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  display: flex;

  justify-content: space-between;

  align-items: center;

  padding:
    10px 0;

  border-bottom:
    1px solid
    rgba(255,255,255,.045);
}

.row:last-child {
  border-bottom: none;
}

.label {
  color: var(--muted);
  font-size: 13px;
}

.value {
  color: var(--text);

  font-size: 14px;

  font-weight: 650;

  font-variant-numeric:
    tabular-nums;
}

/* =========================================================
   RISK
   ========================================================= */

.risk-card {
  position: relative;
  overflow: hidden;
}

.risk-number {
  font-size: 58px;

  line-height: 1;

  letter-spacing:
    -.045em;

  font-weight: 850;

  margin:
    12px 0 7px;
}

.risk-label {
  color: var(--muted);

  font-size: 12px;
}

.risk-bar {
  width: 100%;

  height: 7px;

  margin-top: 18px;

  background:
    #19212b;

  border-radius:
    99px;

  overflow: hidden;
}

.risk-fill {
  height: 100%;

  width: 0%;

  border-radius:
    inherit;

  transition:
    width .35s ease,
    background .35s ease;

  background:
    var(--green);
}

.status-line {
  display: flex;

  justify-content:
    space-between;

  align-items: center;

  margin-top: 16px;
}

.status-text {
  font-size: 15px;
  font-weight: 750;
}

.safe {
  color: var(--green);
}

.warn {
  color: var(--yellow);
}

.danger {
  color: var(--red);
}

/* =========================================================
   BIG DECISION
   ========================================================= */

.decision {
  min-height: 215px;

  display: flex;

  flex-direction: column;

  justify-content:
    space-between;
}

.decision-value {
  font-size: 32px;

  font-weight: 800;

  margin-top: 10px;
}

.decision-description {
  color: var(--muted);

  font-size: 13px;

  margin-top: 8px;

  line-height: 1.6;
}

.actuators {
  display: flex;

  gap: 10px;

  margin-top: 18px;
}

.actuator {
  flex: 1;

  padding: 11px;

  border-radius: 12px;

  text-align: center;

  border:
    1px solid var(--border);

  background:
    rgba(255,255,255,.02);
}

.actuator-name {
  color: var(--muted);
  font-size: 11px;
}

.actuator-value {
  margin-top: 4px;

  font-size: 14px;
  font-weight: 800;
}

/* =========================================================
   EVENT
   ========================================================= */

.event-box {
  padding:
    14px;

  border:
    1px solid var(--border);

  border-radius: 12px;

  background:
    rgba(255,255,255,.02);
}

.event-type {
  font-size: 16px;
  font-weight: 750;
}

.event-time {
  color: var(--muted);

  font-size: 12px;

  margin-top: 5px;
}

/* =========================================================
   TELEMETRY STREAM
   ========================================================= */

.stream {
  max-height:
    330px;

  overflow:
    auto;

  font-family:
    "SFMono-Regular",
    "JetBrains Mono",
    monospace;

  font-size:
    12px;

  line-height:
    1.75;

  color:
    #b8c5d3;

  scrollbar-width:
    thin;
}

.stream-line {
  padding:
    6px 8px;

  border-bottom:
    1px solid
    rgba(255,255,255,.035);
}

.stream-line:hover {
  background:
    rgba(255,255,255,.025);
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (
  max-width: 980px
) {

  .hero {
    grid-template-columns:
      1fr;
  }

  .last-update {
    min-width: 0;

    text-align: left;
  }

  .card,
  .card.wide {
    grid-column:
      span 6;
  }
}

@media (
  max-width: 680px
) {

  .header {
    padding: 0 16px;
  }

  .main {
    padding:
      20px 16px 40px;
  }

  .header-right {
    display: none;
  }

  .card,
  .card.wide,
  .card.full {
    grid-column:
      span 12;
  }

  .hero-title {
    font-size: 23px;
  }
}

</style>

</head>

<body>

<!-- =======================================================
     HEADER
======================================================== -->

<header class="header">

  <div class="brand">

    <div class="logo">
      PG
    </div>

    <div>

      <div class="brand-title">
        PaashuGuard
      </div>

      <div class="brand-subtitle">
        Live Collar Intelligence
      </div>

    </div>

  </div>

  <div class="header-right">

    <div
      class="pill"
      id="gatewayStatus"
    >
      Gateway — Connecting
    </div>

    <div
      class="pill live-pill"
      id="liveStatus"
    >
      ● CONNECTING...
    </div>

    <button
      class="pill"
      style="cursor: pointer; background: rgba(255,255,255,.05); border: 1px solid var(--border);"
      onclick="fetch('/sync', {method: 'POST'}).then(() => alert('Gateway is now syncing with the cloud...'))"
    >
      <svg style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
      Sync Cloud
    </button>

  </div>

</header>


<!-- =======================================================
     MAIN
======================================================== -->

<main class="main">


  <!-- HERO -->

  <section class="hero">

    <div class="hero-panel">

      <div class="hero-label">
        Active collar
      </div>

      <div class="hero-title" id="collarId">
        Loading…
      </div>

      <div class="hero-meta">

        <div class="pill">
          LoRa 868 MHz
        </div>

        <div class="pill">
          SF10
        </div>

        <div
          class="pill"
          id="collarStatus"
        >
          ● Waiting for collar
        </div>

      </div>

    </div>


    <div class="hero-panel last-update">

      <div class="hero-label">
        Last telemetry
      </div>

      <div
        class="update-value"
        id="lastUpdate"
      >
        Waiting...
      </div>

      <div
        class="hero-label"
        style="margin-top:7px"
      >
        Packet sequence
      </div>

      <div
        class="update-value"
        id="sequence"
      >
        —
      </div>

    </div>

  </section>


  <!-- GRID -->

  <section class="grid">


    <!-- GPS -->

    <div class="card">

      <div class="card-header">

        <div class="card-title">
          GPS Position
        </div>

        <div class="card-badge">
          LIVE
        </div>

      </div>

      <div class="rows">

        <div class="row">

          <span class="label">
            Latitude
          </span>

          <span
            class="value"
            id="lat"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            Longitude
          </span>

          <span
            class="value"
            id="lon"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            Satellites
          </span>

          <span
            class="value"
            id="sat"
          >
            —
          </span>

        </div>

      </div>

    </div>


    <!-- MOTION -->

    <div class="card">

      <div class="card-header">

        <div class="card-title">
          Motion
        </div>

        <div class="card-badge">
          IMU + GPS
        </div>

      </div>

      <div class="rows">

        <div class="row">

          <span class="label">
            Speed
          </span>

          <span
            class="value"
            id="speed"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            Heading
          </span>

          <span
            class="value"
            id="heading"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            Acceleration
          </span>

          <span
            class="value"
            id="accel"
          >
            —
          </span>

        </div>

      </div>

    </div>


    <!-- SPATIAL -->

    <div class="card">

      <div class="card-header">

        <div class="card-title">
          Spatial Analysis
        </div>

        <div class="card-badge">
          ENGINE INPUT
        </div>

      </div>

      <div class="rows">

        <div class="row">

          <span class="label">
            Boundary distance
          </span>

          <span
            class="value"
            id="boundary"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            Nearest road
          </span>

          <span
            class="value"
            id="road"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            Geofence
          </span>

          <span
            class="value"
            id="geofence"
          >
            Not configured
          </span>

        </div>

      </div>

    </div>
    
    <!-- DETAILED DISTANCE BREAKDOWN -->
    <div class="card wide" id="distance-breakdown-card" style="display: none;">
      <div class="card-header">
        <div class="card-title">Detailed Distance Breakdown</div>
        <div class="card-badge">LIVE CALCULATION</div>
      </div>
      
      <div style="font-size: 13px; font-weight: 600; color: #8a9bb3; padding: 12px 16px 8px; text-transform: uppercase; letter-spacing: 0.5px;">
        Sides (Fence Lines)
      </div>
      <div class="rows" id="distance-sides-list">
        <!-- Injected via JS -->
      </div>

      <div style="font-size: 13px; font-weight: 600; color: #8a9bb3; padding: 16px 16px 8px; text-transform: uppercase; letter-spacing: 0.5px;">
        Corners (Points)
      </div>
      <div class="rows" id="distance-corners-list">
        <!-- Injected via JS -->
      </div>
    </div>


    <!-- RISK -->

    <div class="card risk-card wide">

      <div class="card-header">

        <div class="card-title">
          Local Prediction Engine
        </div>

        <div class="card-badge">
          RUNNING ON COLLAR
        </div>

      </div>

      <div
        class="risk-number"
        id="risk"
      >
        —
      </div>

      <div class="risk-label">
        Current risk score
      </div>

      <div class="risk-bar">

        <div
          class="risk-fill"
          id="riskFill"
        ></div>

      </div>

      <div class="status-line">

        <div>

          <div
            class="hero-label"
            style="margin-bottom:4px"
          >
            State
          </div>

          <div
            class="status-text"
            id="state"
          >
            WAITING
          </div>

        </div>


        <div style="text-align:right">

          <div
            class="hero-label"
            style="margin-bottom:4px"
          >
            Risk type
          </div>

          <div
            class="status-text"
            id="type"
          >
            NO_GPS
          </div>

        </div>

      </div>

    </div>


    <!-- DECISION -->

    <div class="card decision">

      <div>

        <div class="card-header">

          <div class="card-title">
            Collar Decision
          </div>

          <div class="card-badge">
            LOCAL
          </div>

        </div>

        <div
          class="decision-value"
          id="action"
        >
          NONE
        </div>

        <div
          class="decision-description"
          id="decisionText"
        >
          No immediate action.
        </div>

      </div>


      <div class="actuators">

        <div class="actuator">

          <div class="actuator-name">
            BUZZER
          </div>

          <div
            class="actuator-value"
            id="buzzer"
          >
            OFF
          </div>

        </div>


        <div class="actuator">

          <div class="actuator-name">
            VIBRATION
          </div>

          <div
            class="actuator-value"
            id="vibration"
          >
            OFF
          </div>

        </div>

      </div>

    </div>


    <!-- EVENT -->

    <div class="card">

      <div class="card-header">

        <div class="card-title">
          Latest Event
        </div>

        <div class="card-badge">
          EVENT
        </div>

      </div>

      <div class="event-box">

        <div
          class="event-type"
          id="event"
        >
          NONE
        </div>

        <div
          class="event-time"
          id="eventTime"
        >
          No event received.
        </div>

      </div>

    </div>


    <!-- SIGNAL -->

    <div class="card">

      <div class="card-header">

        <div class="card-title">
          LoRa Link
        </div>

        <div class="card-badge">
          RADIO
        </div>

      </div>

      <div class="rows">

        <div class="row">

          <span class="label">
            RSSI
          </span>

          <span
            class="value"
            id="rssi"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            SNR
          </span>

          <span
            class="value"
            id="snr"
          >
            —
          </span>

        </div>

        <div class="row">

          <span class="label">
            Update rate
          </span>

          <span
            class="value"
          >
            1 Hz
          </span>

        </div>

      </div>

    </div>


    <!-- RAW STREAM -->

    <div class="card full">

      <div class="card-header">

        <div class="card-title">
          Live Telemetry Stream
        </div>

        <div class="card-badge">
          REAL TIME
        </div>

      </div>

      <div
        class="stream"
        id="stream"
      >
        Waiting for telemetry packets...
      </div>

    </div>


  </section>

</main>


<script>

// =========================================================
// STATE
// =========================================================

let lastSequence = null;

let streamEntries = [];

let telemetryRequestInFlight = false;

let lastGeofenceState = { configured: false, points: 0 };
let lastEventState = "NONE";
let dashboardToastTimer = null;

/** One-shot banner, top of the page, auto-hides. No dependency on any other
    UI section -- this must work even if the rest of the dashboard is mid-load. */
function showDashboardToast(message, type = 'success') {
  let el = document.getElementById('dashboardToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dashboardToast';
    document.body.appendChild(el);
  }
  let bg = '#16321f', fg = '#8ef0b0', border = '#2fae63';
  if (type === 'danger') {
    bg = '#3d1117'; fg = '#ff8fa1'; border = '#ff4d6a';
  } else if (type === 'info') {
    bg = '#0e243a'; fg = '#8ac7ff'; border = '#2f8ae6';
  }
  el.style.cssText =
    'position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
    'background:' + bg + ';color:' + fg + ';border:1px solid ' + border + ';' +
    'padding:11px 22px;border-radius:10px;font:700 13px/1.4 -apple-system,sans-serif;' +
    'z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.5);opacity:0;' +
    'transition:opacity .25s ease;pointer-events:none;max-width:90vw;text-align:center;';
  el.innerHTML = message;
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  if (dashboardToastTimer) clearTimeout(dashboardToastTimer);
  dashboardToastTimer = setTimeout(() => { el.style.opacity = '0'; }, 5000);
}


// =========================================================
// MATH HELPERS (Distance Breakdown)
// =========================================================

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const rLat1 = lat1 * Math.PI / 180;
  const rLat2 = lat2 * Math.PI / 180;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(rLat1) * Math.cos(rLat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const x = 0; const y = 0;
  const x1 = (lon1 - lon) * (Math.PI/180) * Math.cos(lat * Math.PI/180) * R;
  const y1 = (lat1 - lat) * (Math.PI/180) * R;
  const x2 = (lon2 - lon) * (Math.PI/180) * Math.cos(lat * Math.PI/180) * R;
  const y2 = (lat2 - lat) * (Math.PI/180) * R;
  const A = x - x1; const B = y - y1;
  const C = x2 - x1; const D = y2 - y1;
  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq != 0) param = dot / len_sq;
  let xx, yy;
  if (param < 0) { xx = x1; yy = y1; }
  else if (param > 1) { xx = x2; yy = y2; }
  else { xx = x1 + param * C; yy = y1 + param * D; }
  const dx = x - xx; const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// =========================================================
// FORMAT HELPERS
// =========================================================

function number(value, digits = 2) {

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return "—";
  }

  return n.toFixed(digits);
}


function setText(
  id,
  value
) {

  const el =
    document.getElementById(id);

  if (el) {
    el.innerText =
      value;
  }
}


// =========================================================
// RISK COLOR
// =========================================================

function applyRiskStyle(
  score
) {

  const risk =
    document.getElementById(
      "risk"
    );

  const state =
    document.getElementById(
      "state"
    );

  const fill =
    document.getElementById(
      "riskFill"
    );

  risk.classList.remove(
    "safe",
    "warn",
    "danger"
  );

  state.classList.remove(
    "safe",
    "warn",
    "danger"
  );

  let colorClass =
    "safe";

  if (score >= 75) {
    colorClass = "danger";
  }
  else if (score >= 35) {
    colorClass = "warn";
  }

  risk.classList.add(
    colorClass
  );

  state.classList.add(
    colorClass
  );

  fill.style.width =
    Math.max(
      0,
      Math.min(
        100,
        score
      )
    ) + "%";

  if (
    score >= 75
  ) {

    fill.style.background =
      "var(--red)";

  } else if (
    score >= 35
  ) {

    fill.style.background =
      "var(--yellow)";

  } else {

    fill.style.background =
      "var(--green)";
  }
}


// =========================================================
// DECISION TEXT
// =========================================================

function decisionDescription(
  action,
  type
) {

  if (
    action === "STEER_AWAY"
  ) {

    if (
      type === "PERIMETER"
    ) {

      return (
        "Collar detected a perimeter threat. " +
        "Buzzer stays off unless triggered from the app."
      );
    }

    if (
      type === "HIGH_TRAFFIC_ROAD"
    ) {

      return (
        "Collar detected a high-risk road approach. " +
        "Buzzer stays off unless triggered from the app."
      );
    }

    return (
      "Risk detected. Buzzer stays off unless triggered from the app."
    );
  }

  return (
    "No immediate steering action required."
  );
}


// =========================================================
// STREAM
// =========================================================

function addStreamEntry(
  data
) {

  const time =
    new Date()
      .toLocaleTimeString();

  const entry =
    "[" + time + "] " +
    "SEQ " + data.sequence +
    " | " +
    "GPS " +
    number(data.latitude, 6) +
    ", " +
    number(data.longitude, 6) +
    " | " +
    "RISK " +
    data.risk_score +
    " | " +
    data.risk_type +
    " | " +
    data.state +
    " | " +
    data.action;

  streamEntries.unshift(
    entry
  );

  if (
    streamEntries.length > 40
  ) {

    streamEntries =
      streamEntries.slice(
        0,
        40
      );
  }

  const stream =
    document.getElementById(
      "stream"
    );

  stream.innerHTML =
    streamEntries
      .map(
        item =>
          `<div class="stream-line">${item}</div>`
      )
      .join("");
}


// =========================================================
// UPDATE DASHBOARD
// =========================================================

async function updateTelemetry() {

  if (telemetryRequestInFlight) {
    return;
  }

  telemetryRequestInFlight = true;

  try {

    const [telRes, bndRes] = await Promise.all([
      fetch("/telemetry?_=" + Date.now(), { cache: "no-store" }),
      fetch("/boundary-status?_=" + Date.now(), { cache: "no-store" })
    ]);

    if (!telRes.ok || !bndRes.ok) {
      throw new Error("Data request failed");
    }

    const data = await telRes.json();
    const boundaryData = await bndRes.json();

    // -------------------------------------------------------
    // HEADER
    // -------------------------------------------------------

    setText(
      "gatewayStatus",
      "Gateway — Connected"
    );

    setText(
      "liveStatus",
      "● LIVE"
    );

    setText(
      "collarStatus",
      "● Collar online"
    );

    // -------------------------------------------------------
    // SEQUENCE
    // -------------------------------------------------------

    setText(
      "sequence",
      data.sequence
        ?? "—"
    );

    // -------------------------------------------------------
    // GPS
    // -------------------------------------------------------

    setText(
      "lat",
      number(
        data.latitude,
        6
      )
    );

    setText(
      "lon",
      number(
        data.longitude,
        6
      )
    );

    setText(
      "sat",
      data.satellites
    );

    // -------------------------------------------------------
    // MOTION
    // -------------------------------------------------------

    setText(
      "speed",
      number(
        data.speed,
        2
      ) + " km/h"
    );

    setText(
      "heading",
      number(
        data.heading,
        1
      ) + "°"
    );

    setText(
      "accel",
      number(
        data.acceleration,
        2
      ) + " g"
    );

    // -------------------------------------------------------
    // SPATIAL
    // -------------------------------------------------------

    // -1 is the gateway's "no boundary configured" sentinel, not a real
    // distance -- show a dash instead of a nonsense negative metre value.
    setText(
      "boundary",
      data.boundary_configured &&
      Number(data.boundary_distance) >= 0
        ? number(data.boundary_distance, 1) + " m"
        : "—"
    );

    // Same sentinel as boundary: -1 means "no road nearby to measure to",
    // not a real negative distance. This field never got the same fix when
    // boundary did, so it kept showing the raw -1.0 forever.
    setText(
      "road",
      Number(data.road_distance) >= 0
        ? number(data.road_distance, 1) + " m"
        : "—"
    );

    setText(
      "geofence",
      data.boundary_configured
        ? "Active · " + data.boundary_point_count + " points"
        : "Not configured"
    );

    // Toast notifications for Geofence, Threat Detected, and Steered Away
    const cameOnJustNow =
      data.boundary_configured &&
      (!lastGeofenceState.configured ||
       lastGeofenceState.points !== data.boundary_point_count);

    if (cameOnJustNow) {
      showDashboardToast(
        "✓ Geofence Coordinates Confirmed — Active on Collar (" +
        data.boundary_point_count + " points)",
        "success"
      );
    }

    lastGeofenceState.configured = data.boundary_configured;
    lastGeofenceState.points = data.boundary_point_count;

    if (data.event === "THREAT_DETECTED" && lastEventState !== "THREAT_DETECTED") {
      showDashboardToast(
        "⚠️ THREAT DETECTED: Animal approaching boundary — Collar Steering ACTIVE (Buzzer/Vibration ON)",
        "danger"
      );
    } else if (data.event === "STEERED_AWAY" && lastEventState !== "STEERED_AWAY") {
      showDashboardToast(
        "✓ STEERED AWAY: Animal safely returned inside grazing area — Warning cleared",
        "success"
      );
    }
    lastEventState = data.event;

    // -------------------------------------------------------
    // PREDICTION
    // -------------------------------------------------------

    const score =
      Number(
        data.risk_score
      );

    setText(
      "risk",
      score +
      " / 100"
    );

    setText(
      "type",
      data.risk_type
    );

    setText(
      "state",
      data.state
    );

    setText(
      "action",
      data.action
    );

    applyRiskStyle(
      score
    );

    // -------------------------------------------------------
    // DECISION
    // -------------------------------------------------------

    setText(
      "decisionText",
      decisionDescription(
        data.action,
        data.risk_type
      )
    );

    setText(
      "buzzer",
      data.buzzer
        ? "ON"
        : "OFF"
    );

    setText(
      "vibration",
      data.vibration
        ? "ON"
        : "OFF"
    );

    // -------------------------------------------------------
    // EVENT
    // -------------------------------------------------------

    setText(
      "event",
      data.event
    );

    setText(
      "eventTime",
      data.event === "NONE"
        ? "No active event."
        : "Received at " +
          new Date()
            .toLocaleTimeString()
    );

    // -------------------------------------------------------
    // RADIO
    // -------------------------------------------------------

    setText(
      "rssi",
      data.rssi !== undefined
        ? number(data.rssi, 1) +
          " dBm"
        : "—"
    );

    setText(
      "snr",
      data.snr !== undefined
        ? number(data.snr, 1) +
          " dB"
        : "—"
    );

    // -------------------------------------------------------
    // LAST UPDATE
    // -------------------------------------------------------

    setText(
      "lastUpdate",
      new Date()
        .toLocaleTimeString()
    );

    // -------------------------------------------------------
    // STREAM
    // -------------------------------------------------------

    if (
      data.sequence !==
      lastSequence
    ) {

      addStreamEntry(
        data
      );

      lastSequence =
        data.sequence;
    }

    // -------------------------------------------------------
    // DETAILED DISTANCE BREAKDOWN
    // -------------------------------------------------------
    if (boundaryData && boundaryData.configured && boundaryData.point_count >= 3 && boundaryData.coordinates) {
      document.getElementById('distance-breakdown-card').style.display = 'block';
      
      const cowLat = data.latitude;
      const cowLon = data.longitude;
      
      const ptsStr = boundaryData.coordinates.split(';');
      const points = [];
      for (const p of ptsStr) {
        if (!p) continue;
        const [latStr, lonStr] = p.split(',');
        points.push({ lat: parseFloat(latStr), lon: parseFloat(lonStr) });
      }
      
      const sides = [];
      const corners = [];
      
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        
        // Calculate Corner Distance
        const cornerDist = haversineDistance(cowLat, cowLon, p1.lat, p1.lon);
        corners.push({ index: i + 1, distance: cornerDist });
        
        // Calculate Side Distance
        const sideDist = distanceToSegment(cowLat, cowLon, p1.lat, p1.lon, p2.lat, p2.lon);
        sides.push({ index: i + 1, distance: sideDist });
      }
      
      sides.sort((a, b) => a.distance - b.distance);
      corners.sort((a, b) => a.distance - b.distance);
      
      // Render Sides
      let sidesHtml = '';
      sides.forEach((side, idx) => {
        const isNearest = idx === 0;
        sidesHtml += `
          <div class="row" style="${isNearest ? 'background: rgba(47, 174, 99, 0.1); border-left: 2px solid #2fae63;' : ''}">
            <span class="label" style="${isNearest ? 'color: #8ef0b0;' : ''}">
              ${isNearest ? 'Nearest Side (Line ' + side.index + ')' : 'Side ' + side.index}
            </span>
            <span class="value" style="${isNearest ? 'color: #fff; font-weight: 700;' : ''}">
              ${number(side.distance, 1)} m
            </span>
          </div>
        `;
      });
      document.getElementById('distance-sides-list').innerHTML = sidesHtml;
      
      // Render Corners
      let cornersHtml = '';
      corners.forEach((corner, idx) => {
        const isNearest = idx === 0;
        cornersHtml += `
          <div class="row" style="${isNearest ? 'background: rgba(47, 174, 99, 0.1); border-left: 2px solid #2fae63;' : ''}">
            <span class="label" style="${isNearest ? 'color: #8ef0b0;' : ''}">
              ${isNearest ? 'Nearest Corner (Point ' + corner.index + ')' : 'Corner ' + corner.index}
            </span>
            <span class="value" style="${isNearest ? 'color: #fff; font-weight: 700;' : ''}">
              ${number(corner.distance, 1)} m
            </span>
          </div>
        `;
      });
      document.getElementById('distance-corners-list').innerHTML = cornersHtml;
      
    } else {
      document.getElementById('distance-breakdown-card').style.display = 'none';
    }

  }

  catch (
    error
  ) {

    setText(
      "gatewayStatus",
      "Gateway — Connection issue"
    );

    setText(
      "liveStatus",
      "● DISCONNECTED"
    );

    setText(
      "collarStatus",
      "● Collar unavailable"
    );
  }

  finally {

    telemetryRequestInFlight = false;
  }
}


// =========================================================
// START
// =========================================================

updateTelemetry();

setInterval(
  updateTelemetry,
  1000
);

</script>

</body>
</html>

)rawliteral";

  // The page shipped as a compile-time literal with a placeholder name --
  // "COLLAR-001 . Bella" never corresponded to anything real. Substitute
  // the one identifier this firmware actually knows, at send time.
  html.replace("Loading...", String(CLOUD_DEVICE_ID));

  server.send(
    200,
    "text/html",
    html
  );
}

// ============================================================
// HTTP /PING
// ============================================================

void handlePing() {

  bool queued =
    queueCommand(
      "CMD|PING",
      "PING"
    );

  String json =
    "{";

  json +=
    "\"gateway\":\"online\",";

  json +=
    "\"collar_online\":" +
    String(
      collarOnline
        ? "true"
        : "false"
    ) +
    ",";

  json +=
    "\"ping_queued\":" +
    String(
      queued
        ? "true"
        : "false"
    );

  json +=
    "}";

  server.send(
    queued ? 202 : 409,
    "application/json",
    json
  );
}

// ============================================================
// HTTP /STATUS
// ============================================================

void handleStatus() {

  String json =
    "{";

  json +=
    "\"gateway\":\"online\",";

  json +=
    "\"wifi_rssi\":" +
    String(
      WiFi.RSSI()
    ) +
    ",";

  json +=
    "\"ip\":\"" +
    WiFi.localIP().toString() +
    "\",";

  json +=
    "\"collar_online\":" +
    String(
      collarOnline
        ? "true"
        : "false"
    ) +
    ",";

  json +=
    "\"risk_score\":" +
    String(
      riskScore
    ) +
    ",";

  json +=
    "\"risk_type\":\"" +
    riskType +
    "\",";

  json +=
    "\"state\":\"" +
    riskState +
    "\",";

  json +=
    "\"action\":\"" +
    action +
    "\",";

  json +=
    "\"last_event\":\"" +
    lastEvent +
    "\",";

  json +=
    "\"sequence\":" +
    String(
      telemetrySequence
    ) +
    ",";

  json +=
    "\"rssi\":" +
    String(
      lastRSSI,
      1
    ) +
    ",";

  json +=
    "\"snr\":" +
    String(
      lastSNR,
      1
    ) +
    ",\"boundary_configured\":" +
    String(
      boundaryConfigured
        ? "true"
        : "false"
    ) +
    ",\"boundary_point_count\":" +
    String(
      activeBoundaryPointCount
    );

  json +=
    "}";

  server.send(
    200,
    "application/json",
    json
  );
}

// ============================================================
// HTTP /TELEMETRY
// ============================================================

void handleTelemetry() {

  // Allow localhost:8000 test page to read live telemetry.
  server.sendHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  // Prevent browser caching of telemetry snapshots.
  server.sendHeader(
    "Cache-Control",
    "no-store"
  );

  String json =
    "{";

  json +=
    "\"latitude\":" +
    String(
      collarLat,
      6
    ) +
    ",";

  json +=
    "\"longitude\":" +
    String(
      collarLon,
      6
    ) +
    ",";

  json +=
    "\"speed\":" +
    String(
      collarSpeed,
      2
    ) +
    ",";

  json +=
    "\"heading\":" +
    String(
      collarHeading,
      1
    ) +
    ",";

  json +=
    "\"satellites\":" +
    String(
      collarSatellites
    ) +
    ",";

  json +=
    "\"acceleration\":" +
    String(
      acceleration,
      2
    ) +
    ",";

  json +=
    "\"boundary_distance\":" +
    String(
      boundaryDistance,
      1
    ) +
    ",";

  json +=
    "\"road_distance\":" +
    String(
      roadDistance,
      1
    ) +
    ",";

  json +=
    "\"risk_score\":" +
    String(
      riskScore
    ) +
    ",";

  json +=
    "\"risk_type\":\"" +
    riskType +
    "\",";

  json +=
    "\"state\":\"" +
    riskState +
    "\",";

  json +=
    "\"action\":\"" +
    action +
    "\",";

  json +=
    "\"buzzer\":" +
    String(
      buzzerOn
        ? "true"
        : "false"
    ) +
    ",";

  json +=
    "\"vibration\":" +
    String(
      vibrationOn
        ? "true"
        : "false"
    ) +
    ",";

  json +=
    "\"event\":\"" +
    lastEvent +
    "\",";

  json +=
    "\"sequence\":" +
    String(
      telemetrySequence
    ) +
    ",";

  json +=
    "\"rssi\":" +
    String(
      lastRSSI,
      1
    ) +
    ",";

  json +=
    "\"snr\":" +
    String(
      lastSNR,
      1
    ) +
    ",\"boundary_configured\":" +
    String(
      boundaryConfigured
        ? "true"
        : "false"
    ) +
    ",\"boundary_point_count\":" +
    String(
      activeBoundaryPointCount
    );

  json +=
    "}";

  // Prevent browser caching.
  server.sendHeader(
    "Cache-Control",
    "no-store"
  );

  server.send(
    200,
    "application/json",
    json
  );
}

// ============================================================
// HTTP /COMMAND-STATUS
// ============================================================

void handleCommandStatus() {

  String json =
    "{";

  json +=
    "\"busy\":" +
    String(
      commandBusy
        ? "true"
        : "false"
    ) +
    ",";

  json +=
    "\"pending\":\"" +
    pendingDescription +
    "\",";

  json +=
    "\"last_result\":\"" +
    lastCommandResult +
    "\",";

  json +=
    "\"boundary_configured\":" +
    String(
      boundaryConfigured
        ? "true"
        : "false"
    ) +
    ",\"boundary_point_count\":" +
    String(
      activeBoundaryPointCount
    );

  json +=
    "}";

  server.send(
    200,
    "application/json",
    json
  );
}

// ============================================================
// HTTP /SET-BOUNDARY
//
// Example:
// /set-boundary?data=13.073420,77.589100;13.073420,77.590100;...
// ============================================================

// ============================================================
// SUBMIT BOUNDARY (shared)
//
// Both the local test page (/set-boundary) and the cloud bridge (a
// `set_zone` command popped from Supabase) end up here. One code path, one
// set of rules -- the collar accepts a boundary from the farmer's app on
// exactly the same terms it accepts one typed into the test page by hand.
//
// `data` is "lat,lon;lat,lon;..." -- the same wire convention the test
// page's JS has always built. Returns a status code so each caller can
// translate it into whatever response its transport needs.
// ============================================================

BoundarySubmitStatus submitBoundary(
  const String &data
) {

  if (
    data.length() == 0
  ) {

    return BOUNDARY_EMPTY;
  }

  int count = 1;

  for (
    int i = 0;
    i < data.length();
    i++
  ) {

    if (
      data[i] == ';'
    ) {

      count++;
    }
  }

  if (
    count < 3 ||
    count > 8
  ) {

    return BOUNDARY_BAD_COUNT;
  }

  String command =
    "CMD|SET_BOUNDARY|" +
    String(
      count
    );

  int cursor = 0;

  for (
    int i = 0;
    i < count;
    i++
  ) {

    int separator =
      data.indexOf(
        ';',
        cursor
      );

    String point;

    if (
      separator < 0
    ) {

      point =
        data.substring(
          cursor
        );

    } else {

      point =
        data.substring(
          cursor,
          separator
        );

      cursor =
        separator + 1;
    }

    int comma =
      point.indexOf(',');

    if (
      comma < 0
    ) {

      return BOUNDARY_BAD_COORD;
    }

    String lat =
      point.substring(
        0,
        comma
      );

    String lon =
      point.substring(
        comma + 1
      );

    if (
      !validLatLon(
        lat,
        lon
      )
    ) {

      return BOUNDARY_BAD_COORD;
    }

    command +=
      "|" + lat +
      "|" + lon;
  }

  bool queued =
    queueCommand(
      command,
      "SET_BOUNDARY"
    );

  if (
    !queued
  ) {

    return BOUNDARY_BUSY;
  }

  pendingBoundaryData = data;

  return BOUNDARY_QUEUED;
}

void handleSetBoundary() {

  if (
    !server.hasArg(
      "data"
    )
  ) {

    server.send(
      400,
      "text/plain",
      "Missing data parameter."
    );

    return;
  }

  String data =
    server.arg(
      "data"
    );

  BoundarySubmitStatus status =
    submitBoundary(
      data
    );

  switch (status) {

    case BOUNDARY_EMPTY:

      server.send(
        400,
        "text/plain",
        "Missing data parameter."
      );

      return;

    case BOUNDARY_BAD_COUNT:

      server.send(
        400,
        "text/plain",
        "Boundary needs 3-8 points."
      );

      return;

    case BOUNDARY_BAD_COORD:

      server.send(
        400,
        "text/plain",
        "Latitude or longitude is invalid."
      );

      return;

    case BOUNDARY_BUSY:

      server.send(
        409,
        "application/json",
        "{\"status\":\"BUSY\"}"
      );

      return;

    case BOUNDARY_QUEUED:

      server.send(
        202,
        "application/json",
        "{\"status\":\"QUEUED\",\"message\":\"Boundary queued for LoRa transmission.\"}"
      );

      return;
  }
}

// ============================================================
// HTTP /SET-ROAD
//
// Example:
// /set-road?id=0&risk=3&data=13.0734,77.5891;13.0739,77.5902
// ============================================================

void handleSync() {
  lastCloudCheckin = 0;
  server.send(200, "application/json", "{\"status\":\"syncing\"}");
}

void handleSetRoad() {

  if (
    !server.hasArg("id") ||
    !server.hasArg("risk") ||
    !server.hasArg("data")
  ) {

    server.send(
      400,
      "text/plain",
      "Required: id, risk, data."
    );

    return;
  }

  int id =
    server.arg(
      "id"
    ).toInt();

  int risk =
    server.arg(
      "risk"
    ).toInt();

  String data =
    server.arg(
      "data"
    );

  int separator =
    data.indexOf(';');

  if (
    separator < 0
  ) {

    server.send(
      400,
      "text/plain",
      "Expected lat1,lon1;lat2,lon2."
    );

    return;
  }

  String p1 =
    data.substring(
      0,
      separator
    );

  String p2 =
    data.substring(
      separator + 1
    );

  int c1 =
    p1.indexOf(',');

  int c2 =
    p2.indexOf(',');

  if (
    c1 < 0 ||
    c2 < 0
  ) {

    server.send(
      400,
      "text/plain",
      "Invalid road coordinates."
    );

    return;
  }

  String lat1 =
    p1.substring(
      0,
      c1
    );

  String lon1 =
    p1.substring(
      c1 + 1
    );

  String lat2 =
    p2.substring(
      0,
      c2
    );

  String lon2 =
    p2.substring(
      c2 + 1
    );

  String command =
    "CMD|SET_ROAD|" +
    String(id) +
    "|" +
    String(id) +
    "|" +
    String(risk) +
    "|" +
    lat1 +
    "|" +
    lon1 +
    "|" +
    lat2 +
    "|" +
    lon2;

  bool queued =
    queueCommand(
      command,
      "SET_ROAD"
    );

  if (
    !queued
  ) {

    server.send(
      409,
      "application/json",
      "{\"status\":\"BUSY\"}"
    );

    return;
  }

  server.send(
    202,
    "application/json",
    "{\"status\":\"QUEUED\",\"message\":\"Road queued for LoRa transmission.\"}"
  );
}

// ============================================================
// HTTP /CLEAR-BOUNDARY
// ============================================================

void handleClearBoundary() {

  bool queued =
    queueCommand(
      "CMD|CLEAR_BOUNDARY",
      "CLEAR_BOUNDARY"
    );

  if (
    !queued
  ) {

    server.send(
      409,
      "application/json",
      "{\"status\":\"BUSY\"}"
    );

    return;
  }

  server.send(
    202,
    "application/json",
    "{\"status\":\"QUEUED\"}"
  );
}

// ============================================================
// HTTP /BOUNDARY-STATUS
// ============================================================

void handleBoundaryStatus() {

  String json =
    "{\"configured\":" +
    String(
      boundaryConfigured
        ? "true"
        : "false"
    ) +
    ",\"point_count\":" +
    String(
      activeBoundaryPointCount
    ) +
    ",\"coordinates\":\"" +
    activeBoundaryData +
    "\",\"last_result\":\"" +
    lastCommandResult +
    "\"}";

  server.sendHeader(
    "Cache-Control",
    "no-store"
  );

  server.send(
    200,
    "application/json",
    json
  );
}

// ============================================================
// WEB ROUTES
// ============================================================


// ============================================================
// GEOfENCE TEST PAGE
// Served directly by Board B so the browser uses the same origin
// as /telemetry, /set-boundary and /command-status.
// ============================================================

const char GEOFENCE_HTML[] PROGMEM = R"GEOPAGE(
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <title>PaashuGuard — Geofence Configuration</title>

    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

    <link rel="stylesheet" href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css" />

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            background: #080c11;
            color: #eef3f8;
            font-family:
                Inter,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
        }

        .header {
            height: 72px;
            padding: 0 24px;

            display: flex;
            justify-content: space-between;
            align-items: center;

            background: #0d131b;
            border-bottom: 1px solid #202a35;
        }

        .title {
            font-size: 19px;
            font-weight: 750;
        }

        .subtitle {
            margin-top: 3px;
            font-size: 12px;
            color: #7f8c9b;
        }

        .live {
            display: flex;
            align-items: center;
            gap: 8px;

            color: #4de39b;
            font-size: 13px;
            font-weight: 700;
        }

        .live-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: #4de39b;
            box-shadow: 0 0 12px rgba(77, 227, 155, .6);
        }

        .layout {
            height: calc(100vh - 72px);

            display: grid;
            grid-template-columns: 1fr 400px;
        }

        #map {
            width: 100%;
            height: 100%;
        }

        .sidebar {
            overflow-y: auto;
            padding: 20px;

            background: #0a0f15;
            border-left: 1px solid #202a35;
        }

        .card {
            padding: 18px;
            margin-bottom: 16px;

            background: #101720;
            border: 1px solid #222d39;
            border-radius: 15px;
        }

        .section-title {
            margin-bottom: 14px;

            color: #7e8b9a;
            font-size: 11px;
            font-weight: 750;
            text-transform: uppercase;
            letter-spacing: .12em;
        }

        .position {
            font-family: monospace;
            font-size: 13px;
            line-height: 1.8;
        }

        .position strong {
            color: #fff;
        }

        .gps-status {
            display: inline-flex;
            align-items: center;
            gap: 7px;

            margin-bottom: 12px;
            padding: 6px 10px;

            border-radius: 99px;

            background: rgba(77, 227, 155, .08);
            border: 1px solid rgba(77, 227, 155, .18);

            color: #69e9ae;
            font-size: 11px;
            font-weight: 700;
        }

        .gps-status.waiting {
            color: #f2c85a;
            background: rgba(242, 200, 90, .08);
            border-color: rgba(242, 200, 90, .18);
        }

        .count {
            font-size: 28px;
            font-weight: 800;
        }

        .muted {
            color: #7f8c9b;
            font-size: 12px;
        }

        .coordinates {
            margin-top: 12px;

            max-height: 220px;
            overflow-y: auto;

            font-family: monospace;
            font-size: 11px;
            line-height: 1.75;
        }

        .coordinate-row {
            padding: 7px 0;
            border-bottom: 1px solid #1c2530;
        }

        .button {
            width: 100%;

            border: 0;
            border-radius: 10px;

            padding: 13px 16px;

            font-size: 14px;
            font-weight: 800;

            cursor: pointer;

            background: #43e397;
            color: #06110b;
        }

        .button:disabled {
            cursor: not-allowed;
            opacity: .35;
        }

        .button.secondary {
            margin-top: 10px;

            background: #171f29;
            color: #d0d8e1;

            border: 1px solid #2a3542;
        }

        .status {
            display: none;

            margin-top: 12px;
            padding: 13px;

            border-radius: 11px;

            font-size: 13px;
            line-height: 1.5;
        }

        .status.show {
            display: block;
        }

        .status.loading {
            color: #8cc6ff;
            background: rgba(78, 167, 255, .08);
            border: 1px solid rgba(78, 167, 255, .20);
        }

        .status.success {
            color: #69e9ae;
            background: rgba(77, 227, 155, .08);
            border: 1px solid rgba(77, 227, 155, .20);
        }

        .status.error {
            color: #ff8c9b;
            background: rgba(255, 95, 113, .08);
            border: 1px solid rgba(255, 95, 113, .20);
        }

        .flow {
            font-size: 13px;
            line-height: 1.8;
            color: #b4bfca;
        }

        .flow span {
            color: #fff;
            font-weight: 700;
        }

        @media (max-width: 900px) {
            .layout {
                grid-template-columns: 1fr;
                height: auto;
            }

            #map {
                height: 60vh;
            }

            .sidebar {
                border-left: 0;
                border-top: 1px solid #202a35;
            }
        }
    </style>
</head>

<body>

    <header class="header">

        <div>
            <div class="title">
                PaashuGuard · Geofence Test
            </div>

            <div class="subtitle">
                Live collar position → perimeter configuration
            </div>
        </div>

        <div class="live">
            <span class="live-dot"></span>
            LIVE COLLAR TRACKING
        </div>

    </header>


    <div class="layout">

        <div id="map"></div>


        <aside class="sidebar">

            <!-- COLLAR -->
            <div class="card">

                <div class="section-title">
                    Collar Position
                </div>

                <div id="gpsStatus" class="gps-status waiting">
                    ● Waiting for GPS
                </div>

                <div class="position">

                    <div>
                        LAT:
                        <strong id="lat">—</strong>
                    </div>

                    <div>
                        LNG:
                        <strong id="lon">—</strong>
                    </div>

                    <div>
                        SAT:
                        <strong id="sat">—</strong>
                    </div>

                    <div>
                        SPEED:
                        <strong id="speed">—</strong>
                    </div>

                </div>

                <div class="muted" style="margin-top:10px" id="lastUpdate">
                    Waiting for live telemetry...
                </div>

            </div>


            <!-- GEOFENCE -->
            <div class="card">

                <div class="section-title">
                    Create Grazing Boundary
                </div>

                <div class="muted">
                    The map is centered automatically on
                    the collar's current GPS position.
                </div>

                <div style="margin-top:15px">

                    <div class="count">
                        <span id="pointCount">0</span>
                    </div>

                    <div class="muted">
                        Boundary points
                    </div>

                </div>

                <div id="coordinates" class="coordinates">
                    Draw a polygon around the live collar.
                </div>

            </div>


            <!-- FEED -->
            <div class="card">

                <div class="section-title">
                    Collar Configuration
                </div>

                <button id="feedButton" class="button" disabled onclick="feedBoundary()">
                    FEED COORDINATES TO COLLAR
                </button>

                <button class="button secondary" onclick="clearBoundary()">
                    CLEAR TEST BOUNDARY
                </button>

                <div id="status" class="status"></div>

            </div>


            <!-- GEOFENCE STATUS -->
            <!-- This card proves the full round trip, continuously: it
                 reads straight off /telemetry, which the gateway only ever
                 marks boundary_configured=true after the collar sent back
                 ACK|BOUNDARY_OK for THIS exact boundary. If this card says
                 CONFIGURED, the coordinates are on the collar right now --
                 not just queued, not just accepted by the gateway. -->
            <div class="card">

                <div class="section-title">
                    Geofence Status (Live)
                </div>

                <div id="geofenceState" class="gps-status waiting">
                    ● NOT CONFIGURED
                </div>

                <div class="position">

                    <div>
                        POINTS ON COLLAR:
                        <strong id="geofencePoints">0</strong>
                    </div>

                    <div>
                        DISTANCE TO BOUNDARY:
                        <strong id="geofenceDistance">—</strong>
                    </div>

                </div>

                <div class="muted" style="margin-top:10px" id="geofenceUpdated">
                    Reflects the gateway's confirmed boundary, refreshed every second.
                </div>

            </div>


            <!-- FLOW -->
            <div class="card">

                <div class="section-title">
                    Test Flow
                </div>

                <div class="flow">

                    <span>1.</span>
                    Collar sends live GPS
                    <br>

                    ↓

                    <br>

                    <span>2.</span>
                    Map centers on collar
                    <br>

                    ↓

                    <br>

                    <span>3.</span>
                    Draw perimeter around collar
                    <br>

                    ↓

                    <br>

                    <span>4.</span>
                    Feed coordinates to gateway
                    <br>

                    ↓

                    <br>

                    <span>5.</span>
                    Gateway → LoRa → collar
                    <br>

                    ↓

                    <br>

                    <span>6.</span>
                    Collar stores boundary
                    <br>

                    ↓

                    <br>

                    <strong>7. GEOFENCING ACTIVE</strong>

                </div>

            </div>

        </aside>

    </div>


    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js">
    </script>

    <script src="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js">
    </script>


    <script>

        // =========================================================
        // API
        // =========================================================
        // Gateway API.
        // The test page may run from localhost:8000.

        // =========================================================
        // MAP
        // =========================================================

        const map =
            L.map("map");


        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        ).addTo(map);


        map.setView(
            [13.0734, 77.5892],
            15
        );


        // =========================================================
        // KEEP LEAFLET'S SIZE HONEST
        // =========================================================
        // Leaflet measures its container ONCE, when the map is created, and
        // never re-measures on its own. #map is sized with vh/grid units
        // (60vh on the mobile layout), and mobile browsers change the real
        // viewport height under your feet as the address bar shows and
        // hides on scroll -- especially right after updateCollar() below
        // animates the very first pan/zoom to the collar. When that
        // happens, Leaflet keeps rendering into its stale cached size: the
        // map area goes blank or half-cut until *something* forces a
        // re-measure, which is exactly the "vanishes for a bit, then comes
        // back on its own" pattern. invalidateSize() is that re-measure --
        // wired to every event that can change the container's real size.

        function fixMapSize() {
            map.invalidateSize(
                false
            );
        }

        window.addEventListener(
            "resize",
            fixMapSize
        );

        window.addEventListener(
            "orientationchange",
            function () {
                setTimeout(fixMapSize, 250);
            }
        );

        document.addEventListener(
            "visibilitychange",
            function () {
                if (!document.hidden) {
                    fixMapSize();
                }
            }
        );

        // Catches the very first paint, before any resize event has fired --
        // covers the case where #map settled into its final size a beat
        // after Leaflet's own first measurement (webfonts / CSS still
        // applying, mobile chrome still collapsing its address bar).
        window.addEventListener(
            "load",
            function () {
                setTimeout(fixMapSize, 300);
            }
        );


        // =========================================================
        // DRAWING
        // =========================================================

        const drawnItems =
            new L.FeatureGroup();

        map.addLayer(
            drawnItems
        );


        const drawControl =
            new L.Control.Draw({

                draw: {

                    polygon: {
                        allowIntersection: false,
                        showArea: true
                    },

                    rectangle: true,

                    polyline: false,
                    circle: false,
                    circlemarker: false,
                    marker: false

                },

                edit: {
                    featureGroup: drawnItems
                }

            });


        map.addControl(
            drawControl
        );


        let currentPolygon =
            null;


        // =========================================================
        // LIVE COLLAR MARKER
        // =========================================================

        let collarMarker =
            null;


        let collarAccuracyCircle =
            null;


        let initialCenterDone =
            false;


        let collarRequestInFlight =
            false;


        let commandStatusRequestInFlight =
            false;


        const LAST_POSITION_KEY =
            "paashuguard.lastPosition";


        const BOUNDARY_DRAFT_KEY =
            "paashuguard.boundaryDraft";


        function restoreLastPosition() {

            try {

                const saved = JSON.parse(
                    sessionStorage.getItem(
                        LAST_POSITION_KEY
                    )
                );


                if (!saved || !Number.isFinite(saved.lat) ||
                    !Number.isFinite(saved.lon)) {
                    return;
                }


                const position = [saved.lat, saved.lon];

                collarMarker = L.marker(position).addTo(map);

                collarMarker.bindPopup(
                    "<strong>COLLAR-001</strong><br>" +
                    "Last known GPS position"
                );

                map.setView(position, 17);
                initialCenterDone = true;

            } catch (error) {
                // No valid cached position yet.
            }
        }


        function restoreBoundaryDraft() {

            try {

                const raw = localStorage.getItem(
                    BOUNDARY_DRAFT_KEY
                );

                if (!raw) {
                    return;
                }

                const points = JSON.parse(raw)
                    .filter(
                        point => Number.isFinite(point.lat) &&
                        Number.isFinite(point.lng)
                    );

                if (points.length < 3) {
                    return;
                }

                currentPolygon = L.polygon(points);
                drawnItems.addLayer(currentPolygon);
                updateCoordinates();

            } catch (error) {
                localStorage.removeItem(BOUNDARY_DRAFT_KEY);
            }
        }


        async function loadConfirmedBoundary() {

            // Prefer the collar-confirmed copy held by the gateway.  This
            // makes the configured polygon visible from a fresh browser too,
            // not only from the browser that originally drew it.
            if (currentPolygon) {
                return;
            }

            try {

                const response = await fetch(
                    "/boundary-status?_=" + Date.now(),
                    { cache: "no-store" }
                );

                if (!response.ok) {
                    return;
                }

                const boundary = await response.json();

                if (!boundary.configured || !boundary.coordinates) {
                    return;
                }

                const points = boundary.coordinates
                    .split(";")
                    .map(
                        coordinate => {
                            const [lat, lng] = coordinate.split(",");
                            return {
                                lat: Number(lat),
                                lng: Number(lng)
                            };
                        }
                    )
                    .filter(
                        point => Number.isFinite(point.lat) &&
                        Number.isFinite(point.lng)
                    );

                if (points.length < 3) {
                    return;
                }

                currentPolygon = L.polygon(points);
                drawnItems.addLayer(currentPolygon);
                updateCoordinates();

            } catch (error) {
                // The live marker can still work if this optional restore fails.
            }
        }


        // =========================================================
        // POLYGON CREATE
        // =========================================================

        map.on(
            L.Draw.Event.CREATED,
            function (event) {

                drawnItems.clearLayers();

                currentPolygon =
                    event.layer;

                drawnItems.addLayer(
                    currentPolygon
                );

                updateCoordinates();

            }
        );


        // =========================================================
        // POLYGON EDIT
        // =========================================================

        map.on(
            L.Draw.Event.EDITED,
            function () {

                updateCoordinates();

            }
        );


        map.on(
            L.Draw.Event.DELETED,
            function () {

                currentPolygon = null;
                updateCoordinates();

            }
        );


        // =========================================================
        // UPDATE COORDINATES
        // =========================================================

        function updateCoordinates() {

            if (!currentPolygon) {

                localStorage.removeItem(
                    BOUNDARY_DRAFT_KEY
                );

                document.getElementById(
                    "pointCount"
                ).innerText = "0";

                document.getElementById(
                    "coordinates"
                ).innerHTML =
                    "Draw a polygon around the live collar.";

                document.getElementById(
                    "feedButton"
                ).disabled = true;

                return;
            }


            const points =
                currentPolygon.getLatLngs()[0];


            localStorage.setItem(
                BOUNDARY_DRAFT_KEY,
                JSON.stringify(points)
            );


            document.getElementById(
                "pointCount"
            ).innerText =
                points.length;


            let html = "";


            points.forEach(
                (point, index) => {

                    html += `
          <div class="coordinate-row">
            P${index + 1}
            →
            ${point.lat.toFixed(6)},
            ${point.lng.toFixed(6)}
          </div>
        `;

                }
            );


            document.getElementById(
                "coordinates"
            ).innerHTML =
                html;


            document.getElementById(
                "feedButton"
            ).disabled =
                points.length < 3;
        }


        // =========================================================
        // GET LIVE COLLAR TELEMETRY
        // =========================================================

        async function updateCollar() {

            if (collarRequestInFlight) {
                return;
            }

            collarRequestInFlight = true;

            try {

                const response =
                    await fetch(
                        "/telemetry?_=" +
                        Date.now(),
                        {
                            cache: "no-store"
                        }
                    );


                if (!response.ok) {
                    throw new Error(
                        "Gateway telemetry unavailable."
                    );
                }


                const data =
                    await response.json();


                const lat =
                    Number(data.latitude);

                const lon =
                    Number(data.longitude);

                const sats =
                    Number(data.satellites);


                document.getElementById(
                    "lat"
                ).innerText =
                    Number.isFinite(lat)
                        ? lat.toFixed(6)
                        : "—";


                document.getElementById(
                    "lon"
                ).innerText =
                    Number.isFinite(lon)
                        ? lon.toFixed(6)
                        : "—";


                document.getElementById(
                    "sat"
                ).innerText =
                    sats;


                document.getElementById(
                    "speed"
                ).innerText =
                    Number(data.speed).toFixed(2)
                    + " km/h";


                document.getElementById(
                    "lastUpdate"
                ).innerText =
                    "Live update · " +
                    new Date().toLocaleTimeString();


                // -------------------------------------------------------
                // GEOFENCE STATUS -- proves the round trip on every tick.
                //
                // boundary_configured only flips true on the GATEWAY after
                // processPendingCommand() saw an actual ACK|BOUNDARY_OK come
                // back over LoRa for the boundary you just fed (see
                // handleSetBoundary / processPendingCommand in the .ino).
                // So this block reading true is independent proof the
                // coordinates made it: browser -> gateway -> LoRa -> collar
                // -> LoRa -> gateway -> this /telemetry response.
                // -------------------------------------------------------

                const geofenceState =
                    document.getElementById(
                        "geofenceState"
                    );

                const configured =
                    data.boundary_configured === true;

                const pointCount =
                    Number(data.boundary_point_count) || 0;

                const boundaryDistance =
                    Number(data.boundary_distance);


                document.getElementById(
                    "geofencePoints"
                ).innerText =
                    pointCount;


                if (configured) {

                    geofenceState.className =
                        "gps-status";

                    geofenceState.innerText =
                        "● CONFIGURED · LIVE ON COLLAR";

                    document.getElementById(
                        "geofenceDistance"
                    ).innerText =
                        Number.isFinite(boundaryDistance) &&
                        boundaryDistance >= 0
                            ? boundaryDistance.toFixed(1) + " m"
                            : "—";

                } else {

                    geofenceState.className =
                        "gps-status waiting";

                    geofenceState.innerText =
                        "● NOT CONFIGURED";

                    document.getElementById(
                        "geofenceDistance"
                    ).innerText =
                        "—";
                }


                document.getElementById(
                    "geofenceUpdated"
                ).innerText =
                    "Confirmed by collar · " +
                    new Date().toLocaleTimeString();


                // -------------------------------------------------------
                // GPS FIX
                // -------------------------------------------------------

                const validGPS =
                    Number.isFinite(lat) &&
                    Number.isFinite(lon) &&
                    lat !== 0 &&
                    lon !== 0 &&
                    sats > 0;


                const gpsStatus =
                    document.getElementById(
                        "gpsStatus"
                    );


                if (!validGPS) {

                    gpsStatus.className =
                        "gps-status waiting";

                    gpsStatus.innerText =
                        "● Waiting for GPS fix";

                    return;
                }


                sessionStorage.setItem(
                    LAST_POSITION_KEY,
                    JSON.stringify({ lat, lon, sats })
                );


                gpsStatus.className =
                    "gps-status";

                gpsStatus.innerText =
                    "● GPS FIX · COLLAR ONLINE";


                // -------------------------------------------------------
                // UPDATE LIVE MARKER
                // -------------------------------------------------------

                const position =
                    [lat, lon];


                if (!collarMarker) {

                    collarMarker =
                        L.marker(
                            position
                        ).addTo(map);


                    collarMarker.bindPopup(
                        "<strong>COLLAR-001</strong><br>" +
                        "Live GPS position"
                    );


                } else {

                    collarMarker.setLatLng(
                        position
                    );

                }


                // -------------------------------------------------------
                // CENTER MAP ON COLLAR
                // -------------------------------------------------------

                if (
                    !initialCenterDone
                ) {

                    map.setView(
                        position,
                        17,
                        {
                            animate: true
                        }
                    );

                    initialCenterDone =
                        true;
                }


            }
            catch (error) {

                document.getElementById(
                    "gpsStatus"
                ).className =
                    "gps-status waiting";


                document.getElementById(
                    "gpsStatus"
                ).innerText =
                    collarMarker
                        ? "● Connection delayed · showing last GPS"
                        : "● Gateway unavailable";
            }

            finally {

                collarRequestInFlight = false;
            }

        }


        // =========================================================
        // FEED BOUNDARY
        // =========================================================

        async function feedBoundary() {

            if (!currentPolygon) {
                return;
            }


            const points =
                currentPolygon
                    .getLatLngs()[0];


            if (
                points.length < 3
            ) {

                showStatus(
                    "error",
                    "At least 3 points are required."
                );

                return;
            }


            const coordinates =
                points
                    .map(
                        point =>
                            `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`
                    )
                    .join(";");


            const url =
                "/set-boundary?data=" +
                encodeURIComponent(
                    coordinates
                );


            showStatus(
                "loading",
                "⟳ Feeding boundary coordinates to gateway..."
            );


            try {

                const response =
                    await fetch(
                        url,
                        {
                            method: "GET",
                            cache: "no-store"
                        }
                    );


                const text =
                    await response.text();


                if (
                    !response.ok
                ) {

                    throw new Error(
                        text ||
                        "Gateway rejected request."
                    );
                }


                showStatus(
                    "loading",
                    "✓ Gateway received coordinates.<br>" +
                    "⟳ Waiting for collar acknowledgement..."
                );


                waitForBoundaryAck();


            }
            catch (error) {

                showStatus(
                    "error",
                    "✕ Could not send coordinates.<br><br>" +
                    error.message
                );
            }

        }


        // =========================================================
        // WAIT FOR COLLAR ACK
        // =========================================================

        function waitForBoundaryAck() {

            let attempts = 0;

            const timer =
                setInterval(
                    async () => {

                        if (commandStatusRequestInFlight) {
                            return;
                        }

                        commandStatusRequestInFlight = true;
                        attempts++;


                        try {

                            const response =
                                await fetch(
                                    "/command-status?_=" +
                                    Date.now(),
                                    {
                                        cache: "no-store"
                                    }
                                );


                            if (!response.ok) {
                                return;
                            }


                            const result =
                                await response.json();


                            if (
                                result.last_result ===
                                "ACK|BOUNDARY_OK"
                            ) {

                                clearInterval(
                                    timer
                                );


                                showStatus(
                                    "success",
                                    "<strong>✓ COORDINATES FED</strong><br><br>" +
                                    "Collar acknowledged the boundary.<br>" +
                                    "<strong>✓ GEOFENCING ACTIVE</strong>"
                                );

                                return;
                            }


                            if (
                                result.last_result ===
                                "ACK|BOUNDARY_FAIL"
                            ) {

                                clearInterval(
                                    timer
                                );


                                showStatus(
                                    "error",
                                    "<strong>✕ COLLAR REJECTED BOUNDARY</strong>"
                                );

                                return;
                            }


                            if (
                                result.last_result ===
                                "TIMEOUT"
                            ) {

                                clearInterval(
                                    timer
                                );


                                showStatus(
                                    "error",
                                    "<strong>✕ COLLAR TIMEOUT</strong><br><br>" +
                                    "No acknowledgement received."
                                );

                                return;
                            }


                        }
                        catch (error) {
                            // Continue polling.
                        }

                        finally {
                            commandStatusRequestInFlight = false;
                        }


                        if (
                            attempts >= 15
                        ) {

                            clearInterval(
                                timer
                            );


                            showStatus(
                                "error",
                                "No acknowledgement received from collar."
                            );
                        }

                    },
                    500
                );

        }


        // =========================================================
        // CLEAR
        // =========================================================

        async function clearBoundary() {

            try {

                const response = await fetch(
                    "/clear-boundary?_=" +
                    Date.now(),
                    {
                        cache: "no-store"
                    }
                );

                if (!response.ok) {
                    throw new Error(
                        "Gateway rejected clear command."
                    );
                }


                showStatus(
                    "loading",
                    "⟳ Waiting for collar to clear the boundary..."
                );

                waitForClearAck();

            }
            catch (error) {

                showStatus(
                    "error",
                    "Could not contact gateway."
                );
            }

        }


        function waitForClearAck() {

            let attempts = 0;

            const timer = setInterval(
                async () => {

                    if (commandStatusRequestInFlight) {
                        return;
                    }

                    commandStatusRequestInFlight = true;
                    attempts++;

                    try {

                        const response = await fetch(
                            "/command-status?_=" + Date.now(),
                            { cache: "no-store" }
                        );

                        const result = await response.json();

                        if (result.last_result === "ACK|BOUNDARY_CLEARED") {

                            clearInterval(timer);
                            drawnItems.clearLayers();
                            currentPolygon = null;
                            updateCoordinates();

                            showStatus(
                                "success",
                                "<strong>✓ BOUNDARY CLEARED</strong><br><br>" +
                                "The collar confirmed the removal."
                            );

                            return;
                        }

                        if (result.last_result === "TIMEOUT") {

                            clearInterval(timer);
                            showStatus(
                                "error",
                                "<strong>✕ COLLAR TIMEOUT</strong><br><br>" +
                                "The existing boundary was kept."
                            );

                            return;
                        }

                    } catch (error) {
                        // Keep checking until the bounded retry window expires.
                    } finally {
                        commandStatusRequestInFlight = false;
                    }

                    if (attempts >= 15) {

                        clearInterval(timer);
                        showStatus(
                            "error",
                            "No clear acknowledgement received; the existing boundary was kept."
                        );
                    }

                },
                500
            );
        }


        // =========================================================
        // STATUS MESSAGE
        // =========================================================

        function showStatus(
            type,
            message
        ) {

            const box =
                document.getElementById(
                    "status"
                );


            box.className =
                "status show " +
                type;


            box.innerHTML =
                message;
        }


        // =========================================================
        // START LIVE TELEMETRY
        // =========================================================

        restoreLastPosition();

        restoreBoundaryDraft();

        loadConfirmedBoundary();

        // Force one re-measure right after the cached marker/boundary set
        // the initial view -- the map was very likely created a frame
        // before the browser finished laying out #map at its real size.
        fixMapSize();

        updateCollar();

        setInterval(
            updateCollar,
            1000
        );

    </script>

</body>

</html>
)GEOPAGE";

void handleGeofence() {

  server.send_P(
    200,
    "text/html",
    GEOFENCE_HTML
  );
}

// ============================================================
// CLOUD BRIDGE — TELEMETRY OUT, ZONE COMMANDS IN
//
// One HTTPS round trip to Herdwise's existing ingest endpoint. It runs the
// SAME risk engine the app trusts everywhere else, so nothing about "nearing
// the perimeter" or "near a road" is recomputed or duplicated here -- this
// function's only job is getting a real fix there and a command back.
//
// Cadence is server-decided, not fixed. The ingest response carries
// next_interval_s (5 s when something is actually happening, up to 600 s when
// she's idle and safe) -- exactly the "only really check in when it matters"
// behaviour, already built, already tested, reused rather than reinvented
// with a second throttling scheme on this side.
//
// This is a SEPARATE, slower timer from the 1 Hz local LoRa loop above, and
// nothing here ever actuates the collar directly -- only the local loop does
// that. Honest caveat: the HTTPS POST is blocking (ESP32 Arduino has no
// built-in async HTTP client), so while it is in flight -- at most once per
// its own 15-900 s interval, typically well under a second on decent WiFi --
// the NEXT local LoRa poll is delayed by that same amount rather than firing
// exactly on its 1 Hz tick. It never runs while a LoRa command is already in
// flight (guarded in loop()). For one collar on a demo, that occasional
// sub-second jitter in the reporting cadence is an acceptable trade against
// the real complexity of a second FreeRTOS core just to avoid it; if this
// becomes a multi-collar or safety-certified deployment, this is the first
// thing to move onto its own pinned task. If WiFi or Supabase is unreachable,
// cloudCheckin() simply fails quietly and tries again next interval.
// ============================================================

unsigned long lastCloudCheckin = 0;
unsigned long cloudIntervalMs = 15000;   // conservative default before the
                                          // first real server response

/** True once NTP has produced a plausible wall-clock time. */
bool timeIsSynced() {

  time_t now;
  time(&now);

  // Before sync, ESP32 epoch time reads near 1970 -- anything before
  // year 2024 (1704067200) means "not synced yet".
  return now > 1704067200;
}

/** ISO 8601 UTC, e.g. 2026-08-21T02:14:05Z. Real time, never fabricated. */
String nowIso8601() {

  time_t now;
  time(&now);

  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);

  char buf[25];

  strftime(
    buf,
    sizeof(buf),
    "%Y-%m-%dT%H:%M:%SZ",
    &timeinfo
  );

  return String(buf);
}

/**
 * The collar's TEL packet (parsed into the globals above) carries satellite
 * count but not raw HDOP -- the LoRa protocol was never extended to send it,
 * and extending it now would mean reflashing the safety-critical link to
 * satisfy a reporting field. This derives a conservative, honestly-labelled
 * proxy instead of inventing a precise-looking number: few satellites reads
 * as a poor fix, which is the side that matters (the ingest endpoint's own
 * GPS veto only ever gets MORE cautious from an overstated hdop, never less).
 */
void deriveFixQuality(
  int &fixQuality,
  double &hdopEstimate
) {

  if (
    collarSatellites >= 7
  ) {

    fixQuality = 3;
    hdopEstimate = 1.0;

  } else if (
    collarSatellites >= 5
  ) {

    fixQuality = 2;
    hdopEstimate = 2.5;

  } else if (
    collarSatellites >= 3
  ) {

    // 3-4 satellites is a real, usable 2D fix -- not great, but not the
    // "cannot see the sky" case either. Grading it into the worst tier
    // (fixQuality 1 / hdop 8.0) made the cloud veto every single reading
    // from a collar sitting under partial sky cover, which is the normal
    // case outdoors near a building or tree line, not a fault.
    fixQuality = 2;
    hdopEstimate = 4.0;

  } else {

    fixQuality = 1;
    hdopEstimate = 8.0;
  }
}

/** 0 still, 1 grazing, 2 walking, 3 running -- same bands used everywhere
    else in this codebase that classifies speed into a movement state. */
int deriveMovementState() {

  if (collarSpeed < 0.2) return 0;
  if (collarSpeed < 1.5) return 1;
  if (collarSpeed < 5.0) return 2;
  return 3;
}

/**
 * Pull the numeric value of a top-level JSON field by name. Hand-rolled, not
 * a JSON library -- the response shape is fixed and small, and every other
 * parser in this file already reads packets the same way (indexOf +
 * substring), so this stays consistent with the rest of the firmware rather
 * than adding a new dependency for one field.
 */
long extractJsonNumber(
  const String &json,
  const String &key,
  long fallback
) {

  String needle = "\"" + key + "\":";
  int at = json.indexOf(needle);

  if (at < 0) {
    return fallback;
  }

  int start = at + needle.length();
  int end = start;

  while (
    end < (int) json.length() &&
    (isDigit(json[end]) || json[end] == '-')
  ) {

    end++;
  }

  if (end == start) {
    return fallback;
  }

  return json.substring(start, end).toInt();
}

/**
 * Downsample a ring to at most `maxPoints`, even stride, first point kept.
 *
 * The farmer can draw with as many vertices as she likes in the app -- a
 * circle alone exports as 33 points (verified against the live zone). LoRa's
 * packet ceiling and the collar's fixed-size boundary array cannot hold that,
 * so the shape is simplified here, at the bridge, rather than silently
 * failing on the collar or lying about "any number of points" reaching real
 * hardware unchanged.
 */
int downsampleRing(
  double srcLat[],
  double srcLon[],
  int srcCount,
  double outLat[],
  double outLon[],
  int maxPoints
) {

  if (srcCount <= maxPoints) {

    for (int i = 0; i < srcCount; i++) {
      outLat[i] = srcLat[i];
      outLon[i] = srcLon[i];
    }

    return srcCount;
  }

  int kept = 0;

  for (int i = 0; i < maxPoints; i++) {

    int srcIndex = (int) ((long) i * srcCount / maxPoints);

    outLat[kept] = srcLat[srcIndex];
    outLon[kept] = srcLon[srcIndex];
    kept++;
  }

  return kept;
}

/**
 * Parse `"ring":[[lat,lon],[lat,lon],...]` out of a command's payload and
 * apply it as the new fence, through the exact same submitBoundary() path
 * the local test page uses -- same validation, same LoRa transaction, same
 * ACK-before-commit rule.
 */
void applySetZoneCommand(
  const String &json,
  int fromIndex
) {

  int ringAt =
    json.indexOf(
      "\"ring\"",
      fromIndex
    );

  if (ringAt < 0) {
    Serial.println(
      "set_zone: no ring field, ignored."
    );
    return;
  }

  int arrayStart =
    json.indexOf(
      '[',
      ringAt
    );

  if (arrayStart < 0) {
    return;
  }

  const int MAX_RING_SOURCE = 300;

  double srcLat[MAX_RING_SOURCE];
  double srcLon[MAX_RING_SOURCE];
  int srcCount = 0;

  int cursor = arrayStart + 1;

  while (
    srcCount < MAX_RING_SOURCE
  ) {

    int pairStart =
      json.indexOf(
        '[',
        cursor
      );

    int arrayEnd =
      json.indexOf(
        ']',
        cursor
      );

    // The outer ring array closes before another point pair opens.
    if (
      pairStart < 0 ||
      (arrayEnd >= 0 && arrayEnd < pairStart)
    ) {
      break;
    }

    int comma =
      json.indexOf(
        ',',
        pairStart
      );

    int pairEnd =
      json.indexOf(
        ']',
        pairStart
      );

    if (
      comma < 0 ||
      pairEnd < 0 ||
      comma > pairEnd
    ) {
      break;
    }

    srcLat[srcCount] =
      json.substring(
        pairStart + 1,
        comma
      ).toDouble();

    srcLon[srcCount] =
      json.substring(
        comma + 1,
        pairEnd
      ).toDouble();

    srcCount++;
    cursor = pairEnd + 1;
  }

  if (srcCount < 3) {
    Serial.printf(
      "set_zone: only %d points parsed, ignored.\n",
      srcCount
    );
    return;
  }

  double outLat[8];
  double outLon[8];

  int kept =
    downsampleRing(
      srcLat,
      srcLon,
      srcCount,
      outLat,
      outLon,
      8
    );

  String data = "";

  for (int i = 0; i < kept; i++) {

    if (i > 0) {
      data += ";";
    }

    // 4 decimal places = ~11 m accuracy, acceptable for farm boundaries.
    // 6dp made the LoRa packet 178 chars — too long for SF10/BW125 (≈128-byte
    // practical limit), so only the first 3 points survived and a circle
    // became a triangle, placing the cow outside its own fence.
    data += String(outLat[i], 4);
    data += ",";
    data += String(outLon[i], 4);
  }

  Serial.printf(
    "set_zone: applying %d of %d points (downsampled).\n",
    kept,
    srcCount
  );

  BoundarySubmitStatus status =
    submitBoundary(
      data
    );

  if (
    status == BOUNDARY_BUSY
  ) {

    // The gateway's one in-flight slot was already taken -- most likely by
    // another set_zone or a beep that arrived in the same check-in batch.
    // Without this, this newer zone would be silently discarded forever
    // (the server already marked it delivered the moment it appeared in
    // this response), leaving the collar guarding a stale, possibly much
    // larger or differently-shaped fence than the one the farmer just drew.
    Serial.println(
      "set_zone: gateway busy, queued to retry."
    );

    cloudBacklogPush(
      data,
      "SET_BOUNDARY_DATA"
    );

  } else if (status != BOUNDARY_QUEUED) {

    Serial.printf(
      "set_zone: submitBoundary rejected it, status=%d.\n",
      (int) status
    );
  }
}

/**
 * "Make it beep" from the app -- lands here as `{"command":"locate",
 * "payload":{"seconds":N}}`. Queued onto the same LoRa channel as every
 * other collar command (not sent inline) so it never collides with a
 * boundary push already in flight.
 */
void applyLocateCommand(
  const String &json,
  int fromIndex
) {

  long seconds =
    extractJsonNumber(
      json,
      "seconds",
      3
    );

  if (seconds < 1) {
    seconds = 1;
  }

  if (seconds > 60) {
    seconds = 60;
  }

  // Pushed onto the backlog, not sent directly -- a set_zone command
  // arriving in the same check-in response used to grab the gateway's one
  // in-flight slot first and silently eat every beep behind it, since a
  // command already popped from the server can never be retried. The
  // backlog guarantees this one still gets sent, just after whatever was
  // ahead of it finishes.
  cloudBacklogPush(
    "CMD|BEEP|" + String(seconds),
    "BEEP"
  );
}

/** Scan the response's `commands` array for any `set_zone` / `locate`
    entries and apply each in turn -- if several queued up while the gateway
    was offline, the last set_zone applied is the one that ends up active,
    which is what "the farmer's current fence" means. */
void applyCloudCommands(
  const String &json
) {

  int cursor = 0;

  while (true) {

    int at =
      json.indexOf(
        "\"command\":\"set_zone\"",
        cursor
      );

    if (at < 0) {
      break;
    }

    applySetZoneCommand(
      json,
      at
    );

    cursor = at + 1;
  }

  cursor = 0;

  while (true) {

    int at =
      json.indexOf(
        "\"command\":\"locate\"",
        cursor
      );

    if (at < 0) {
      at =
        json.indexOf(
          "\"command\":\"beep\"",
          cursor
        );
    }

    if (at < 0) {
      break;
    }

    applyLocateCommand(
      json,
      at
    );

    cursor = at + 1;
  }
}

/**
 * One HTTPS POST, fire and forget from the safety loop's point of view.
 *
 * Skips silently (not an error) whenever there is nothing worth sending
 * yet: no WiFi, no time sync, or the collar has never reported in. Each of
 * those resolves itself (WiFi reconnects, NTP syncs, the 1 Hz LoRa loop above
 * keeps polling the collar) so the next scheduled call simply tries again.
 */
void cloudCheckin() {

  if (
    WiFi.status() != WL_CONNECTED
  ) {
    return;
  }

  if (
    !timeIsSynced()
  ) {
    return;
  }

  if (
    !collarOnline
  ) {
    return;
  }

  int fixQuality;
  double hdopEstimate;

  deriveFixQuality(
    fixQuality,
    hdopEstimate
  );

  String body = "{";
  body += "\"device_id\":\"" + String(CLOUD_DEVICE_ID) + "\",";
  body += "\"animal_id\":\"\",";           // ingest resolves this from device_id
  body += "\"lat\":" + String(collarLat, 6) + ",";
  body += "\"lon\":" + String(collarLon, 6) + ",";
  body += "\"speed_kmh\":" + String(collarSpeed, 2) + ",";
  
  // Clamp absurd headings (e.g. 174225.0) from the GPS to prevent Postgres
  // smallint overflow which crashes the ingest endpoint and breaks the sync.
  int clampedHeading = ((int)collarHeading % 360 + 360) % 360;
  body += "\"heading_deg\":" + String(clampedHeading) + ",";
  
  body += "\"fix_quality\":" + String(fixQuality) + ",";
  body += "\"hdop\":" + String(hdopEstimate, 1) + ",";
  body += "\"sats\":" + String(collarSatellites) + ",";
  // No battery sense pin on the collar yet -- this is a placeholder, not a
  // measurement, and stays clearly labelled as one here rather than in the
  // app, which cannot tell the difference once it arrives.
  body += "\"battery_pct\":85,";
  body += "\"movement_state\":" + String(deriveMovementState()) + ",";
  body += "\"event_code\":0,";
  body += "\"seq\":" + String((unsigned long) telemetrySequence) + ",";
  body += "\"recorded_at\":\"" + nowIso8601() + "\"";
  body += "}";

  WiFiClientSecure client;
  client.setInsecure();   // Supabase's cert chain isn't pinned on-device;
                          // acceptable for a single demo collar on the
                          // gateway's own trusted WiFi.

  HTTPClient https;

  if (
    !https.begin(
      client,
      SUPABASE_INGEST_URL
    )
  ) {

    Serial.println(
      "cloudCheckin: begin() failed."
    );

    return;
  }

  https.addHeader(
    "Content-Type",
    "application/json"
  );

  https.addHeader(
    "x-device-secret",
    DEVICE_INGEST_SECRET
  );

  https.setTimeout(5000);

  int code =
    https.POST(
      body
    );

  if (
    code > 0
  ) {

    String response =
      https.getString();

    Serial.printf(
      "cloudCheckin: HTTP %d\n",
      code
    );

    if (
      code == 200
    ) {

      long nextS =
        extractJsonNumber(
          response,
          "next_interval_s",
          15
        );

      // Clamp defensively -- a malformed or unexpected response must never
      // make the gateway hammer the endpoint or go silent for an hour.
      if (nextS < 3) nextS = 3;
      if (nextS > 900) nextS = 900;

      cloudIntervalMs = (unsigned long) nextS * 1000UL;

      applyCloudCommands(
        response
      );

    } else {

      Serial.println(
        response
      );
    }

  } else {

    Serial.printf(
      "cloudCheckin: POST failed, error %d (%s)\n",
      code,
      https.errorToString(code).c_str()
    );
  }

  https.end();
}

void setupWebServer() {

  server.on(
    "/",
    HTTP_GET,
    handleRoot
  );

  server.on(
    "/geofence",
    HTTP_GET,
    handleGeofence
  );

  server.on(
    "/ping",
    HTTP_GET,
    handlePing
  );

  server.on(
    "/status",
    HTTP_GET,
    handleStatus
  );

  server.on(
    "/telemetry",
    HTTP_GET,
    handleTelemetry
  );

  server.on(
    "/command-status",
    HTTP_GET,
    handleCommandStatus
  );

  server.on(
    "/boundary-status",
    HTTP_GET,
    handleBoundaryStatus
  );

  server.on(
    "/set-boundary",
    HTTP_GET,
    handleSetBoundary
  );

  server.on(
    "/sync",
    HTTP_POST,
    handleSync
  );

  server.on(
    "/set-road",
    HTTP_GET,
    handleSetRoad
  );

  server.on(
    "/clear-boundary",
    HTTP_GET,
    handleClearBoundary
  );

  // Allow the localhost test page to call the gateway API.
  server.enableCORS(true);

  server.begin();

  Serial.println(
    "HTTP server started ✓"
  );
}

// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(
    115200
  );

  delay(2500);

  Serial.println();
  Serial.println(
    "============================================"
  );

  loadGatewayBoundary();

  Serial.println(
    "       PAASHUGUARD — BOARD B"
  );

  Serial.println(
    "       GATEWAY"
  );

  Serial.println(
    "============================================"
  );

  // ----------------------------------------------------------
  // WIFI
  // ----------------------------------------------------------

  connectWiFi();

  // ----------------------------------------------------------
  // LORA
  // ----------------------------------------------------------

  if (
    !setupLoRa()
  ) {

    Serial.println(
      "Stopping: LoRa initialization failed."
    );

    while (true) {
      delay(1000);
    }
  }

  // ----------------------------------------------------------
  // HTTP
  // ----------------------------------------------------------

  if (
    WiFi.status() ==
    WL_CONNECTED
  ) {

    setupWebServer();

    Serial.println();

    Serial.print(
      "Live dashboard: http://"
    );

    Serial.print(
      WiFi.localIP()
    );

    Serial.println("/");
  }

  Serial.println();
  Serial.println(
    "GATEWAY READY ✓"
  );
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {

  // ----------------------------------------------------------
  // Keep HTTP responsive.
  // ----------------------------------------------------------

  serviceWebClients();

  // Move one backlogged cloud command (a beep behind a boundary push, say)
  // into the single in-flight slot once it is free. A no-op almost every
  // tick -- the backlog is empty outside of that specific collision.
  cloudBacklogDrain();

  // ----------------------------------------------------------
  // Handle explicitly queued commands first.
  // ----------------------------------------------------------

  if (
    pendingCommand.length() > 0 &&
    !commandBusy
  ) {

    processPendingCommand();

    return;
  }

  // ----------------------------------------------------------
  // Continuous 1 Hz collar telemetry.
  // ----------------------------------------------------------

  if (
    millis() -
    lastTelemetryRequest >=
    TELEMETRY_INTERVAL
  ) {

    lastTelemetryRequest =
      millis();

    requestTelemetry();
  }

  // ----------------------------------------------------------
  // Collar timeout.
  // ----------------------------------------------------------

  if (
    lastCollarSeen > 0 &&
    millis() -
    lastCollarSeen >
    COLLAR_TIMEOUT
  ) {

    collarOnline =
      false;
  }

  // ----------------------------------------------------------
  // Cloud check-in -- Herdwise, not the collar.
  //
  // Only when nothing LoRa-related is pending or in flight, so a blocking
  // HTTPS call can never push out a queued SET_BOUNDARY or delay the collar
  // seeing it. Cadence is cloudIntervalMs, set by the server's own
  // next_interval_s from the last response (see cloudCheckin() above).
  // ----------------------------------------------------------

  if (
    pendingCommand.length() == 0 &&
    !commandBusy &&
    millis() -
    lastCloudCheckin >=
    cloudIntervalMs
  ) {

    lastCloudCheckin =
      millis();

    cloudCheckin();
  }

  delay(5);
}
