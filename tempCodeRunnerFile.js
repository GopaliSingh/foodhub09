require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

const connectDB = require("./config/db");

const Food = require("./models/food.model");
const Restaurant = require("./models/restaurant.model");
const User = require("./models/user");
const Order = require("./models/order.model");

const verifyToken = require("./middleware/verifyToken");
const isAdmin = require("./middleware/admin");

const foodRoutes = require("./routes/food.routes");
const restaurantRoutes = require("./routes/restaurant.routes");

const transporter = require("./config/mail");

const app = express();


// ==========================================
// DATABASE
// ==========================================

connectDB();


// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cookieParser());

app.use(express.urlencoded({
    extended: true
}));

app.use(express.json());

app.use(express.static("public"));

app.use(express.static("uploads"));

app.set("view engine", "ejs");


// ==========================================
// API ROUTES
// ==========================================

// Food routes
app.use("/foods", foodRoutes);

// Restaurant routes
app.use("/restaurants", restaurantRoutes);


// ==========================================
// HOME / STOREFRONT
// ==========================================

app.get("/", async (req, res) => {

    try {

        const search = req.query.search || "";
        const category = req.query.category;
        const sort = req.query.sort;

        let query = {
            name: {
                $regex: search,
                $options: "i"
            }
        };

        if (category && category.trim() !== "") {
            query.category = category;
        }

        const foods = await Food.find(query)
            .populate("restaurant", "name")
            .sort(sort);

        res.render("home", {
            foods
        });

    } catch (err) {

        console.log(err);

        res.status(500).send("Server Error");
    }
});


// ==========================================
// AUTHENTICATION VIEWS
// ==========================================

app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/register", (req, res) => {
    res.render("register");
});


// ==========================================
// ADD FOOD PAGE
// ==========================================

app.get("/add-food", verifyToken, isAdmin, async (req, res) => {

    try {

        const restaurants = await Restaurant.find();

        res.render("addFood", {
            restaurants
        });

    } catch (err) {

        console.log(err);

        res.status(500).send("Server Error");
    }
});


// ==========================================
// ADD FOOD
// ==========================================

app.post("/add-food", verifyToken, isAdmin, async (req, res) => {

    try {

        const food = await Food.create({
            name: req.body.name,
            price: req.body.price,
            category: req.body.category,
            image: req.body.image,
            restaurant: req.body.restaurant
        });

        res.redirect("/");

    } catch (err) {

        console.log(err);

        res.status(500).send("Something went wrong");
    }
});


// ==========================================
// REGISTER
// ==========================================

app.post("/register", async (req, res) => {

    try {

        const hashedPassword = await bcrypt.hash(
            req.body.password,
            10
        );

        await User.create({

            name: req.body.name,

            email: req.body.email,

            password: hashedPassword,

            role: req.body.role || "customer",

            restaurant: req.body.restaurantId || null

        });

        res.send("Registration Successful. Please login.");

    } catch (error) {

        console.log(error);

        res.send("Registration Failed");
    }
});


// ==========================================
// LOGIN
// ==========================================

app.post("/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;

        const user = await User.findOne({
            email
        });

        if (!user) {
            return res.send("User not found");
        }

        const isMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!isMatch) {
            return res.send("Incorrect Password");
        }

        const token = jwt.sign(
            {
                id: user._id,
                role: user.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d"
            }
        );

        res.cookie("token", token, {
            httpOnly: true
        });

        res.send("Login Successful");

    } catch (error) {

        console.log(error);

        res.send("Login Failed");
    }
});


// ==========================================
// ORDERS - CUSTOMER
// ==========================================

app.post("/order", verifyToken, async (req, res) => {

    try {

        const {
            foodId
        } = req.body;

        res.send(
            `Order placed successfully for Food ID: ${foodId}!`
        );

    } catch (error) {

        console.log(error);

        res.status(500).send("Order failed");
    }
});


// ==========================================
// GET CUSTOMER ORDERS
// ==========================================

app.get("/orders", verifyToken, async (req, res) => {

    try {

        const orders = await Order.find({
            user: req.user.id
        })
        .populate("food", "name price image")
        .populate("user", "name email");

        res.status(200).json({

            success: true,

            orders

        });

    } catch (error) {

        console.log(error);

        res.status(500).json({

            success: false,

            message: "Could not fetch orders"

        });
    }
});


// ==========================================
// RESTAURANT DASHBOARD
// ==========================================

app.get(
    "/restaurant-dashboard",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const restaurant = await Restaurant.findOne({
                owner: req.user.id
            });

            if (!restaurant) {
                return res.status(404).send(
                    "Restaurant not found"
                );
            }

            const orders = await Order.find({
                restaurant: restaurant._id
            })
            .populate("user", "name email")
            .populate("food", "name price")
            .sort({ createdAt: -1 });

            res.render("restaurantDashboard", {
                restaurant,
                orders
            });

        } catch (err) {

            console.log(err);

            res.status(500).send("Server Error");
        }
    }
);
app.get(
    "/restaurant-orders",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const restaurant = await Restaurant.findOne({
                owner: req.user.id
            });

            if (!restaurant) {
                return res.status(404).json({
                    success: false,
                    message: "Restaurant not found"
                });
            }

            const orders = await Order.find({
                restaurant: restaurant._id
            })
            .populate("user", "name email")
            .populate("food", "name price")
            .sort({ createdAt: -1 });

            res.status(200).json({
                success: true,
                orders
            });

        } catch (error) {

            console.log(error);

            res.status(500).json({
                success: false,
                message: "Could not fetch restaurant orders"
            });
        }
    }
);

// ==========================================
// UPDATE ORDER STATUS
// ==========================================

app.patch(
    "/orders/:orderId/status",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const {
                status
            } = req.body;

            const allowedStatuses = [

                "pending",

                "confirmed",

                "preparing",

                "delivered",

                "cancelled"

            ];

            if (!allowedStatuses.includes(status)) {

                return res.status(400).json({

                    success: false,

                    message: "Invalid order status"

                });
            }

            const order = await Order.findById(
                req.params.orderId
            );

            if (!order) {

                return res.status(404).json({

                    success: false,

                    message: "Order not found"

                });
            }
const restaurant = await Restaurant.findOne({
    owner: req.user.id
});

if (!restaurant) {

    return res.status(403).json({

        success: false,

        message: "Restaurant not linked"

    });
}

const food = await Food.findOne({

    _id: order.food,

    restaurant: restaurant._id

});

            if (!food) {

                return res.status(403).json({

                    success: false,

                    message: "You cannot update this order"

                });
            }

            order.status = status;

            await order.save();

            res.status(200).json({

                success: true,

                message: "Order status updated",

                order

            });

        } catch (error) {

            console.log(error);

            res.status(500).json({

                success: false,

                message: "Could not update order status"

            });
        }
    }
);


// ==========================================
// FORGOT PASSWORD PAGE
// ==========================================

app.get("/forgot-password", (req, res) => {

    res.render("forgot-password");

});


// ==========================================
// FORGOT PASSWORD
// ==========================================

app.post("/forgot-password", async (req, res) => {

    try {

        const {
            email
        } = req.body;

        const user = await User.findOne({
            email
        });

        if (!user) {

            return res.send(
                "User with this email does not exist"
            );
        }

        const resetToken = jwt.sign(

            {
                id: user._id,

                email: user.email,

                role: user.role

            },

            process.env.JWT_SECRET,

            {
                expiresIn: "15m"
            }

        );

        const resetLink =
            `http://localhost:${process.env.PORT || 3000}/reset-password/${resetToken}`;

        await transporter.sendMail({

            from: process.env.EMAIL,

            to: email,

            subject: "Reset Password",

            text:
                `Click this link to reset your password:\n${resetLink}`

        });

        res.send(
            "Password reset link sent to your email."
        );

    } catch (err) {

        console.log(err);

        res.status(500).send(
            "Error sending email"
        );
    }
});


// ==========================================
// RESET PASSWORD PAGE
// ==========================================

app.get(
    "/reset-password/:token",
    (req, res) => {

        const token = req.params.token;

        res.render("reset-password", {
            token
        });

    }
);


// ==========================================
// RESET PASSWORD
// ==========================================

app.post(
    "/reset-password/:token",
    async (req, res) => {

        try {

            const token = req.params.token;

            const {
                password
            } = req.body;

            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET
            );

            const hashedPassword =
                await bcrypt.hash(password, 10);

            await User.findByIdAndUpdate(

                decoded.id,

                {
                    password: hashedPassword
                }

            );

            res.send(
                "Password Reset Successful"
            );

        } catch (err) {

            console.log(err);

            res.send(
                "Invalid or Expired Link"
            );
        }
    }
);


// ==========================================
// START SERVER
// ==========================================

app.listen(
    process.env.PORT || 3000,
    () => {

        console.log(
            `Server running on port ${process.env.PORT || 3000}`
        );

    }
);