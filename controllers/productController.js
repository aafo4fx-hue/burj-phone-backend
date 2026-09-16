const Product = require("../models/Product");

// Fields needed for listing cards (homepage, category pages).
// Heavy fields (sections, specGroups, variants, features, detailedSpecs,
// description, overview, overviewImage, specs) are excluded from list queries.
const LIST_PROJECTION =
  "name originalPrice salePrice image images color storage network " +
  "freeDelivery deliveryTime warrantyYears inStock status purchasable " +
  "category subCategory brand discountPercent";

function normalizeArabic(str) {
  return str
    .replace(/[أإآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

exports.getProducts = async (req, res) => {
  const { q, brand, category } = req.query;
  const limitParam = parseInt(req.query.limit) || 0;

  const query = {};
  if (brand) query.brand = { $regex: new RegExp(`^${brand}$`, "i") };
  // Use exact equality first (index-friendly), then fall back to anchored regex.
  // Anchored ^...$ regex can leverage the {category:1} index prefix,
  // unlike the previous unanchored pattern which forced a collection scan.
  if (category) {
    const cat = category.trim();
    // Normalize Arabic hamza variants so that e.g. "أبل" matches "ابل" in the DB.
    // The regex alternation covers the four common hamza forms: أ إ آ ا
    const normalizedCat = cat
      .replace(/[أإآ]/g, "ا")
      .replace(/[ىي]/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي");
    // Build a pattern where each hamza form matches any of the four variants.
    // This makes the query robust regardless of how the category was stored.
    const pattern = normalizedCat.replace(/ا/g, "[أإآا]");
    query.category = { $regex: new RegExp(`^${pattern}$`, "i") };
  }

  if (!q) {
    // Apply a safety ceiling of 500 when no explicit limit is requested.
    // Category and brand queries rarely need more than 100-200 results;
    // this cap prevents unbounded MongoDB reads while covering all real cases.
    const effectiveLimit = limitParam > 0 ? limitParam : 500;
    const dbQuery = Product.find(query)
      .select(LIST_PROJECTION)
      .sort({ createdAt: 1 })
      .limit(effectiveLimit);
    return res.json(await dbQuery);
  }

  // Search path — use MongoDB $text index to move filtering from Node.js CPU
  // to the database engine. The text index covers: name, category, subCategory, brand.
  // Limit to 30 results — the search dropdown shows at most ~10 items.
  // Active CPU reduction: eliminates normalizeArabic() + Array.filter() + String.includes()
  // on every product document. Filtering now happens inside MongoDB (I/O, not Node.js CPU).
  //
  // Note: $text uses word-level tokenization, not substring matching.
  // For the Navbar search bar this is the correct behaviour (users type product names).
  // If a future requirement needs substring search, MongoDB Atlas Search or a
  // regex-based approach with a limit should be used instead.
  try {
    const textQuery = { ...query, $text: { $search: q } };
    const results = await Product.find(textQuery)
      .select(LIST_PROJECTION)
      .limit(30);

    // If $text returns nothing (e.g. single-char input not indexed), fall back
    // to the normalizeArabic substring approach with an explicit limit to prevent
    // unbounded Node.js processing.
    if (results.length === 0) {
      const normalized = normalizeArabic(q);
      const all = await Product.find(query).select(LIST_PROJECTION).sort({ createdAt: 1 }).limit(500);
      const filtered = all.filter((p) => normalizeArabic(p.name).includes(normalized));
      return res.json(filtered.slice(0, 30));
    }

    return res.json(results);
  } catch {
    // $text search can throw if the text index doesn't exist yet — safe fallback
    const normalized = normalizeArabic(q);
    const all = await Product.find(query).select(LIST_PROJECTION).sort({ createdAt: 1 }).limit(500);
    const filtered = all.filter((p) => normalizeArabic(p.name).includes(normalized));
    return res.json(filtered.slice(0, 30));
  }
};

// Fields needed for the product detail page.
// Excludes admin-only or internal fields not rendered by the frontend.
// hideDetails is excluded intentionally — it controls visibility logic in the
// admin panel but is never read by the detail page components.
// createdAt/updatedAt are excluded: not displayed to end users.
const DETAIL_PROJECTION =
  "name brief originalPrice salePrice image images variants " +
  "color storage network screenSize overview overviewImage " +
  "specs specGroups features detailedSpecs sections " +
  "freeDelivery deliveryTime warrantyYears inStock status purchasable " +
  "installment taxIncluded category subCategory brand " +
  "description discountPercent";

exports.getProduct = async (req, res) => {
  try {
    // .lean() returns a plain JS object instead of a Mongoose Document,
    // eliminating Mongoose's hydration + toJSON/toObject overhead.
    // Virtuals (discountPercent, price) are NOT available on lean() results,
    // so discountPercent is included in the projection as a real-field fallback.
    // The frontend derives price from originalPrice/salePrice directly.
    const product = await Product.findById(req.params.id)
      .select(DETAIL_PROJECTION)
      .lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    // CastError is thrown by Mongoose when id is not a valid ObjectId.
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Product not found" });
    }
    console.error("[getProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

exports.createProduct = async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json(product);
};

exports.updateProduct = async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json(product);
};

exports.deleteProduct = async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json({ message: "Product deleted" });
};
