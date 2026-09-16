const Product = require("../models/Product");

// Fields needed for listing cards (homepage, category pages).
// Heavy fields (sections, specGroups, variants, features, detailedSpecs,
// description, overview, overviewImage, specs) are excluded from list queries.
const LIST_PROJECTION =
  "name originalPrice salePrice image images color storage network " +
  "freeDelivery deliveryTime warrantyYears inStock status purchasable " +
  "category subCategory brand discountPercent";

// Fields needed for the product detail page.
const DETAIL_PROJECTION =
  "name brief originalPrice salePrice image images variants " +
  "color storage network screenSize overview overviewImage " +
  "specs specGroups features detailedSpecs sections " +
  "freeDelivery deliveryTime warrantyYears inStock status purchasable " +
  "installment taxIncluded category subCategory brand " +
  "description discountPercent";

// ---------------------------------------------------------------------------
// Arabic normalization helper
// Hoisted to module scope so the replacement chains are not re-evaluated on
// every call — the function body is a constant closure over nothing.
// ---------------------------------------------------------------------------
function normalizeArabic(str) {
  return str
    .replace(/[أإآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

// ---------------------------------------------------------------------------
// Category query builder
// Builds a MongoDB-compatible regex pattern that matches Arabic hamza variants.
// Extracted so it is not duplicated between the two callers.
// ---------------------------------------------------------------------------
function buildCategoryQuery(category) {
  const cat = category.trim();
  const normalizedCat = cat
    .replace(/[أإآ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
  const pattern = normalizedCat.replace(/ا/g, "[أإآا]");
  return { $regex: new RegExp(`^${pattern}$`, "i") };
}

// ---------------------------------------------------------------------------
// Arabic substring search fallback (used when $text index returns nothing or
// is unavailable). Loads up to `limit` docs with .lean() then filters in
// Node.js with an early exit at `maxResults` to avoid wasted iteration.
// ---------------------------------------------------------------------------
async function arabicSubstringSearch(query, q, { limit = 500, maxResults = 30 } = {}) {
  const normalized = normalizeArabic(q);
  const all = await Product.find(query)
    .select(LIST_PROJECTION)
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  const filtered = [];
  for (let i = 0; i < all.length; i++) {
    if (normalizeArabic(all[i].name).includes(normalized)) {
      filtered.push(all[i]);
      if (filtered.length === maxResults) break;
    }
  }
  return filtered;
}

exports.getProducts = async (req, res) => {
  const { q, brand, category } = req.query;
  const limitParam = parseInt(req.query.limit) || 0;

  const query = {};
  if (brand) query.brand = { $regex: new RegExp(`^${brand}$`, "i") };
  if (category) query.category = buildCategoryQuery(category);

  if (!q) {
    // .lean() eliminates Mongoose document hydration overhead — returns plain
    // JS objects directly. This is the hot list-page path.
    const effectiveLimit = limitParam > 0 ? limitParam : 500;
    const products = await Product.find(query)
      .select(LIST_PROJECTION)
      .sort({ createdAt: 1 })
      .limit(effectiveLimit)
      .lean();
    return res.json(products);
  }

  // Search path — use MongoDB $text index to move filtering from Node.js CPU
  // to the database engine.
  try {
    const textQuery = { ...query, $text: { $search: q } };
    const results = await Product.find(textQuery)
      .select(LIST_PROJECTION)
      .limit(30)
      .lean();

    // $text matched something — return it directly (no Node.js CPU filtering).
    if (results.length > 0) return res.json(results);

    // $text returned nothing (single char, short token not in index, etc.).
    // Fall back to Arabic-normalised substring search with early-exit cap.
    return res.json(await arabicSubstringSearch(query, q));
  } catch {
    // $text search threw (index missing on this collection) — use fallback.
    return res.json(await arabicSubstringSearch(query, q));
  }
};

exports.getProduct = async (req, res) => {
  try {
    // .lean() returns a plain JS object — eliminates Mongoose hydration + toJSON overhead.
    const product = await Product.findById(req.params.id)
      .select(DETAIL_PROJECTION)
      .lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Product not found" });
    }
    console.error("[getProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    console.error("[createProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Product not found" });
    console.error("[updateProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Product not found" });
    console.error("[deleteProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};
