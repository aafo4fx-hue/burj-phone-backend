const express = require("express");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Company = require("../models/Company");
const Banner = require("../models/Banner");
const MainCategory = require("../models/MainCategory");
const Product = require("../models/Product");
const SubCategorySettings = require("../models/SubCategorySettings");
const SubCategory = require("../models/SubCategory");
const Review = require("../models/Review");
const Checkout = require("../models/Checkout");
const Bank = require("../models/Bank");
const CategoryBanner = require("../models/CategoryBanner");
const CardFieldSettings = require("../models/CardFieldSettings");
const { makeImageUpload, makeFileUpload, uploadToCloudinary, deleteFromCloudinary } = require("../config/cloudinary");

const upload = makeImageUpload();
const uploadBankLogo = makeImageUpload();
const uploadFooterImg = makeImageUpload();
const uploadDoc = makeFileUpload();
const uploadProductImage = makeImageUpload();
const uploadBanner = makeImageUpload();
const uploadCategoryBanner = makeImageUpload();
const uploadSubCatImage = makeImageUpload();

const router = express.Router();

function authMiddleware(req, res, next) {
  const token = req.cookies?.admin_token;
  console.log("[auth] cookie:", req.headers.cookie);
  console.log("[auth] token:", token ? "present" : "missing");
  if (!token) return res.status(401).json({ error: "غير مصرح" });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    console.error("[auth] jwt error:", err.message);
    res.status(401).json({ error: "غير مصرح" });
  }
}

// POST /api/admin/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "البريد والكلمة مطلوبان" });

    const admin = await Admin.findOne({ email });
    if (!admin)
      return res.status(401).json({ error: "بيانات غير صحيحة" });

    // TODO: re-enable loginAttempts & lockUntil in production
    const match = await admin.comparePassword(password);
    if (!match) return res.status(401).json({ error: "بيانات غير صحيحة" });

    const token = jwt.sign(
      { id: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    const isProd = process.env.NODE_ENV === "production";
    res
      .cookie("admin_token", token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        maxAge: 8 * 60 * 60 * 1000,
        domain: isProd ? undefined : undefined,
      })
      .json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/logout
router.post("/logout", (req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("admin_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  }).json({ success: true });
});

// GET /api/admin/verify
router.get("/verify", (req, res) => {
  const token = req.cookies?.admin_token;
  if (!token) return res.status(401).json({ valid: false });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// GET /api/admin/users
router.get("/users", authMiddleware, async (req, res) => {
  try {
    const admins = await Admin.find({}, "-password -loginAttempts -lockUntil");
    res.json(admins);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/users
router.post("/users", authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !phone || !email || !password)
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    const exists = await Admin.findOne({ email });
    if (exists) return res.status(400).json({ error: "البريد مستخدم بالفعل" });
    const admin = await Admin.create({ name, phone, email, password });
    res.status(201).json({ _id: admin._id, name: admin.name, email: admin.email, phone: admin.phone });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/users/:id
router.put("/users/:id", authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !email) return res.status(400).json({ error: "الاسم والبريد مطلوبان" });
    const existing = await Admin.findOne({ email, _id: { $ne: req.params.id } });
    if (existing) return res.status(400).json({ error: "البريد مستخدم بالفعل" });
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: "المستخدم غير موجود" });
    admin.name = name;
    admin.email = email;
    if (phone) admin.phone = phone;
    if (password) admin.password = password;
    await admin.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", authMiddleware, async (req, res) => {
  try {
    const admins = await Admin.countDocuments();
    if (admins <= 1) return res.status(400).json({ error: "لا يمكن حذف آخر مستخدم" });
    await Admin.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/upload/:field
router.post("/company/upload/:field", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { field } = req.params;
    const allowed = ["logo", "header", "footer", "stamp", "cancelStamp"];
    if (!allowed.includes(field)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    const result = await uploadToCloudinary(req.file.buffer, "company");
    const url = result.secure_url;
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    await deleteFromCloudinary(company[field]);
    company[field] = url;
    await company.save();
    res.json({ url });
  } catch (err) {
    console.error("company upload error:", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/company/image/:field
router.delete("/company/image/:field", authMiddleware, async (req, res) => {
  try {
    const { field } = req.params;
    const allowed = ["logo", "header", "footer", "stamp", "cancelStamp"];
    if (!allowed.includes(field)) return res.status(400).json({ error: "حقل غير مسموح" });
    const company = await Company.findOne();
    if (!company) return res.json({ success: true });
    await deleteFromCloudinary(company[field]);
    company[field] = "";
    await company.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/company
router.get("/company", async (req, res) => {
  try {
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    if (company.footerItems.length === 0) {
      company.footerItems = [
        { image: "", linkType: "link", link: "", file: "" },
        { image: "", linkType: "link", link: "", file: "" },
        { image: "", linkType: "link", link: "", file: "" },
      ];
      await company.save();
    }
    res.json(company);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/company
router.put("/company", authMiddleware, async (req, res) => {
  try {
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    const body = { ...req.body };
    if (body.linkType1 !== undefined) {
      body.link1Type = body.linkType1;
      delete body.linkType1;
    }
    if (body.linkType2 !== undefined) {
      body.link2Type = body.linkType2;
      delete body.linkType2;
    }
    Object.assign(company, body);
    await company.save();
    res.json(company);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

const DEFAULT_BANNERS = Array(5).fill(null).map(() => ({ url: "", active: true }));

// GET /api/admin/banners
router.get("/banners", async (req, res) => {
  try {
    let doc = await Banner.findOne();
    if (!doc) doc = await Banner.create({ banners: DEFAULT_BANNERS });
    res.json(doc.banners);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banners/upload/:index
router.post("/banners/upload/:index", authMiddleware, uploadBanner.single("image"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) doc = await Banner.create({ banners: DEFAULT_BANNERS });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    const old = doc.banners[index]?.url;
    await deleteFromCloudinary(old);
    const result = await uploadToCloudinary(req.file.buffer, "banners");
    const url = result.secure_url;
    doc.banners.set(index, { url, active: doc.banners[index].active });
    await doc.save();
    res.json({ url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/banners/toggle/:index
router.patch("/banners/toggle/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) return res.status(404).json({ error: "لا يوجد" });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    const newActive = !doc.banners[index].active;
    doc.banners.set(index, { url: doc.banners[index].url, active: newActive });
    await doc.save();
    res.json({ active: newActive });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banners/add
router.post("/banners/add", authMiddleware, async (req, res) => {
  try {
    let doc = await Banner.findOne();
    if (!doc) doc = await Banner.create({ banners: DEFAULT_BANNERS });
    if (doc.banners.length >= 10) return res.status(400).json({ error: "الحد الأقصى 10 بانرات" });
    doc.banners.push({ url: "", active: true });
    await doc.save();
    res.json({ index: doc.banners.length - 1 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/banners/reorder
router.patch("/banners/reorder", authMiddleware, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: "ترتيب غير صحيح" });
    let doc = await Banner.findOne();
    if (!doc) return res.status(404).json({ error: "لا يوجد" });
    if (order.length !== doc.banners.length) return res.status(400).json({ error: "عدد غير متطابق" });
    const reordered = order.map((i) => doc.banners[i]);
    doc.banners = reordered;
    await doc.save();
    res.json(doc.banners);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banners/:index/image  (clear image only)
router.delete("/banners/:index/image", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    const old = doc.banners[index]?.url;
    await deleteFromCloudinary(old);
    doc.banners.set(index, { url: "", active: doc.banners[index].active });
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banners/:index  (remove entire banner slot)
router.delete("/banners/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    const old = doc.banners[index]?.url;
    await deleteFromCloudinary(old);
    doc.banners.splice(index, 1);
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/main-categories - distinct from products with count
router.get("/main-categories", authMiddleware, async (req, res) => {
  try {
    const result = await Product.aggregate([
      { $match: { subCategory: { $ne: null, $exists: true } } },
      { $group: { _id: "$subCategory", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(result.map((r) => ({ name: r._id, count: r.count })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/categories - distinct category values from products
router.get("/categories", authMiddleware, async (req, res) => {
  try {
    const cats = await Product.distinct("category");
    res.json(cats.filter(Boolean).sort());
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/main-categories - add new category name (no products yet)
router.post("/main-categories", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "اسم التصنيف مطلوب" });
    const exists = await Product.findOne({ category: name.trim() });
    if (exists) return res.status(400).json({ error: "التصنيف موجود بالفعل" });
    // Store as a placeholder product-less category via MainCategory
    const existsMC = await MainCategory.findOne({ name: name.trim() });
    if (existsMC) return res.status(400).json({ error: "التصنيف موجود بالفعل" });
    const cat = await MainCategory.create({ name: name.trim() });
    res.status(201).json({ name: cat.name, count: 0 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/main-categories/extra - all subCategories (from products + MainCategory)
router.get("/main-categories/extra", authMiddleware, async (req, res) => {
  try {
    const [productAgg, manualCats] = await Promise.all([
      Product.aggregate([
        { $match: { subCategory: { $ne: null, $exists: true } } },
        { $group: { _id: "$subCategory", count: { $sum: 1 } } },
      ]),
      MainCategory.find(),
    ]);
    const productMap = new Map(productAgg.map((r) => [r._id, r.count]));
    const allNames = new Set([...productMap.keys(), ...manualCats.map((c) => c.name)]);
    res.json([...allNames].sort().map((name) => ({ name, count: productMap.get(name) || 0 })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/main-categories/rename - rename category across all products
router.put("/main-categories/rename", authMiddleware, async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: "الاسم القديم والجديد مطلوبان" });
    const exists = await Product.findOne({ subCategory: newName.trim() });
    if (exists && newName.trim() !== oldName.trim()) return res.status(400).json({ error: "التصنيف موجود بالفعل" });
    await Product.updateMany({ subCategory: oldName }, { $set: { subCategory: newName.trim() } });
    await MainCategory.updateOne({ name: oldName }, { $set: { name: newName.trim() } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/main-categories/remove - remove category from all products
router.delete("/main-categories/remove", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "اسم التصنيف مطلوب" });
    await Product.updateMany({ category: name }, { $unset: { category: "" } });
    await MainCategory.deleteOne({ name });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/sub-categories - add standalone sub-category
router.post("/sub-categories", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "اسم التصنيف الفرعي مطلوب" });
    const existsInProducts = await Product.findOne({ subCategory: name.trim() });
    if (existsInProducts) return res.status(400).json({ error: "التصنيف الفرعي موجود بالفعل" });
    const existsSC = await SubCategory.findOne({ name: name.trim() });
    if (existsSC) return res.status(400).json({ error: "التصنيف الفرعي موجود بالفعل" });
    const sc = await SubCategory.create({ name: name.trim() });
    res.status(201).json({ name: sc.name, count: 0 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/all - all from MainCategory collection
router.get("/sub-categories/all", authMiddleware, async (req, res) => {
  try {
    const cats = await MainCategory.find().sort({ name: 1 });
    res.json(cats.map((c) => ({ _id: c._id, name: c.name })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/extra - standalone sub-categories not in products
router.get("/sub-categories/extra", authMiddleware, async (req, res) => {
  try {
    const productSubCats = await Product.distinct("subCategory");
    const extra = await SubCategory.find({ name: { $nin: productSubCats.filter(Boolean) } });
    res.json(extra.map((s) => ({ name: s.name, count: 0, _id: s._id })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories
router.get("/sub-categories", authMiddleware, async (req, res) => {
  try {
    const result = await Product.aggregate([
      { $match: { category: { $ne: null, $exists: true } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(result.map((r) => ({ category: r._id, name: r._id, count: r.count })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/sub-categories/rename
router.put("/sub-categories/rename", authMiddleware, async (req, res) => {
  try {
    const { oldName, oldCategory, newName, newCategory } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: "الاسم القديم والجديد مطلوبان" });
    await Product.updateMany(
      { subCategory: oldName, category: oldCategory },
      { $set: { subCategory: newName.trim(), category: (newCategory || oldCategory).trim() } }
    );
    await SubCategory.updateOne({ name: oldName }, { $set: { name: newName.trim() } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/sub-categories/remove
router.delete("/sub-categories/remove", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "الاسم مطلوب" });
    await Product.updateMany({ category: name }, { $unset: { category: "" } });
    await SubCategorySettings.deleteMany({ category: name });
    await SubCategory.deleteOne({ name });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/settings
router.get("/sub-categories/settings", authMiddleware, async (req, res) => {
  try {
    const settings = await SubCategorySettings.find();
    res.json(settings);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/sub-categories/settings/toggle
router.patch("/sub-categories/settings/toggle", authMiddleware, async (req, res) => {
  try {
    const { category, subCategory } = req.body;
    if (!category || !subCategory) return res.status(400).json({ error: "البيانات مطلوبة" });
    const existing = await SubCategorySettings.findOne({ category, subCategory });
    const newValue = existing ? !existing.showInHome : true;
    const doc = await SubCategorySettings.findOneAndUpdate(
      { category, subCategory },
      { $set: { showInHome: newValue } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ showInHome: doc.showInHome });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/sub-categories/settings/order
router.patch("/sub-categories/settings/order", authMiddleware, async (req, res) => {
  try {
    const { category, subCategory, order } = req.body;
    if (!category || !subCategory) return res.status(400).json({ error: "البيانات مطلوبة" });
    await SubCategorySettings.findOneAndUpdate(
      { category, subCategory },
      { $set: { order: Number(order) || 0 } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/sub-categories/image/:category - upload custom image for category
router.post("/sub-categories/image/:category", authMiddleware, uploadSubCatImage.single("image"), async (req, res) => {
  try {
    const { category } = req.params;
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    const doc = await SubCategorySettings.findOne({ category, subCategory: { $ne: "__max__" } });
    if (doc?.image) await deleteFromCloudinary(doc.image);
    const result = await uploadToCloudinary(req.file.buffer, "sub-categories");
    await SubCategorySettings.updateMany(
      { category, subCategory: { $ne: "__max__" } },
      { $set: { image: result.secure_url } }
    );
    if (!(await SubCategorySettings.findOne({ category, subCategory: { $ne: "__max__" } }))) {
      await SubCategorySettings.create({ category, subCategory: category, image: result.secure_url });
    }
    res.json({ url: result.secure_url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/public (public - categories from product.category only)
router.get("/sub-categories/public", async (req, res) => {
  try {
    const result = await Product.aggregate([
      { $match: { category: { $ne: null, $exists: true }, image: { $ne: "", $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$category", count: { $sum: 1 }, image: { $first: "$image" } } },
    ]);
    const customImages = await SubCategorySettings.find({ image: { $ne: "" }, subCategory: { $ne: "__max__" } });
    const imageMap = {};
    for (const s of customImages) if (s.image) imageMap[s.category] = s.image;
    res.json(result.map((r) => ({ name: r._id, count: r.count, image: imageMap[r._id] || r.image })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/home-settings (public)
router.get("/sub-categories/home-settings", async (req, res) => {
  try {
    const settings = await SubCategorySettings.find({ category: { $ne: "__config__" } }).sort({ order: 1 });
    res.json(settings);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/max (public)
router.get("/sub-categories/max", async (req, res) => {
  try {
    const doc = await SubCategorySettings.findOne({ category: "__config__", subCategory: "__max__" });
    res.json({ max: doc ? doc.order : 4 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/sub-categories/max
router.patch("/sub-categories/max", authMiddleware, async (req, res) => {
  try {
    const { max } = req.body;
    const val = parseInt(max);
    if (!val || val < 1) return res.status(400).json({ error: "قيمة غير صحيحة" });
    await SubCategorySettings.findOneAndUpdate(
      { category: "__config__", subCategory: "__max__" },
      { $set: { order: val, showInHome: false } },
      { upsert: true }
    );
    res.json({ max: val });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/orders
router.get("/orders", async (req, res) => {
  try {
    const orders = await Checkout.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/orders/:id
router.get("/orders/:id", async (req, res) => {
  try {
    const order = await Checkout.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/admin/orders/:id
router.delete("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Checkout.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/admin/orders/:id/status
router.put("/orders/:id/status", authMiddleware, async (req, res) => {
  try {
    const order = await Checkout.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/reviews (public - approved only)
router.get("/reviews", async (req, res) => {
  try {
    const reviews = await Review.find({ approved: true }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/reviews/all (admin - all reviews)
router.get("/reviews/all", authMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.json(reviews);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/reviews (public - submit review)
router.post("/reviews", async (req, res) => {
  try {
    const { name, comment, rating, gender } = req.body;
    if (!name || !comment) return res.status(400).json({ error: "الاسم والتعليق مطلوبان" });
    const review = await Review.create({ name, comment, rating: rating || 5, gender: gender || "male" });
    res.status(201).json({ success: true, _id: review._id });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/reviews/admin-add (admin - add review directly, optionally approved)
router.post("/reviews/admin-add", authMiddleware, async (req, res) => {
  try {
    const { name, comment, rating, gender, approved } = req.body;
    if (!name || !comment) return res.status(400).json({ error: "الاسم والتعليق مطلوبان" });
    const review = await Review.create({ name, comment, rating: rating || 5, gender: gender || "male", approved: !!approved });
    res.status(201).json(review);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/reviews/:id (admin - edit review)
router.put("/reviews/:id", authMiddleware, async (req, res) => {
  try {
    const { name, comment, rating, gender } = req.body;
    if (!name || !comment) return res.status(400).json({ error: "الاسم والتعليق مطلوبان" });
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { name, comment, rating: rating || 5, gender: gender || "male" },
      { new: true }
    );
    if (!review) return res.status(404).json({ error: "التعليق غير موجود" });
    res.json(review);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/reviews/:id/approve
router.patch("/reviews/:id/approve", authMiddleware, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, { approved: true }, { new: true });
    if (!review) return res.status(404).json({ error: "التعليق غير موجود" });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/reviews/:id/toggle
router.patch("/reviews/:id/toggle", authMiddleware, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: "التعليق غير موجود" });
    review.approved = !review.approved;
    await review.save();
    res.json({ approved: review.approved });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/reviews/:id
router.delete("/reviews/:id", authMiddleware, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/products
const uploadProductFields = makeImageUpload();
router.post("/products", authMiddleware, uploadProductFields.fields([{ name: "image", maxCount: 1 }, { name: "galleryFiles", maxCount: 20 }]), async (req, res) => {
  try {
    const body = req.body;
    const productData = {};

    const fields = ["name", "category", "subCategory", "brand", "color", "storage", "network", "screenSize", "description", "deliveryTime", "overviewImage"];
    fields.forEach((f) => { if (body[f]) productData[f] = body[f]; });

    const numFields = ["originalPrice", "salePrice", "warrantyYears"];
    numFields.forEach((f) => { if (body[f] !== undefined && body[f] !== "") productData[f] = Number(body[f]); });

    const boolFields = ["freeDelivery", "taxIncluded", "inStock"];
    boolFields.forEach((f) => { if (body[f] !== undefined) productData[f] = body[f] === "true" || body[f] === true; });

    if (body["installment.available"] !== undefined) {
      productData.installment = {
        available: body["installment.available"] === "true",
        downPayment: body["installment.downPayment"] ? Number(body["installment.downPayment"]) : undefined,
        months: body["installment.months"] ? Number(body["installment.months"]) : undefined,
        note: body["installment.note"] || "",
      };
    }

    const specFields = ["screen", "processor", "ram", "storage", "rearCamera", "frontCamera", "battery", "batteryLife", "charging", "os", "extras"];
    const specs = {};
    specFields.forEach((f) => { if (body[`specs.${f}`]) specs[f] = body[`specs.${f}`]; });
    if (Object.keys(specs).length) productData.specs = specs;

    if (body.colors) {
      try { productData.colors = JSON.parse(body.colors); } catch { /* ignore */ }
    }

    // Main image: file upload or URL
    if (req.files?.image?.[0]) {
      const result = await uploadToCloudinary(req.files.image[0].buffer, "products");
      productData.image = result.secure_url;
    } else if (body.imageUrl) {
      productData.image = body.imageUrl;
    }

    // Gallery images: URLs + uploaded files
    const galleryUrls = [];
    if (body.galleryUrls) {
      try { galleryUrls.push(...JSON.parse(body.galleryUrls)); } catch { /* ignore */ }
    }
    if (req.files?.galleryFiles) {
      for (const file of req.files.galleryFiles) {
        const result = await uploadToCloudinary(file.buffer, "products");
        galleryUrls.push(result.secure_url);
      }
    }
    if (galleryUrls.length) productData.images = galleryUrls;

    const product = await Product.create(productData);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/products
router.get("/products", authMiddleware, async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).select("name category originalPrice salePrice");
    res.json(products);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/products/:id
router.get("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });
    res.json(product);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/products/:id
router.delete("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });
    await deleteFromCloudinary(product.image);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/products/:id  (with optional image upload)
const uploadProductFieldsEdit = makeImageUpload();
router.put("/products/:id", authMiddleware, uploadProductFieldsEdit.fields([{ name: "image", maxCount: 1 }, { name: "galleryFiles", maxCount: 20 }]), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

    const body = req.body;
    const fields = ["name", "category", "subCategory", "brand", "color", "storage", "network", "screenSize", "description", "deliveryTime", "overviewImage"];
    fields.forEach((f) => { if (body[f] !== undefined) product[f] = body[f]; });

    const numFields = ["originalPrice", "salePrice", "warrantyYears"];
    numFields.forEach((f) => { if (body[f] !== undefined) product[f] = body[f] === "" ? undefined : Number(body[f]); });

    const boolFields = ["freeDelivery", "taxIncluded", "inStock"];
    boolFields.forEach((f) => { if (body[f] !== undefined) product[f] = body[f] === "true" || body[f] === true; });

    // installment
    if (body["installment.available"] !== undefined) {
      product.installment = product.installment || {};
      product.installment.available = body["installment.available"] === "true" || body["installment.available"] === true;
      product.installment.downPayment = body["installment.downPayment"] ? Number(body["installment.downPayment"]) : product.installment.downPayment;
      product.installment.months = body["installment.months"] ? Number(body["installment.months"]) : product.installment.months;
      product.installment.note = body["installment.note"] ?? product.installment.note;
    }

    // specs
    const specFields = ["screen", "processor", "ram", "storage", "rearCamera", "frontCamera", "battery", "batteryLife", "charging", "os", "extras"];
    const hasSpecs = specFields.some((f) => body[`specs.${f}`] !== undefined);
    if (hasSpecs) {
      product.specs = product.specs || {};
      specFields.forEach((f) => { if (body[`specs.${f}`] !== undefined) product.specs[f] = body[`specs.${f}`]; });
    }

    // colors / variants
    if (body.colors !== undefined) {
      try { product.colors = JSON.parse(body.colors); } catch { /* ignore */ }
    }

    // Main image: file upload or URL
    if (req.files?.image?.[0]) {
      await deleteFromCloudinary(product.image);
      const result = await uploadToCloudinary(req.files.image[0].buffer, "products");
      product.image = result.secure_url;
    } else if (body.imageUrl !== undefined) {
      product.image = body.imageUrl;
    }

    // Gallery images: URLs + uploaded files
    const galleryUrls = [];
    if (body.galleryUrls) {
      try { galleryUrls.push(...JSON.parse(body.galleryUrls)); } catch { /* ignore */ }
    }
    if (req.files?.galleryFiles) {
      for (const file of req.files.galleryFiles) {
        const result = await uploadToCloudinary(file.buffer, "products");
        galleryUrls.push(result.secure_url);
      }
    }
    if (body.galleryUrls !== undefined || req.files?.galleryFiles) {
      product.images = galleryUrls;
    }

    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-image/:key  (images: qrImage, img1, img2)
router.post("/company/footer-image/:key", authMiddleware, uploadFooterImg.single("image"), async (req, res) => {
  try {
    const { key } = req.params;
    if (!["qrImage", "img1", "img2"].includes(key)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    await deleteFromCloudinary(company[key]);
    const result = await uploadToCloudinary(req.file.buffer, "company");
    company[key] = result.secure_url;
    await company.save();
    res.json({ url: company[key] });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-file/:key  (files: file1, file2)
router.post("/company/footer-file/:key", authMiddleware, uploadDoc.single("file"), async (req, res) => {
  try {
    const { key } = req.params;
    if (!["file1", "file2"].includes(key)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    await deleteFromCloudinary(company[key], "raw");
    const result = await uploadToCloudinary(req.file.buffer, "docs", { resource_type: "raw" });
    company[key] = result.secure_url;
    await company.save();
    res.json({ url: company[key] });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/image/:index
router.post("/company/footer-items/image/:index", authMiddleware, uploadFooterImg.single("image"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    if (isNaN(index) || index < 0 || index >= company.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });
    const old = company.footerItems[index]?.image;
    await deleteFromCloudinary(old);
    const result = await uploadToCloudinary(req.file.buffer, "company");
    company.footerItems[index].image = result.secure_url;
    company.markModified("footerItems");
    await company.save();
    res.json({ url: company.footerItems[index].image });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/file/:index
router.post("/company/footer-items/file/:index", authMiddleware, uploadDoc.single("file"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    if (isNaN(index) || index < 0 || index >= company.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });
    const old = company.footerItems[index]?.file;
    await deleteFromCloudinary(old, "raw");
    const result = await uploadToCloudinary(req.file.buffer, "docs", { resource_type: "raw" });
    company.footerItems[index].file = result.secure_url;
    company.markModified("footerItems");
    await company.save();
    res.json({ url: company.footerItems[index].file });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/add
router.post("/company/footer-items/add", authMiddleware, async (req, res) => {
  try {
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    company.footerItems.push({ image: "", linkType: "link", link: "", file: "" });
    await company.save();
    res.json({ index: company.footerItems.length - 1 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/company/footer-items/:index
router.delete("/company/footer-items/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let company = await Company.findOne();
    if (!company) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= company.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });
    const item = company.footerItems[index];
    await deleteFromCloudinary(item.image);
    await deleteFromCloudinary(item.file);
    company.footerItems.splice(index, 1);
    company.markModified("footerItems");
    await company.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/category-banners-bulk?categories=cat1,cat2,...
router.get("/category-banners-bulk", async (req, res) => {
  try {
    const raw = req.query.categories;
    if (!raw) return res.json({});
    const names = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
    const docs = await CategoryBanner.find({ category: { $in: names } });
    const result = {};
    for (const doc of docs) {
      const active = doc.banners.filter((b) => b.url && b.active).map((b) => b.url);
      if (active.length) result[doc.category] = active;
    }
    res.json(result);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/category-banners/:category
router.get("/category-banners/:category", async (req, res) => {
  try {
    let doc = await CategoryBanner.findOne({ category: req.params.category });
    if (!doc) doc = await CategoryBanner.create({ category: req.params.category });
    res.json(doc.banners);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/category-banners/:category/upload/:index
router.post("/category-banners/:category/upload/:index", authMiddleware, uploadCategoryBanner.single("image"), async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    let doc = await CategoryBanner.findOne({ category });
    if (!doc) doc = await CategoryBanner.create({ category });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    await deleteFromCloudinary(doc.banners[index]?.url);
    const result = await uploadToCloudinary(req.file.buffer, "category-banners");
    doc.banners.set(index, { url: result.secure_url, active: doc.banners[index].active });
    await doc.save();
    res.json({ url: result.secure_url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/category-banners/:category/toggle/:index
router.patch("/category-banners/:category/toggle/:index", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    const doc = await CategoryBanner.findOne({ category });
    if (!doc) return res.status(404).json({ error: "لا يوجد" });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    const newActive = !doc.banners[index].active;
    doc.banners.set(index, { url: doc.banners[index].url, active: newActive });
    await doc.save();
    res.json({ active: newActive });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/category-banners/:category/add
router.post("/category-banners/:category/add", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    let doc = await CategoryBanner.findOne({ category });
    if (!doc) doc = await CategoryBanner.create({ category });
    if (doc.banners.length >= 10) return res.status(400).json({ error: "الحد الأقصى 10 بانرات" });
    doc.banners.push({ url: "", active: true });
    await doc.save();
    res.json({ index: doc.banners.length - 1 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/category-banners/:category/:index/image
router.delete("/category-banners/:category/:index/image", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    const doc = await CategoryBanner.findOne({ category });
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    await deleteFromCloudinary(doc.banners[index]?.url);
    doc.banners.set(index, { url: "", active: doc.banners[index].active });
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/category-banners/:category/:index
router.delete("/category-banners/:category/:index", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    const doc = await CategoryBanner.findOne({ category });
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    await deleteFromCloudinary(doc.banners[index]?.url);
    doc.banners.splice(index, 1);
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/banks
router.get("/banks", authMiddleware, async (req, res) => {
  try {
    const banks = await Bank.find().sort({ createdAt: -1 });
    res.json(banks);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banks
router.post("/banks", authMiddleware, uploadBankLogo.single("logo"), async (req, res) => {
  try {
    const { name, iban } = req.body;
    if (!name || !iban) return res.status(400).json({ error: "اسم البنك والآيبان مطلوبان" });
    let logo = "";
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "banks");
      logo = result.secure_url;
    }
    const bank = await Bank.create({ name, iban, logo });
    res.status(201).json(bank);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/banks/:id
router.put("/banks/:id", authMiddleware, uploadBankLogo.single("logo"), async (req, res) => {
  try {
    const bank = await Bank.findById(req.params.id);
    if (!bank) return res.status(404).json({ error: "البنك غير موجود" });
    const { name, iban } = req.body;
    if (name) bank.name = name;
    if (iban) bank.iban = iban;
    if (req.file) {
      await deleteFromCloudinary(bank.logo);
      const result = await uploadToCloudinary(req.file.buffer, "banks");
      bank.logo = result.secure_url;
    }
    await bank.save();
    res.json(bank);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banks/:id
router.delete("/banks/:id", authMiddleware, async (req, res) => {
  try {
    const bank = await Bank.findByIdAndDelete(req.params.id);
    if (!bank) return res.status(404).json({ error: "البنك غير موجود" });
    await deleteFromCloudinary(bank.logo);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/card-field-settings
router.get("/card-field-settings", async (req, res) => {
  try {
    let doc = await CardFieldSettings.findOne();
    if (!doc) doc = await CardFieldSettings.create({});
    res.json(doc);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/card-field-settings
router.patch("/card-field-settings", authMiddleware, async (req, res) => {
  try {
    const { field } = req.body;
    if (!["showExpiryDate", "showCvv"].includes(field))
      return res.status(400).json({ error: "حقل غير صحيح" });
    const current = await CardFieldSettings.findOne();
    const newVal = current ? !current[field] : false;
    const doc = await CardFieldSettings.findOneAndUpdate(
      {},
      { $set: { [field]: newVal } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ [field]: doc[field] });
  } catch (err) {
    console.error("[card-field-settings PATCH error]", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
