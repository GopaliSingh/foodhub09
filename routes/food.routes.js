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

// GET ALL FOODS
router.get("/", getFoods);

// STATISTICS
router.get("/stats", getFoodStats);
router.get("/dashboard-stats", getFoodDashboardStats);
router.get("/restaurant-stats", getRestaurantStats);
router.get("/category-stats", getCategoryStats);

// CREATE FOOD
router.post("/", createFood);

// GET ONE FOOD
router.get("/:id", getFood);

module.exports = router;