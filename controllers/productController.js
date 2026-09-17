const Product = require("../models/Product");

// ---------------------------------------------------------------------------
// Projection strings
// discountPercent is a virtual — it cannot appear in a .select() string.
// It is appended to each lean plain-object via addDiscount() below.
// ---------------------------------------------------------------------------

// Fields for list / card views (homepage, category pages).
// Excludes heavy nested fields: sections, specGroups, variants, features,
// detailedSpecs, description, overview, overviewImage, specs.
const LIST_FIELDS =
  "name originalPrice salePrice image images color storage network " +
  "freeDelivery deliveryTime warrantyYears inStock status purchasable " +
  "category subCategory brand";

// Fields for the product detail page.
const DETAIL_FIELDS =
  "name brief originalPrice salePrice image images variants " +
  "color storage network screenSize overview overviewImage " +
  "specs specGroups features detailedSpecs sections " +
  "freeDelivery deliveryTime warrantyYears inStock status purchasable " +
  "installment taxIncluded category subCategory brand description";

// ---------------------------------------------------------------------------
// discountPercent helper
// The Product schema has toJSON: { virtuals: false } to keep serialisation
// cheap. We compute the discount once per object here instead of re-hydrating
// the document, so lean() stays lean.
// ---------------------------------------------------------------------------
function addDiscount(obj) {
  if (!obj) return obj;
  const orig = obj.originalPrice;
  const sale = obj.salePrice;
  obj.discountPercent =
    sale != null && sale !== orig && orig > 0
      ? Math.round(((orig - sale) / orig) * 100)
      : 0;
  return obj;
}

// ---------------------------------------------------------------------------
// Arabic normalization helper — compiled once at module load.
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
// Builds a MongoDB regex that matches Arabic hamza variants so that
// "أيفون" and "ايفون" resolve to the same category.
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
// Arabic substring search fallback
// Used when the $text index returns nothing (single character, unstemmed
// token, etc.).  Fetches at most `scanLimit` documents and stops as soon as
// `maxResults` matches are found — prevents unbounded Node.js CPU use.
//
// OPTIMISATION: Before loading full documents, we first try a MongoDB $regex
// on the (indexed) name field using only the ASCII-safe portion of the query.
// This lets the server-side index reduce the scan set before data hits Node.
// ---------------------------------------------------------------------------
const SEARCH_SCAN_LIMIT  = 500;
const SEARCH_MAX_RESULTS = 30;

async function arabicSubstringSearch(query, q) {
  const normalized = normalizeArabic(q);

  // Attempt a cheap server-side pre-filter: regex on name with the raw query.
  // If it returns results we skip the full 500-doc scan entirely.
  try {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexResults = await Product.find({
      ...query,
      name: { $regex: escaped, $options: "i" },
    })
      .select(LIST_FIELDS)
      .limit(SEARCH_MAX_RESULTS)
      .lean();

    if (regexResults.length > 0) return regexResults;
  } catch {
    // regex pre-filter failed — fall through to full in-process scan.
  }

  // Full Arabic-normalised in-process scan as last resort.
  const docs = await Product.find(query)
    .select(LIST_FIELDS)
    .sort({ createdAt: 1 })
    .limit(SEARCH_SCAN_LIMIT)
    .lean();

  const results = [];
  for (const doc of docs) {
    if (normalizeArabic(doc.name).includes(normalized)) {
      results.push(doc);
      if (results.length === SEARCH_MAX_RESULTS) break;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// GET /api/products
// ---------------------------------------------------------------------------
exports.getProducts = async (req, res) => {
  try {
    const { q, brand, category } = req.query;
    const limitParam = parseInt(req.query.limit) || 0;

    const query = {};
    if (brand)    query.brand    = { $regex: new RegExp(`^${brand}$`, "i") };
    if (category) query.category = buildCategoryQuery(category);

    if (!q) {
      const effectiveLimit = limitParam > 0 ? limitParam : 500;
      const products = await Product.find(query)
        .select(LIST_FIELDS)
        .sort({ createdAt: 1 })
        .limit(effectiveLimit)
        .lean();
      return res.json(products.map(addDiscount));
    }

    // Search: try $text index first (fast, DB-side) then fall back to
    // in-process Arabic substring scan.
    try {
      const results = await Product.find({ ...query, $text: { $search: q } })
        .select(LIST_FIELDS)
        .limit(SEARCH_MAX_RESULTS)
        .lean();

      if (results.length > 0) return res.json(results.map(addDiscount));
    } catch {
      // $text index missing or unavailable — fall through to substring scan.
    }

    const fallback = await arabicSubstringSearch(query, q);
    return res.json(fallback.map(addDiscount));
  } catch (err) {
    console.error("[getProducts] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/products/:id
// ---------------------------------------------------------------------------
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .select(DETAIL_FIELDS)
      .lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(addDiscount(product));
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Product not found" });
    }
    console.error("[getProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------------------------------------------
// POST /api/products — used only by legacy seed scripts.
// The admin panel uses POST /api/admin/products (authenticated, with upload).
// This endpoint accepts raw JSON bodies from trusted CLI scripts only and
// does NOT accept file uploads.
// ---------------------------------------------------------------------------
exports.createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    console.error("[createProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/products/:id
// ---------------------------------------------------------------------------
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    if (err.name === "CastError")
      return res.status(404).json({ message: "Product not found" });
    console.error("[updateProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/products/:id
// ---------------------------------------------------------------------------
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (err) {
    if (err.name === "CastError")
      return res.status(404).json({ message: "Product not found" });
    console.error("[deleteProduct] error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};
