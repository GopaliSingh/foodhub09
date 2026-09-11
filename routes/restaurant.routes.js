const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const isAdmin = require("../middleware/admin");
const {
    getRestaurants,
    createRestaurant,
    getRestaurantWithFoods
} = require("../controllers/restaurant");

// GET all restaurants
router.get("/", getRestaurants);

// POST create restaurant
router.post("/", verifyToken, isAdmin, createRestaurant);
// GET one restaurant with its foods
router.get("/:id", getRestaurantWithFoods);

module.exports = router;