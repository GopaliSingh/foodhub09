const express = require("express");
const router = express.Router();
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

        res.status(201).json({
            success: true,
            message: "Restaurant created successfully",
            data: restaurant
        });

    } catch (err) {
        console.log(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
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