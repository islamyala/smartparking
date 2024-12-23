const { MongoClient } = require('mongodb');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3001", // Adresse du frontend
    methods: ["GET", "POST"],
  },
});

const uri = 'mongodb+srv://smartparking:smartparking@cluster0.cskfb.mongodb.net/';
const client = new MongoClient(uri);
const port = 3000;
const mqttClient = mqtt.connect('mqtt://localhost'); // Connexion au broker MQTT
const topic = 'parking/sensor';

app.use(cors()); // Autorise les connexions depuis le frontend

let collection; // Déclare collection ici

// Fonction d'initialisation du parking
const initializeParking = async () => {
  const existingCount = await collection.countDocuments();
  if (existingCount === 0) {
    const spaces = [
      { id: 1, available: true, reserved: false },
      { id: 2, available: false, reserved: false },
      // Ajouter d'autres espaces ici
    ];
    await collection.insertMany(spaces);
    console.log('Parking initialized in MongoDB');
  }
};

// Connexion à MongoDB
client.connect()
  .then(() => {
    console.log('Connected to MongoDB');
    collection = client.db('parking').collection('spaces'); // Initialisation de collection
    initializeParking(); // Initialisation des places de parking si vide
  })
  .catch((err) => console.error('MongoDB connection error:', err));

// Simulation des données des capteurs via MQTT
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  mqttClient.subscribe(topic, (err) => {
    if (err) console.error('MQTT Subscription error:', err);
  });
});

mqttClient.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  console.log('Data received on backend:', data); // Ajout du log

  // Mise à jour des données dans MongoDB
  data.forEach(async (place) => {
    await collection.updateOne(
      { id: place.id },
      { $set: { available: place.available } }
    );
  });

  // Mise à jour en temps réel via Socket.IO
  io.emit('parkingUpdate', data);
});

// Endpoint pour récupérer les données actuelles
app.get('/api/places', async (req, res) => {
  try {
    const parkingData = await collection.find({}).toArray();
    res.json(parkingData); // Retourner les places de parking depuis MongoDB
  } catch (err) {
    console.error('Error fetching parking data:', err);
    res.status(500).json({ message: 'Error fetching parking data' });
  }
});

// Endpoint pour réserver une place
app.post('/api/reserve/:id', async (req, res) => {
  const placeId = parseInt(req.params.id);

  try {
    const result = await collection.updateOne(
      { id: placeId },
      { $set: { available: false } } // Marquer la place comme non disponible
    );

    if (result.modifiedCount === 1) {
      console.log(`Place ${placeId} reserved`);
      const updatedParkingData = await collection.find({}).toArray();
      io.emit('parkingUpdate', updatedParkingData); // Mettre à jour les autres clients
      return res.status(200).json({ message: `Place ${placeId} reserved` });
    } else {
      return res.status(404).json({ message: 'Place not found or already reserved' });
    }
  } catch (error) {
    console.error('Error reserving place:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Socket.IO pour gérer les connexions en temps réel
io.on('connection', (socket) => {
  console.log('New client connected');

  // Envoyer les données initiales au client
  collection.find({}).toArray((err, data) => {
    if (err) {
      console.error('Error fetching data for socket:', err);
      return;
    }
    socket.emit('parkingUpdate', data); // Envoie l'état initial
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Démarrer le serveur
server.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
