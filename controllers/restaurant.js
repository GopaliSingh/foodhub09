const Restaurant = require("../models/restaurant.model");
const mongoose = require("mongoose");

async function createRestaurant(req, res) {
    try {
        const restaurant = await Restaurant.create({
            name: req.body.name,
            city: req.body.city,
            address: req.body.address,
            cuisine: req.body.cuisine,
            owner: req.user.id
        });

        res.status(201).send(`
            <div style="
                text-align:center;
                margin-top:100px;
                font-family:Arial;
            ">
                <h1>Restaurant Added Successfully! 🍴</h1>

                <p>${restaurant.name} has been added to FoodHub.</p>

                <a href="/" style="
                    display:inline-block;
                    margin-top:20px;
                    padding:10px 20px;
                    background:#ff6b35;
                    color:white;
                    text-decoration:none;
                    border-radius:6px;
                ">
                    ← Back to FoodHub
                </a>
            </div>
        `);

    } catch (err) {
        console.log(err);

        res.status(500).send(`
            <div style="text-align:center; margin-top:100px;">
                <h1>Failed to Add Restaurant ❌</h1>
                <p>Something went wrong.</p>
                <a href="/">← Back to FoodHub</a>
            </div>
        `);
    }
}

async function getRestaurants(req, res) {
    try {
        const restaurants = await Restaurant.find();

        res.status(200).json({
            success: true,
            data: restaurants
        });

    } catch (err) {
        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}

async function getRestaurantWithFoods(req, res) {
    try {
        const restaurant = await Restaurant.aggregate([
            {
                $match: {
                    _id: new mongoose.Types.ObjectId(req.params.id)
                }
            },
            {
                $lookup: {
                    from: "foods",
                    localField: "_id",
                    foreignField: "restaurant",
                    as: "foods"
                }
            }
        ]);

        if (restaurant.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found"
            });
        }

        res.status(200).json({
            success: true,
            data: restaurant[0]
        });

    } catch (err) {
        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
}

module.exports = {
    createRestaurant,
    getRestaurants,
    getRestaurantWithFoods
};