const cloudinary = require("../config/cloudinary.js");

// Sends an image (held in memory) to Cloudinary and returns its link and ID
const uploadImage = (buffer, folder, options = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `unn-artisans/${folder}`, resource_type: "image", ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });

// Removes an image from Cloudinary. Never crashes the request if it fails.
const deleteImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error("Cloudinary delete failed:", err.message);
  }
};

module.exports = { uploadImage, deleteImage };