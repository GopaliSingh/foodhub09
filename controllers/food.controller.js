const Food = require("../models/food.model");
const Restaurant = require("../models/restaurant.model");


// ==========================================
// 1. GET ALL FOODS
// ==========================================
async function getFoods(req, res) {
    try {

        const {
            search,
            category,
            minPrice,
            maxPrice,
            sort
        } = req.query;

        const filter = {};

        // Search by food name
        if (search) {
            filter.name = {
                $regex: search,
                $options: "i"
            };
        }

        // Filter by category
        if (category) {
            filter.category = category;
        }

        // Price filter
        if (minPrice || maxPrice) {

            filter.price = {};

            if (minPrice) {
                filter.price.$gte = Number(minPrice);
            }

            if (maxPrice) {
                filter.price.$lte = Number(maxPrice);
            }
        }

        // Sorting
        let sortOption = {};

        if (sort === "price") {
            sortOption.price = 1;
        }

        // Pagination
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;

        const skip = (page - 1) * limit;

        const foods = await Food.find(filter)
            .sort(sortOption)
            .skip(skip)
            .limit(limit)
            .populate("restaurant");

        res.status(200).json({
            success: true,
            page,
            limit,
            data: foods
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// 2. CREATE FOOD
// ==========================================
async function createFood(req, res) {
    try {

        const food = await Food.create({
            name: req.body.name,
            price: req.body.price,
            category: req.body.category,
            image: req.body.image,
            restaurant: req.body.restaurant
        });

        res.status(201).json({
            success: true,
            message: "Food created successfully",
            data: food
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// 3. GET ONE FOOD
// ==========================================
async function getFood(req, res) {
    try {

        const food = await Food.findById(req.params.id)
            .populate("restaurant");

        if (!food) {
            return res.status(404).json({
                success: false,
                message: "Food not found"
            });
        }

        res.status(200).json({
            success: true,
            data: food
        });

    } catch (err) {

        if (err.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid food ID"
            });
        }

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// 4. GET RESTAURANT WITH ITS FOODS
// ==========================================
async function getRestaurant(req, res) {
    try {

        const restaurant = await Restaurant.findById(req.params.id);

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found"
            });
        }

        const foods = await Food.find({
            restaurant: req.params.id
        });

        res.status(200).json({
            success: true,
            data: {
                restaurant,
                foods
            }
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// 5. FOOD STATISTICS
// ==========================================
async function getFoodStats(req, res) {
    try {

        const stats = await Food.aggregate([

            {
                $group: {
                    _id: null,

                    totalFoods: {
                        $sum: 1
                    },

                    averagePrice: {
                        $avg: "$price"
                    },

                    minimumPrice: {
                        $min: "$price"
                    },

                    maximumPrice: {
                        $max: "$price"
                    }
                }
            }

        ]);

        res.status(200).json({
            success: true,
            data: stats[0]
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// 6. FOOD DASHBOARD STATISTICS
// ==========================================
async function getFoodDashboardStats(req, res) {
    try {

        const stats = await Food.aggregate([

            {
                $facet: {

                    overall: [

                        {
                            $group: {
                                _id: null,

                                totalFoods: {
                                    $sum: 1
                                },

                                averagePrice: {
                                    $avg: "$price"
                                },

                                minimumPrice: {
                                    $min: "$price"
                                },

                                maximumPrice: {
                                    $max: "$price"
                                }
                            }
                        }

                    ],

                    categoryStats: [

                        {
                            $group: {
                                _id: "$category",

                                totalFoods: {
                                    $sum: 1
                                }
                            }
                        },

                        {
                            $sort: {
                                totalFoods: -1
                            }
                        }

                    ]

                }
            }

        ]);

        res.status(200).json({
            success: true,
            data: stats[0]
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// 7. RESTAURANT FOOD STATISTICS
// ==========================================
async function getRestaurantStats(req, res) {
    try {

        const category = req.query.category;

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 3;

        const skip = (page - 1) * limit;

        const matchStage = {};

        if (category) {
            matchStage.category = category;
        }

        const stats = await Food.aggregate([

            // FILTER
            {
                $match: matchStage
            },

            // GROUP BY RESTAURANT
            {
                $group: {
                    _id: "$restaurant",

                    totalFoods: {
                        $sum: 1
                    },

                    averagePrice: {
                        $avg: "$price"
                    },

                    minimumPrice: {
                        $min: "$price"
                    },

                    maximumPrice: {
                        $max: "$price"
                    }
                }
            },

            // JOIN RESTAURANT
            {
                $lookup: {
                    from: "restaurants",
                    localField: "_id",
                    foreignField: "_id",
                    as: "restaurant"
                }
            },

            // CONVERT ARRAY TO OBJECT
            {
                $unwind: "$restaurant"
            },

            // SELECT REQUIRED FIELDS
            {
                $project: {
                    _id: 0,

                    restaurantName: "$restaurant.name",

                    totalFoods: 1,

                    averagePrice: 1,

                    minimumPrice: 1,

                    maximumPrice: 1
                }
            },

            // HIGHEST AVERAGE PRICE FIRST
            {
                $sort: {
                    averagePrice: -1
                }
            },

            // PAGINATION
            {
                $skip: skip
            },

            {
                $limit: limit
            }

        ]);

        res.status(200).json({
            success: true,
            page,
            limit,
            data: stats
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// 8. CATEGORY STATISTICS
// ==========================================
async function getCategoryStats(req, res) {
    try {

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 3;

        const skip = (page - 1) * limit;

        const stats = await Food.aggregate([

            // GROUP BY CATEGORY
            {
                $group: {
                    _id: "$category",

                    totalFoods: {
                        $sum: 1
                    },

                    averagePrice: {
                        $avg: "$price"
                    },

                    minimumPrice: {
                        $min: "$price"
                    },

                    maximumPrice: {
                        $max: "$price"
                    }
                }
            },

            // SORT
            {
                $sort: {
                    averagePrice: -1
                }
            },

            // PAGINATION
            {
                $skip: skip
            },

            {
                $limit: limit
            },

            // CLEAN RESPONSE
            {
                $project: {
                    _id: 0,

                    category: "$_id",

                    totalFoods: 1,

                    averagePrice: 1,

                    minimumPrice: 1,

                    maximumPrice: 1
                }
            }

        ]);

        res.status(200).json({
            success: true,
            page,
            limit,
            data: stats
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}


// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    getFoods,
    createFood,
    getFood,
    getRestaurant,
    getFoodStats,
    getFoodDashboardStats,
    getRestaurantStats,
    getCategoryStats
};