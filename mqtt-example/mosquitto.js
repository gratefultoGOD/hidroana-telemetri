//gelen veriyi yazdırır message listener'ı iki parametre tutar topic: subscribe olunan konu, message: buraya gönderilen mesajlar

const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://test.mosquitto.org');

client.on('connect', () => {
    client.subscribe('vehicles')
    client.subscribe('health')
})

client.on('message',(topic,message) =>{
    console.log(topic + ": "+ message.toString());
});