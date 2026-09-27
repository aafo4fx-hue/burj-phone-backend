const mongoose = require("mongoose");

const footerItemSubSchema = new mongoose.Schema(
  {
    image: { type: String, default: "" },
    linkType: { type: String, default: "link" },
    link: { type: String, default: "" },
    file: { type: String, default: "" },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema({
  nameAr: { type: String, default: "", trim: true },
  nameEn: { type: String, default: "", trim: true },
  addressAr: { type: String, default: "", trim: true },
  addressEn: { type: String, default: "", trim: true },
  phone: { type: String, default: "", trim: true },
  whatsapp: { type: String, default: "", trim: true },
  website: { type: String, default: "", trim: true },
  email: { type: String, default: "", trim: true, lowercase: true },
  currencyAr: { type: String, default: "", trim: true },
  currencyEn: { type: String, default: "", trim: true },
  taxNumber: { type: String, default: "", trim: true },
  shippingCompany: { type: String, default: "" },
  paymentMethod: { type: String, default: "" },
  details: { type: String, default: "" },
  logo: { type: String, default: "" },
  header: { type: String, default: "" },
  footer: { type: String, default: "" },
  stamp: { type: String, default: "" },
  cancelStamp: { type: String, default: "" },
  qrImage: { type: String, default: "" },
  qrLink: { type: String, default: "" },
  img1: { type: String, default: "" },
  link1: { type: String, default: "" },
  link1Type: { type: String, default: "link" },
  file1: { type: String, default: "" },
  img2: { type: String, default: "" },
  link2: { type: String, default: "" },
  link2Type: { type: String, default: "link" },
  file2: { type: String, default: "" },
  footerItems: [footerItemSubSchema],
}, { timestamps: true });

module.exports = mongoose.model("Company", companySchema);
