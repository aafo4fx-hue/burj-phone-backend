const mongoose = require("mongoose");

const bankSchema = new mongoose.Schema({
  name: { type: String, required: true },
  iban: { type: String, required: true },
  logo: { type: String, default: "" },
}, { timestamps: true });

// Supports admin listing sorted by creation date.
bankSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Bank", bankSchema);
