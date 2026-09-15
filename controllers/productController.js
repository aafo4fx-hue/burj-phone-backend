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
  if (category) query.category = { $regex: new RegExp(category.trim(), "i") };

  if (!q) {
    let dbQuery = Product.find(query).select(LIST_PROJECTION).sort({ createdAt: 1 });
    if (limitParam > 0) dbQuery = dbQuery.limit(limitParam);
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

exports.getProduct = async (req, res) => {
  // Single product — return ALL fields for the product detail page.
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json(product);
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
