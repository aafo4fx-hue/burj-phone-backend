const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // Warn at startup if using the default insecure JWT secret.
    if (process.env.JWT_SECRET === "burj_super_secret_jwt_key_2025_change_this_in_production") {
      console.warn("[SECURITY WARNING] JWT_SECRET is using the default insecure value. Change it in .env before going to production!");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      // Limit the connection pool to avoid over-allocating connections on a
      // single-process Node.js server. Default is 5; 10 is a safe upper bound
      // for this workload without exhausting Atlas free-tier connection limits.
      maxPoolSize: 10,
      // Drop connections that have been idle for more than 60 s so the pool
      // doesn't hold stale sockets against MongoDB Atlas.
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
};

// Log connection events for easier debugging in production.
mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB error:", err.message);
});

module.exports = connectDB;
