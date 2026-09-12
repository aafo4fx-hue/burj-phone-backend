const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    originalPrice: { type: Number, required: true },
    salePrice: { type: Number },
    description: { type: String },
    image: { type: String },
    images: [{ type: String }],
    color: { type: String },
    storage: { type: String },
    network: { type: String },
    screenSize: { type: String },
    overview: { type: String },
    overviewImage: { type: String },
    features: {
      screenAndDesign: [String],
      performance: [String],
      battery: [String],
      frontCamera: [String],
      rearCamera: [String],
      videoAndPhotography: [String],
    },
    detailedSpecs: {
      memoryType: String,
      simCount: String,
      ram: String,
      internalStorage: String,
      edition: String,
      colorName: String,
      os: String,
      processorName: String,
      mainCameraFeature: String,
      audioJack: String,
      voiceDialing: String,
      fastCharging: String,
      modelName: String,
      secondaryCameraResolution: String,
      batterySize: String,
      screenSize: String,
      simType: String,
      chargingType: String,
      condition: String,
      coreCount: String,
      flash: String,
      networkType: String,
      processorNumber: String,
      modelNumber: String,
      mainCamera: String,
    },
    freeDelivery: { type: Boolean, default: true },
    deliveryTime: { type: String, default: "24 ساعة" },
    warrantyYears: { type: Number, default: 2 },
    installment: {
      available: { type: Boolean, default: false },
      downPayment: Number,
      note: String,
      months: Number,
      conditions: [String],
      policy: String,
    },
    taxIncluded: { type: Boolean, default: true },
    category: { type: String },
    subCategory: { type: String },
    brand: { type: String },
    inStock: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

productSchema.virtual("discountPercent").get(function () {
  if (this.salePrice != null && this.salePrice !== this.originalPrice) {
    return Math.round(((this.originalPrice - this.salePrice) / this.originalPrice) * 100);
  }
  return 0;
});

productSchema.virtual("price").get(function () {
  return this.salePrice || this.originalPrice;
});

module.exports = mongoose.model("Product", productSchema);
