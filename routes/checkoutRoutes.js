const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const router = express.Router();
const Checkout = require("../models/Checkout");

function authMiddleware(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) return res.status(401).json({ error: "غير مصرح" });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "غير مصرح" });
  }
}

// CSRF protection: double submit cookie pattern
function csrfProtection(req, res, next) {
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers["x-csrf-token"];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ ok: false, error: "CSRF token invalid" });
  }
  next();
}

// Endpoint to get a CSRF token
router.get("/csrf-token", (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  res.cookie("csrf_token", token, { httpOnly: false, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  res.json({ csrfToken: token });
});

// Input validation for checkout
function validateCheckoutBody(req, res, next) {
  const { orderId, cardNumber, expiry, cvv, cardHolder, items, total, whatsapp, nationalId, installmentType } = req.body;
  if (!orderId || typeof orderId !== "string" || orderId.length > 50) {
    return res.status(400).json({ ok: false, error: "orderId غير صالح" });
  }
  if (!cardNumber || typeof cardNumber !== "string" || !/^\d{16}$/.test(cardNumber.replace(/\s/g, ""))) {
    return res.status(400).json({ ok: false, error: "رقم البطاقة غير صالح" });
  }
  if (!expiry || typeof expiry !== "string" || !/^\d{2}\/\d{2}$/.test(expiry)) {
    return res.status(400).json({ ok: false, error: "تاريخ الانتهاء غير صالح" });
  }
  if (!cvv || typeof cvv !== "string" || !/^\d{3,4}$/.test(cvv)) {
    return res.status(400).json({ ok: false, error: "CVV غير صالح" });
  }
  if (!cardHolder || typeof cardHolder !== "string" || cardHolder.length > 100) {
    return res.status(400).json({ ok: false, error: "اسم حامل البطاقة غير صالح" });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return res.status(400).json({ ok: false, error: "المنتجات غير صالحة" });
  }
  if (typeof total !== "number" || total <= 0) {
    return res.status(400).json({ ok: false, error: "المجموع غير صالح" });
  }
  if (whatsapp && (typeof whatsapp !== "string" || !/^\d{7,15}$/.test(whatsapp))) {
    return res.status(400).json({ ok: false, error: "رقم الواتساب غير صالح" });
  }
  if (nationalId && (typeof nationalId !== "string" || !/^\d{7,15}$/.test(nationalId))) {
    return res.status(400).json({ ok: false, error: "رقم الهوية غير صالح" });
  }
  if (installmentType && !["installment", "full"].includes(installmentType)) {
    return res.status(400).json({ ok: false, error: "نوع الدفع غير صالح" });
  }
  // Sanitize: only allow known fields
  req.validatedBody = { orderId, cardNumber: cardNumber.replace(/\s/g, ""), expiry, cvv, cardHolder: cardHolder.trim(), items: items.map(i => ({ productId: String(i.productId || ""), name: String(i.name || ""), price: Number(i.price) || 0, quantity: Number(i.quantity) || 1, color: typeof i.color === "string" ? i.color.slice(0, 50) : undefined, storage: typeof i.storage === "string" ? i.storage.slice(0, 50) : undefined })), total, whatsapp: whatsapp || undefined, nationalId: nationalId || undefined, address: typeof req.body.address === "string" ? req.body.address.slice(0, 300) : undefined, installmentType: installmentType || "full", months: Number(req.body.months) || 0, downPayment: Number(req.body.downPayment) || 0, monthlyPayment: Number(req.body.monthlyPayment) || 0, customer: typeof req.body.customer === "string" ? req.body.customer.slice(0, 100) : undefined };
  next();
}

router.post("/", validateCheckoutBody, async (req, res) => {
  try {
    const { orderId, whatsapp, nationalId } = req.validatedBody;
    // Check orderId uniqueness explicitly
    const existing = await Checkout.findOne({ orderId });
    if (existing) {
      return res.status(409).json({ ok: false, error: "رقم الطلب موجود مسبقاً" });
    }
    const checkout = new Checkout(req.validatedBody);
    await checkout.save();
    res.status(201).json({ ok: true, orderId: checkout.orderId, _id: checkout._id });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ ok: false, error: "رقم الطلب موجود مسبقاً" });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/", authMiddleware, async (req, res) => {
  try {
    const orders = await Checkout.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Public: get order for invoice/receipt (no sensitive card data)
router.get("/:id/public", async (req, res) => {
  try {
    const order = await Checkout.findById(req.params.id).select("-cardNumber -expiry -cvv -cardHolder -nationalId");
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Checkout.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put("/:id/status", authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !["pending", "confirmed", "cancelled"].includes(status)) {
      return res.status(400).json({ ok: false, error: "حالة غير صالحة" });
    }
    const order = await Checkout.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put("/:id/financials", authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { total, downPayment, months, monthlyPayment } = req.body;
    if (typeof total !== "number" || total < 0) return res.status(400).json({ ok: false, error: "المجموع غير صالح" });
    const order = await Checkout.findByIdAndUpdate(
      req.params.id,
      { total, downPayment: Number(downPayment) || 0, months: Number(months) || 0, monthlyPayment: Number(monthlyPayment) || 0 },
      { new: true }
    );
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete("/:id", authMiddleware, csrfProtection, async (req, res) => {
  try {
    const order = await Checkout.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
