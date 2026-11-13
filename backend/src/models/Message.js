const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // A message needs words OR a photo
    text: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
      required: function () {
        return !(this.image && this.image.url);
      },
    },
    image: { url: String, publicId: String },
    readAt: Date,
  },
  { timestamps: true }
);

messageSchema.index({ booking: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);