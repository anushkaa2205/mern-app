const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    author: { type: String, trim: true, default: 'Anonymous' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Post', postSchema);
