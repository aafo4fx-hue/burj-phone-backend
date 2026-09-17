const express = require("express");
const router = express.Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");
const { authMiddleware } = require("../middleware/auth");

// Public read endpoints — no auth required.
router.get("/", getProducts);
router.get("/:id", getProduct);

// Write endpoints — admin only.
// These routes are used by legacy seed/migration scripts that connect directly
// to the API.  The admin panel uses /api/admin/products for its own writes.
router.post("/", authMiddleware, createProduct);
router.put("/:id", authMiddleware, updateProduct);
router.delete("/:id", authMiddleware, deleteProduct);

module.exports = router;
