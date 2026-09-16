require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("./models/Product");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    // Find products with the leading-space category
    const result = await Product.updateMany(
      { category: " ابل ايفون 18 دو" },
      { $set: { category: "ابل ايفون 18 دو" } }
    );

    console.log(`✅ تم تحديث ${result.modifiedCount} منتج`);
    if (result.modifiedCount === 0) {
      console.log("⚠️  لم يُعثر على منتجات بالـ category القديمة — ربما تم التصحيح مسبقاً");
    }
  } catch (err) {
    console.error("❌ خطأ:", err.message ?? err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
