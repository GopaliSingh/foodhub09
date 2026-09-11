
const mongoose = require("mongoose");


const foodSchema = new mongoose.Schema({

    name: {
        type: String,//this is a document
        required: true
    },

    price: {
        type: Number,
        required: true//this is another doc
    },

    image: {
        type: String,
        required: true//this is another doc
    }

});

const Food = mongoose.model("Food", foodSchema);

module.exports = Food;