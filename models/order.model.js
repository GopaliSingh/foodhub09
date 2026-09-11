           const mongoose = require("mongoose");
           const orderSchema = new mongoose.Schema({
            user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
},

food: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Food",
    required: true
},

restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Restaurant",
    required: true
},
   quantity: {
    type: Number,
    required: true,
    min: 1
},

price: {
    type: Number,
    required: true
},

total: {
    type: Number,
    required: true
},

status: {
    type: String,
    enum: [
        "pending",
        "confirmed",
        "preparing",
        "delivered",
        "cancelled"
    ],
    default: "pending"
},

paymentStatus: {
    type: String,
    enum: ["pending", "paid", "failed"],
    default: "pending"
},

paymentId: {
    type: String,
    default: null
},

razorpayOrderId: {
    type: String,
    default: null
}});

module.exports = mongoose.model("Order", orderSchema);