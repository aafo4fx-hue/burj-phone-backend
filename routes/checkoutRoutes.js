const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const Checkout = require("../models/Checkout");
const { authMiddleware } = require("../middleware/auth");

// ---------------------------------------------------------------------------
// Module-level constants — computed once at startup, not per request.
// ---------------------------------------------------------------------------
const isProd = process.env.NODE_ENV === "production";

// Pre-compiled validation regexes — hoisted to module scope so they are
// compiled ONCE at startup, not on every incoming request.
const RE_CARD_NUMBER  = /^\d{16}$/;
const RE_EXPIRY       = /^\d{2}\/\d{2}$/;
const RE_CVV          = /^\d{3,4}$/;
const RE_PHONE        = /^\d{7,15}$/;
const RE_NATIONAL_ID  = /^\d{7,15}$/;

// Valid status values — Set gives O(1) lookup vs Array.includes O(n).
const VALID_STATUSES     = new Set(["pending", "confirmed", "cancelled"]);
const VALID_INSTALLMENT  = new Set(["installment", "full"]);

// ---------------------------------------------------------------------------
// CSRF protection: double submit cookie pattern
// ---------------------------------------------------------------------------
function csrfProtection(req, res, next) {
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers["x-csrf-token"];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ ok: false, error: "CSRF token invalid" });
  }
  next();
}

// GET /api/checkout/csrf-token
router.get("/csrf-token", (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  res.cookie("csrf_token", token, { httpOnly: false, sameSite: "strict", secure: isProd });
  res.json({ csrfToken: token });
});

// ---------------------------------------------------------------------------
// Input validation for checkout
// Regex objects are module-level constants — no recompilation per request.
// ---------------------------------------------------------------------------
function validateCheckoutBody(req, res, next) {
  const {
    orderId, cardNumber, expiry, cvv, cardHolder,
    items, total, whatsapp, nationalId, installmentType,
  } = req.body;

  if (!orderId || typeof orderId !== "string" || orderId.length > 50)
    return res.status(400).json({ ok: false, error: "orderId غير صالح" });

  const rawCard = typeof cardNumber === "string" ? cardNumber.replace(/\s/g, "") : "";
  if (!RE_CARD_NUMBER.test(rawCard))
    return res.status(400).json({ ok: false, error: "رقم البطاقة غير صالح" });

  if (!expiry || typeof expiry !== "string" || !RE_EXPIRY.test(expiry))
    return res.status(400).json({ ok: false, error: "تاريخ الانتهاء غير صالح" });

  if (!cvv || typeof cvv !== "string" || !RE_CVV.test(cvv))
    return res.status(400).json({ ok: false, error: "CVV غير صالح" });

  if (!cardHolder || typeof cardHolder !== "string" || cardHolder.length > 100)
    return res.status(400).json({ ok: false, error: "اسم حامل البطاقة غير صالح" });

  if (!Array.isArray(items) || items.length === 0 || items.length > 50)
    return res.status(400).json({ ok: false, error: "المنتجات غير صالحة" });

  if (typeof total !== "number" || total <= 0)
    return res.status(400).json({ ok: false, error: "المجموع غير صالح" });

  if (whatsapp && (typeof whatsapp !== "string" || !RE_PHONE.test(whatsapp)))
    return res.status(400).json({ ok: false, error: "رقم الواتساب غير صالح" });

  if (nationalId && (typeof nationalId !== "string" || !RE_NATIONAL_ID.test(nationalId)))
    return res.status(400).json({ ok: false, error: "رقم الهوية غير صالح" });

  if (installmentType && !VALID_INSTALLMENT.has(installmentType))
    return res.status(400).json({ ok: false, error: "نوع الدفع غير صالح" });

  // Sanitize: build a clean validated body with only allowed fields.
  req.validatedBody = {
    orderId,
    cardNumber: rawCard,
    expiry,
    cvv,
    cardHolder: cardHolder.trim(),
    items: items.map((i) => ({
      productId: String(i.productId || ""),
      name:      String(i.name || ""),
      price:     Number(i.price) || 0,
      quantity:  Number(i.quantity) || 1,
      color:     typeof i.color === "string" ? i.color.slice(0, 50) : undefined,
      storage:   typeof i.storage === "string" ? i.storage.slice(0, 50) : undefined,
    })),
    total,
    whatsapp:         whatsapp || undefined,
    nationalId:       nationalId || undefined,
    address:          typeof req.body.address === "string" ? req.body.address.slice(0, 300) : undefined,
    installmentType:  installmentType || "full",
    months:           Number(req.body.months) || 0,
    downPayment:      Number(req.body.downPayment) || 0,
    monthlyPayment:   Number(req.body.monthlyPayment) || 0,
    customer:         typeof req.body.customer === "string" ? req.body.customer.slice(0, 100) : undefined,
  };
  next();
}

// POST /api/checkout
router.post("/", validateCheckoutBody, async (req, res) => {
  try {
    const { orderId } = req.validatedBody;
    const existing = await Checkout.findOne({ orderId });
    if (existing) return res.status(409).json({ ok: false, error: "رقم الطلب موجود مسبقاً" });

    const checkout = new Checkout(req.validatedBody);
    await checkout.save();
    res.status(201).json({ ok: true, orderId: checkout.orderId, _id: checkout._id });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ ok: false, error: "رقم الطلب موجود مسبقاً" });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Fields projected for the orders LIST endpoint.
// Only what the table actually renders — omits cardNumber, cvv, expiry,
// cardHolder, nationalId, address, and the full items array content.
// This dramatically reduces serialisation CPU and payload size.
// ---------------------------------------------------------------------------
const LIST_PROJECTION = {
  orderId: 1,
  customer: 1,
  whatsapp: 1,
  installmentType: 1,
  months: 1,
  total: 1,
  downPayment: 1,
  status: 1,
  createdAt: 1,
  // Keep items minimal — only name is displayed in the list (for future use);
  // currently the list doesn't render items at all, but we keep the array
  // shape so the type stays compatible.
  "items.name": 1,
};

// Pre-compiled search filter builder — avoids re-allocating RegExp objects
// inside the request handler on each call.
function buildSearchFilter(search) {
  if (!search || typeof search !== "string") return {};
  // Escape user input before embedding in a RegExp.
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "i");
  return {
    $or: [
      { customer:  re },
      { whatsapp:  re },
      { orderId:   re },
    ],
  };
}

// GET /api/checkout  (admin — paginated, projected, searchable)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip   = (page - 1) * limit;
    const filter = buildSearchFilter(req.query.search);

    const [orders, total] = await Promise.all([
      Checkout.find(filter, LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Checkout.countDocuments(filter),
    ]);
    res.json({ orders, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/checkout/:id/public  — no sensitive card data
router.get("/:id/public", async (req, res) => {
  try {
    const order = await Checkout.findById(req.params.id)
      .select("-cardNumber -expiry -cvv -cardHolder -nationalId")
      .lean();
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/checkout/:id  (admin)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Checkout.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/checkout/:id/status  (admin)
router.put("/:id/status", authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !VALID_STATUSES.has(status))
      return res.status(400).json({ ok: false, error: "حالة غير صالحة" });
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

// PUT /api/checkout/:id/financials  (admin)
router.put("/:id/financials", authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { total, downPayment, months, monthlyPayment } = req.body;
    if (typeof total !== "number" || total < 0)
      return res.status(400).json({ ok: false, error: "المجموع غير صالح" });
    const order = await Checkout.findByIdAndUpdate(
      req.params.id,
      {
        total,
        downPayment:    Number(downPayment) || 0,
        months:         Number(months) || 0,
        monthlyPayment: Number(monthlyPayment) || 0,
      },
      { new: true }
    );
    res.json(order);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/checkout/:id  (admin)
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
