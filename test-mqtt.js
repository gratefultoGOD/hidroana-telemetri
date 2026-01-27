const mqtt = require('mqtt');

const MQTT_BROKER_URL = 'mqtts://7b53477c154b4e65a96dbaa8ca717dfc.s1.eu.hivemq.cloud';
const MQTT_OPTIONS = {
    username: 'admin',
    password: 'Admin123',
};
const MQTT_TOPIC = 'data';
const MQTT_TAKE = 'take';
const mqttClient = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);

mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
    mqttClient.subscribe(MQTT_TOPIC, { qos: 1 }, (error) => {
        if (error) {
            console.error('Error subscribing to topic:', error);
        } else {
            console.log('Subscribed to topic:', MQTT_TOPIC);
        }
    });
});

mqttClient.on('message', (topic, message) => {
    if (topic == MQTT_TOPIC) {
        console.log('Message received:', message.toString());

        setInterval(() => {
            mqttClient.publish(MQTT_TAKE, '1', { qos: 1 });
        }, 250);
    }

    //mqttClient.publish(MQTT_TOPIC, 'message received');
});

mqttClient.on('error', (error) => {
    console.error('Error:', error);
});

mqttClient.on('offline', () => {
    console.log('Offline');
});

mqttClient.on('reconnect', () => {
    console.log('Reconnecting');
});

mqttClient.on('close', () => {
    console.log('Connection closed');
});
