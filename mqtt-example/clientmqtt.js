const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://test.mosquitto.org');

client.on(('connect'),()=>{
    client.subscribe('vehicles');
    client.subscribe('health');
});

client.publishAsync('vehicles',JSON.stringify({"x":10,"y":10}),1);
client.publishAsync('health',JSON.stringify({'status':true}),1);

