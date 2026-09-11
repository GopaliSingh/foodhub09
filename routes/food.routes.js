const express = require("express");
const router = express.Router();

const {
    getFoods,
    createFood,
    getFood,
    getFoodStats,
    getFoodDashboardStats,
    getRestaurantStats,
    getCategoryStats
} = require("../controllers/food.controller");


// Get all foods
router.get("/", getFoods);

// Specific routes MUST come before /:id
router.get("/stats", getFoodStats);
router.get("/dashboard-stats", getFoodDashboardStats);
router.get("/restaurant-stats", getRestaurantStats);
router.get("/category-stats", getCategoryStats);

// Create food
router.post("/", createFood);

// Get single food by ID
router.get("/:id", getFood);

module.exports = router;