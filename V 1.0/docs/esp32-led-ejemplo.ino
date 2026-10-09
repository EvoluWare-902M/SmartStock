/* SmartStock · ejemplo para ESP32 (HU-3: activación de luces LED)
   Consulta cada segundo el estado del LED de la sucursal y enciende el
   LED correspondiente de una tira WS2812 (NeoPixel) de 24 posiciones
   (4 filas x 6 columnas, igual que el plano del anaquel en la app).

   Librerías: Adafruit NeoPixel, ArduinoJson.                              */
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

const char* WIFI_SSID  = "TU_RED";
const char* WIFI_PASS  = "TU_CLAVE";
const char* API_URL    = "http://192.168.1.50:3000/api/iot/led/1";   // IP de la PC con SmartStock, sucursal 1
const char* IOT_TOKEN  = "smartstock-iot-demo";                      // igual que IOT_TOKEN en .env

const int PIN_LEDS = 5, COLUMNAS = 6, TOTAL = 24;
Adafruit_NeoPixel tira(TOTAL, PIN_LEDS, NEO_GRB + NEO_KHZ800);

void setup() {
  tira.begin(); tira.show();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
}

void loop() {
  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("X-IoT-Token", IOT_TOKEN);
  tira.clear();
  if (http.GET() == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    if (doc["encendido"]) {
      int indice = (doc["fila"].as<int>() - 1) * COLUMNAS + (doc["columna"].as<int>() - 1);
      String color = doc["color"].as<String>();
      uint32_t c = color == "rojo" ? tira.Color(255, 0, 0) : color == "amarillo" ? tira.Color(255, 160, 0) : tira.Color(0, 255, 60);
      tira.setPixelColor(indice, c);
    }
  }
  tira.show();
  http.end();
  delay(1000);
}
