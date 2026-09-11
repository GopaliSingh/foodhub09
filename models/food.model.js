const mongoose = require("mongoose");

const foodSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    image: {
        type: String
    },
    category: {
      type: String,
     required: true

    },

    restaurant: {//stores id
        type: mongoose.Schema.Types.ObjectId,
        ref: "Restaurant",
        required: true
    }
}
, { timestamps: true });

module.exports = mongoose.model("Food", foodSchema);