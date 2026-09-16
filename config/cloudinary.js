const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { Readable } = require("stream");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Single shared memory storage instance — no need to recreate it per call.
const memoryStorage = multer.memoryStorage();

// Pre-built multer instances (created once at startup, not on every request).
const imageUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const fileUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// makeImageUpload / makeFileUpload kept for backwards-compatibility with
// adminRoutes.js call sites, but now return the same shared instance instead
// of creating a new one each time.
function makeImageUpload() {
  return imageUpload;
}

function makeFileUpload() {
  return fileUpload;
}

function uploadToCloudinary(buffer, folder, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, ...options },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    Readable.from(buffer).pipe(stream);
  });
}

async function deleteFromCloudinary(url, resource_type = "image") {
  if (!url || !url.includes("cloudinary.com")) return;
  try {
    const parts = url.split("/");
    const uploadIndex = parts.indexOf("upload");
    let pathParts = parts.slice(uploadIndex + 1);
    if (/^v\d+$/.test(pathParts[0])) pathParts = pathParts.slice(1);
    const publicId = pathParts.join("/").replace(/\.[^/.]+$/, "");
    await cloudinary.uploader.destroy(publicId, { resource_type });
  } catch (e) {
    console.error("Cloudinary delete error:", e.message);
  }
}

module.exports = { makeImageUpload, makeFileUpload, uploadToCloudinary, deleteFromCloudinary };
