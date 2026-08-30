#define MODEM_TX_PIN 6      // ESP32 pin wired to modem's TX -> ESP32 receives here
#define MODEM_RX_PIN 7      // ESP32 pin wired to modem's RX -> ESP32 sends here
#define MODEM_PWRKEY 4

HardwareSerial modem(1);

void setup() {
  Serial.begin(115200);
  delay(2000);

  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(100);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, HIGH);

  Serial.println("Waiting for modem to boot...");
  delay(5000);

  // HardwareSerial.begin(baud, config, RX_pin, TX_pin)
  modem.begin(115200, SERIAL_8N1, MODEM_TX_PIN, MODEM_RX_PIN);
  Serial.println("=== EC200U RAW TEST ===");
  Serial.println("Type AT and press enter");
}

void loop() {
  while (modem.available()) Serial.write(modem.read());
  while (Serial.available()) modem.write(Serial.read());
}