require('dotenv').config();
const dns = require('dns');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Node's built-in DNS resolver can fail to reach the DNS server Windows
// hands it (e.g. a link-local IPv6 address), which breaks the SRV lookups
// that mongodb+srv:// connection strings rely on even though the OS
// resolver works fine. Point Node at public resolvers to avoid that.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const postRoutes = require('./routes/posts');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mern-blog';

app.use(cors());
app.use(express.json());

app.use('/api/posts', postRoutes);

app.get('/', (req, res) => {
  res.send('MERN blog API is running');
});

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
