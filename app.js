require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const connectDB = require("./config/db");

const Food = require("./models/food.model");
const Restaurant = require("./models/restaurant.model");
const User = require("./models/user");
const Order = require("./models/order.model");
const Cart = require("./models/cartsmodel");
const Message = require("./models/messagemodel");

const verifyToken = require("./middleware/verifyToken");
const isAdmin = require("./middleware/admin");

const foodRoutes = require("./routes/food.routes");
const restaurantRoutes = require("./routes/restaurant.routes");
const transporter = require("./config/mail");

const multer = require("multer");
const http = require("http");
const { Server } = require("socket.io");
const Razorpay = require("razorpay");

const app = express();
const server = http.createServer(app);


// ==================================================
// MIDDLEWARE
// ==================================================

app.use(cookieParser());

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(express.json());

app.use(express.static("public"));
app.use(express.static("uploads"));

app.set("view engine", "ejs");


// ==================================================
// UPLOAD
// ==================================================

const upload = multer({
    dest: "uploads/"
});


// ==================================================
// RAZORPAY
// ==================================================

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});


// ==================================================
// SOCKET.IO
// ==================================================

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});


// ==================================================
// ADMIN STATISTICS
// ==================================================

app.get(
    "/admin/statistics",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const [
                totalUsers,
                totalRestaurants,
                totalFoods,
                totalOrders,
                paidOrders,
                pendingOrders,
                cancelledOrders
            ] = await Promise.all([

                User.countDocuments(),

                Restaurant.countDocuments(),

                Food.countDocuments(),

                Order.countDocuments(),

                Order.countDocuments({
                    paymentStatus: "paid"
                }),

                Order.countDocuments({
                    status: "pending"
                }),

                Order.countDocuments({
                    status: "cancelled"
                })

            ]);


            const revenueResult =
                await Order.aggregate([

                    {
                        $match: {
                            paymentStatus: "paid"
                        }
                    },

                    {
                        $group: {
                            _id: null,

                            totalRevenue: {
                                $sum: "$total"
                            }
                        }
                    }

                ]);


            const totalRevenue =
                revenueResult.length > 0
                    ? revenueResult[0].totalRevenue
                    : 0;


            res.render(
                "admin-statistics",
                {
                    totalUsers,
                    totalRestaurants,
                    totalFoods,
                    totalOrders,
                    paidOrders,
                    pendingOrders,
                    cancelledOrders,
                    totalRevenue
                }
            );

        } catch (error) {

            console.log(
                "Admin statistics error:",
                error
            );

            res.status(500).send(
                "Error loading admin statistics"
            );

        }

    }
);


// ==================================================
// RAZORPAY PAYMENT VERIFICATION
// ==================================================

app.post(
    "/orders/:orderId/payment/verify",
    verifyToken,
    async (req, res) => {

        try {

            const {
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature
            } = req.body;


            const order =
                await Order.findById(
                    req.params.orderId
                );


            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found"

                });

            }


            if (
                order.user.toString() !==
                req.user.id.toString()
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You cannot verify this payment"

                });

            }


            if (
                order.razorpayOrderId !==
                razorpay_order_id
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid Razorpay order"

                });

            }


            const generatedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        process.env.RAZORPAY_KEY_SECRET
                    )
                    .update(
                        razorpay_order_id +
                        "|" +
                        razorpay_payment_id
                    )
                    .digest("hex");


            if (
                generatedSignature !==
                razorpay_signature
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment verification failed"

                });

            }


            order.paymentStatus =
                "paid";


            order.paymentId =
                razorpay_payment_id;


            await order.save();


            res.status(200).json({

                success: true,

                message:
                    "Payment verified successfully"

            });

        } catch (error) {

            console.log(error);

            res.status(500).json({

                success: false,

                message:
                    "Payment verification failed"

            });

        }

    }
);
// ==================================================
// HOME
// ==================================================


// ==================================================
// SOCKET AUTHENTICATION
// ==================================================

io.use(
    async (socket, next) => {

        try {

            const token =
                socket.handshake.auth.token;


            if (!token) {

                return next(
                    new Error(
                        "Authentication required"
                    )
                );

            }


            const decoded =
                jwt.verify(
                    token,
                    process.env.JWT_SECRET
                );


            const user =
                await User.findById(
                    decoded.id
                );


            if (!user) {

                return next(
                    new Error(
                        "User not found"
                    )
                );

            }


            // Store logged-in user's ID
            socket.userId =
                user._id;


            // Find restaurant associated with this user
            let restaurant = null;


            // First check the user's restaurant field
            if (user.restaurant) {

                restaurant =
                    await Restaurant.findById(
                        user.restaurant
                    );

            }


            // Fallback: find restaurant by owner
            if (!restaurant) {

                restaurant =
                    await Restaurant.findOne({
                        owner: user._id
                    });

            }


            // Store restaurant ID for Socket.IO authorization
            if (restaurant) {

                socket.restaurantId =
                    restaurant._id;

            }


            next();

        } catch (error) {

            console.log(error);

            next(
                new Error(
                    "Invalid token"
                )
            );

        }

    }
);


// ==================================================
// SOCKET CHAT
// ==================================================

io.on(
    "connection",
    (socket) => {

        console.log(
            "A user connected"
        );


        // ==========================================
        // JOIN ORDER CHAT
        // ==========================================

        socket.on(
            "joinRoom",
            async (orderId) => {

                try {

                    const order =
                        await Order
                            .findById(orderId)
                            .populate("food");


                    if (!order) {

                        return;

                    }


                    const isCustomer =
                        order.user.toString() ===
                        socket.userId.toString();


                    let isRestaurant =
                        false;


                    if (
                        socket.restaurantId &&
                        order.food
                    ) {

                        isRestaurant =
                            order.food.restaurant.toString() ===
                            socket.restaurantId.toString();

                    }


                    if (
                        !isCustomer &&
                        !isRestaurant
                    ) {

                        console.log(
                            "Unauthorized room access"
                        );

                        return;

                    }


                    const roomId =
                        `order_${orderId}`;


                    socket.join(
                        roomId
                    );


                    console.log(
                        `Joined room: ${roomId}`
                    );

                } catch (error) {

                    console.log(
                        error
                    );

                }

            }
        );


        // ==========================================
        // SEND MESSAGE
        // ==========================================

        socket.on(
            "sendMessage",
            async ({ orderId, text }) => {

                try {

                    if (
                        !text ||
                        !text.trim()
                    ) {

                        return;

                    }


                    const order =
                        await Order
                            .findById(orderId)
                            .populate("food");


                    if (!order) {

                        return;

                    }


                    const isCustomer =
                        order.user.toString() ===
                        socket.userId.toString();


                    let isRestaurant =
                        false;


                    if (
                        socket.restaurantId &&
                        order.food
                    ) {

                        isRestaurant =
                            order.food.restaurant.toString() ===
                            socket.restaurantId.toString();

                    }


                    if (
                        !isCustomer &&
                        !isRestaurant
                    ) {

                        console.log(
                            "Unauthorized message attempt"
                        );

                        return;

                    }


                    const message =
                        await Message.create({

                            order:
                                orderId,

                            sender:
                                socket.userId,

                            text:
                                text.trim()

                        });


                    const populatedMessage =
                        await Message
                            .findById(
                                message._id
                            )
                            .populate(
                                "sender",
                                "name"
                            );


                    io
                        .to(
                            `order_${orderId}`
                        )
                        .emit(
                            "receiveMessage",
                            populatedMessage
                        );


                } catch (error) {

                    console.log(
                        error
                    );

                }

            }
        );


        // ==========================================
        // DISCONNECT
        // ==========================================

        socket.on(
            "disconnect",
            () => {

                console.log(
                    "A user disconnected"
                );

            }
        );

    }
);


// ==================================================
// ORDER STATUS TRANSITIONS
// ==================================================

const allowedTransitions = {

    pending: [
        "confirmed",
        "cancelled"
    ],

    confirmed: [
        "preparing"
    ],

    preparing: [
        "delivered"
    ],

    delivered: [],

    cancelled: []

};


// ==================================================
// DATABASE
// ==================================================

connectDB();


// ==================================================
// ROUTES
// ==================================================

app.use(
    "/foods",
    foodRoutes
);

app.use(
    "/restaurants",
    restaurantRoutes
);


// ==================================================
// HOME
// ==================================================

// ==========================================
// HOME / STOREFRONT
// ==========================================
// ==========================================
// ADMIN FOOD MANAGEMENT
// ==========================================

// EDIT FOOD PAGE
app.get(
    "/admin/foods/:id/edit",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const food = await Food.findById(req.params.id);

            if (!food) {
                return res.status(404).send("Food not found");
            }

            res.render("editFood", {
                food
            });

        } catch (error) {

            console.log(error);

            res.status(500).send("Server Error");
        }
    }
);


// UPDATE FOOD
app.post(
    "/admin/foods/:id/update",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            await Food.findByIdAndUpdate(
                req.params.id,
                {
                    name: req.body.name,
                    price: req.body.price,
                    category: req.body.category,
                    image: req.body.image
                },
                {
                    new: true
                }
            );

            res.redirect("/restaurant-dashboard");

        } catch (error) {

            console.log(error);

            res.status(500).send("Could not update food");
        }
    }
);


// DELETE FOOD
app.post(
    "/admin/foods/:id/delete",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            await Food.findByIdAndDelete(req.params.id);

            res.redirect("/restaurant-dashboard");

        } catch (error) {

            console.log(error);

            res.status(500).send("Could not delete food");
        }
    }
);
app.get("/", async (req, res) => {
    try {

        const search = req.query.search || "";
        const category = req.query.category || "";
        const minPrice = req.query.minPrice;
        const maxPrice = req.query.maxPrice;
        const sort = req.query.sort || "";

        const query = {};

        // ================= SEARCH =================

        if (search.trim() !== "") {
            query.name = {
                $regex: search.trim(),
                $options: "i"
            };
        }

        // ================= CATEGORY =================

        if (category.trim() !== "") {
            query.category = category.trim();
        }

        // ================= PRICE FILTER =================

        if (minPrice || maxPrice) {

            query.price = {};

            if (minPrice) {
                query.price.$gte = Number(minPrice);
            }

            if (maxPrice) {
                query.price.$lte = Number(maxPrice);
            }
        }

        // ================= SORT =================

        let sortOption = {};

        if (sort === "price_asc") {
            sortOption.price = 1;
        } 
        else if (sort === "price_desc") {
            sortOption.price = -1;
        } 
        else if (sort === "name_asc") {
            sortOption.name = 1;
        }

        // ================= GET FOODS =================

        const foods = await Food.find(query)
            .populate("restaurant", "name")
            .sort(sortOption);

        // ================= CHECK LOGIN =================

        let isLoggedIn = false;
        let isAdminUser = false;

        const token = req.cookies.token;

        if (token) {

            try {

                const decoded = jwt.verify(
                    token,
                    process.env.JWT_SECRET
                );

                isLoggedIn = true;

                if (decoded.role === "admin") {
                    isAdminUser = true;
                }

            } catch (error) {

                // Invalid/expired token
                isLoggedIn = false;
                isAdminUser = false;

            }
        }

        // ================= RENDER HOME =================

        res.render("home", {
            foods,
            isLoggedIn,
            isAdminUser
        });

    } catch (err) {

        console.log(err);

        res.status(500).send("Server Error");
    }
});
// ==================================================
// LOGIN / REGISTER PAGES
// ==================================================

app.get(
    "/login",
    (req, res) => {

        res.render(
            "login"
        );

    }
);


app.get(
    "/register",
    (req, res) => {

        res.render(
            "register"
        );

    }
);


// ==================================================
// ADD FOOD PAGE
// ==================================================

app.get(
    "/add-food",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const restaurants =
                await Restaurant.find();


            res.render(
                "addfood",
                {
                    restaurants
                }
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error loading add food page"
            );

        }

    }
);


// ==================================================
// ADD FOOD
// ==================================================

app.post(
    "/add-food",
    verifyToken,
    isAdmin,
    upload.single("image"),
    async (req, res) => {

        try {

            const {
                name,
                price,
                category,
                restaurant
            } = req.body;


            const image =
                req.file
                    ? req.file.filename
                    : null;


            const food =
                new Food({

                    name,

                    price,

                    category,

                    restaurant,

                    image

                });


            await food.save();


            res.redirect(
                "/foods"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error adding food"
            );

        }

    }
);


// ==================================================
// PLACE SINGLE FOOD ORDER
// ==================================================

app.post(
    "/orders",
    verifyToken,
    async (req, res) => {

        try {

            const {
                foodId,
                quantity
            } = req.body;


            const food =
                await Food.findById(
                    foodId
                );


            if (!food) {

                return res
                    .status(404)
                    .send(
                        "Food not found"
                    );

            }


            const orderQuantity =
                Number(quantity);


            if (
                !Number.isInteger(
                    orderQuantity
                ) ||
                orderQuantity < 1
            ) {

                return res
                    .status(400)
                    .send(
                        "Invalid quantity"
                    );

            }


            const totalPrice =
                food.price *
                orderQuantity;


            const order =
                new Order({

                    user:
                        req.user.id,

                    food:
                        food._id,

                    restaurant:
                        food.restaurant,

                    quantity:
                        orderQuantity,

                    price:
                        food.price,

                    total:
                        totalPrice,

                    status:
                        "pending"

                });


            await order.save();


            res.send(
                "Order placed successfully"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error placing order"
            );

        }

    }
);


// ==================================================
// REGISTER
// ==================================================
app.post(
    "/register",
    async (req, res) => {

        try {

            const hashedPassword =
                await bcrypt.hash(
                    req.body.password,
                    10
                );

            await User.create({

                name:
                    req.body.name,

                email:
                    req.body.email,

                password:
                    hashedPassword,

                role:
                    req.body.role,

                restaurant:
                    req.body.restaurantId || null

            });

            res.send(
                "Registration Successful. Please login."
            );

        } catch (error) {

            console.log(error);

            res.send(
                "Registration Failed"
            );

        }

    }
);

// ==================================================
// LOGIN
// ==================================================

app.post(
    "/login",
    async (req, res) => {

        try {

            const {
                email,
                password
            } = req.body;


            const user =
                await User.findOne({
                    email
                });


            if (!user) {

                return res.send(
                    "User not found"
                );

            }


            const isMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );


            if (!isMatch) {

                return res.send(
                    "Incorrect Password"
                );

            }


            const token =
                jwt.sign(

                    {
                        id:
                            user._id,

                        role:
                            user.role

                    },

                    process.env.JWT_SECRET,

                    {
                        expiresIn:
                            "1d"
                    }

                );


            res.cookie(
                "token",
                token,
                {
                    httpOnly: true
                }
            );


            res.redirect(
                "/"
            );

        } catch (error) {

            console.log(error);

            res.send(
                "Login Failed"
            );

        }

    }
);


// ==================================================
// ADD RESTAURANT PAGE
// ==================================================

app.get(
    "/add-restaurant",
    verifyToken,
    isAdmin,
    (req, res) => {

        res.render(
            "addRestaurant"
        );

    }
);


// ==================================================
// GET CUSTOMER ORDERS API
// ==================================================

app.get(
    "/orders",
    verifyToken,
    async (req, res) => {

        try {

            const orders =
                await Order.find({
                    user:
                        req.user.id
                })
                .populate(
                    "food",
                    "name price image"
                )
                .populate(
                    "user",
                    "name email"
                );


            res.status(200).json({

                success: true,

                orders

            });

        } catch (error) {

            console.log(error);

            res.status(500).json({

                success: false,

                message:
                    "Could not fetch orders"

            });

        }

    }
);


// ==================================================
// RESTAURANT DASHBOARD
// ==================================================

app.get(
    "/restaurant-dashboard",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const restaurant =
                await Restaurant.findOne({
                    owner:
                        req.user.id
                });


            if (!restaurant) {

                return res
                    .status(404)
                    .send(
                        "Restaurant not found"
                    );

            }


            // Get foods belonging to this restaurant
            const foods =
                await Food.find({
                    restaurant:
                        restaurant._id
                });


            const orders =
                await Order.find({
                    restaurant:
                        restaurant._id
                })
                .populate(
                    "user",
                    "name email"
                )
                .populate(
                    "food",
                    "name price image"
                )
                .sort({
                    createdAt: -1
                });


            res.render(
                "restaurantDashboard",
                {
                    restaurant,
                    foods,
                    orders
                }
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Server Error"
            );

        }

    }
);


// ==================================================
// RESTAURANT ORDERS
// ==================================================

app.get(
    "/restaurant-orders",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const restaurant =
                await Restaurant.findOne({
                    owner:
                        req.user.id
                });


            if (!restaurant) {

                return res
                    .status(404)
                    .send(
                        "Restaurant not found"
                    );

            }


            const orders =
                await Order.find({
                    restaurant:
                        restaurant._id
                })
                .populate(
                    "user",
                    "name email"
                )
                .populate(
                    "food",
                    "name price"
                )
                .sort({
                    createdAt: -1
                });


            res.render(
                "restaurantorders",
                {
                    orders
                }
            );

        } catch (error) {

            console.log(error);

            res.status(500).send(
                "Error fetching restaurant orders"
            );

        }

    }
);


// ==================================================
// UPDATE ORDER STATUS - API
// ==================================================
app.post(
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


            if (
                !allowedStatuses.includes(
                    status
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Invalid order status"

                    });

            }


            const restaurant =
                await Restaurant.findOne({
                    owner:
                        req.user.id
                });


            if (!restaurant) {

                return res
                    .status(403)
                    .json({

                        success: false,

                        message:
                            "Restaurant not linked"

                    });

            }


            const order =
                await Order.findOne({

                    _id:
                        req.params.orderId,

                    restaurant:
                        restaurant._id

                });


            if (!order) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Order not found"

                    });

            }


            if (
                !allowedTransitions[
                    order.status
                ].includes(status)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            `Cannot change order from ${order.status} to ${status}`

                    });

            }


            order.status =
                status;


            await order.save();


            res.status(200).json({

                success: true,

                message:
                    "Order status updated",

                order

            });

        } catch (error) {

            console.log(error);

            res.status(500).json({

                success: false,

                message:
                    "Could not update order status"

            });

        }

    }
);


// ==================================================
// FORGOT PASSWORD PAGE
// ==================================================

app.get(
    "/forgot-password",
    (req, res) => {

        res.render(
            "forgot-password"
        );

    }
);


// ==================================================
// FORGOT PASSWORD
// ==================================================

app.post(
    "/forgot-password",
    async (req, res) => {

        try {

            const {
                email
            } = req.body;


            const user =
                await User.findOne({
                    email
                });


            if (!user) {

                return res.send(
                    "User with this email does not exist"
                );

            }


            const resetToken =
                jwt.sign(

                    {
                        id:
                            user._id,

                        email:
                            user.email,

                        role:
                            user.role

                    },

                    process.env.JWT_SECRET,

                    {
                        expiresIn:
                            "15m"
                    }

                );


            const resetLink =
                `http://localhost:${process.env.PORT || 3000}/reset-password/${resetToken}`;


            await transporter.sendMail({

                from:
                    process.env.EMAIL,

                to:
                    email,

                subject:
                    "Reset Password",

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

    }
);

app.get(
    "/restaurant/dashboard",
    verifyToken,
    isAdmin,
    async (req, res) => {
        try {

            const user = await User.findById(req.user.id);

            if (!user) {
                return res.status(404).send("User not found");
            }

            let foods = [];
            let orders = [];
            let restaurant = null;

            // Get admin's restaurant
            if (user.restaurant) {

                restaurant = await Restaurant.findById(
                    user.restaurant
                );

                // Get restaurant foods
                foods = await Food.find({
                    restaurant: user.restaurant
                });

                // Get food IDs
                const foodIds = foods.map(
                    food => food._id
                );

                // Get restaurant orders
                orders = await Order.find({
                    food: {
                        $in: foodIds
                    }
                })
                .populate("user", "name email")
                .populate("food", "name price image");

            }

            res.render("restaurantDashboard", {
                foods,
                orders,
                restaurant

            });

        } catch (error) {

            console.log(error);

            res.status(500).send("Server Error");
        }
    }
);

// ==========================================
// ADMIN FOOD MANAGEMENT
// ==========================================

// EDIT FOOD PAGE
app.get(
    "/admin/foods/:id/edit",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const food = await Food.findById(req.params.id);

            if (!food) {
                return res.status(404).send("Food not found");
            }

            res.render("editFood", {
                food
            });

        } catch (error) {

            console.log(error);

            res.status(500).send("Server Error");
        }
    }
);


// UPDATE FOOD
app.post(
    "/admin/foods/:id/update",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            await Food.findByIdAndUpdate(
                req.params.id,
                {
                    name: req.body.name,
                    price: req.body.price,
                    category: req.body.category,
                    image: req.body.image
                },
                {
                    new: true
                }
            );

            res.redirect("/restaurant-dashboard");

        } catch (error) {

            console.log(error);

            res.status(500).send("Could not update food");
        }
    }
);


// DELETE FOOD
app.post(
    "/admin/foods/:id/delete",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            await Food.findByIdAndDelete(req.params.id);

            res.redirect("/restaurant-dashboard");

        } catch (error) {

            console.log(error);

            res.status(500).send("Could not delete food");
        }
    }
);



// ==================================================
// HOME PAGE
// ==================================================

app.get("/", async (req, res) => {

    try {

        // ================= QUERY PARAMETERS =================

        const search = req.query.search || "";
        const category = req.query.category || "";
        const minPrice = req.query.minPrice;
        const maxPrice = req.query.maxPrice;
        const sort = req.query.sort || "";


        // ================= BUILD FILTER =================

        const query = {};


        // SEARCH

        if (search.trim() !== "") {

            query.name = {
                $regex: search.trim(),
                $options: "i"
            };

        }


        // CATEGORY

        if (category.trim() !== "") {

            query.category = category.trim();

        }


        // PRICE FILTER

        if (minPrice || maxPrice) {

            query.price = {};


            if (minPrice) {

                query.price.$gte = Number(minPrice);

            }


            if (maxPrice) {

                query.price.$lte = Number(maxPrice);

            }

        }


        // ================= SORT =================

        let sortOption = {};


        if (sort === "price" || sort === "price_asc") {

            sortOption.price = 1;

        }

        else if (sort === "price_desc") {

            sortOption.price = -1;

        }

        else if (sort === "name_asc") {

            sortOption.name = 1;

        }


        // ================= GET FOODS =================

        const foods = await Food.find(query)
            .populate("restaurant", "name")
            .sort(sortOption);


        // ================= LOGIN / ADMIN STATUS =================

        let isLoggedIn = false;
        let isAdminUser = false;


        const token = req.cookies.token;


        if (token) {

            try {

                const decoded = jwt.verify(
                    token,
                    process.env.JWT_SECRET
                );


                isLoggedIn = true;

                isAdminUser = decoded.role === "admin";

            }

            catch (error) {

                // Invalid or expired token
                isLoggedIn = false;
                isAdminUser = false;

            }

        }


        // ================= RENDER HOME =================

        res.render("home", {

            foods,

            isLoggedIn,

            isAdminUser

        });

    }

    catch (err) {

        console.log(err);

        res.status(500).send("Server Error");

    }

});
app.get(
    "/foods/:id/edit",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const food = await Food.findById(req.params.id);

            if (!food) {
                return res.status(404).send("Food not found");
            }

            const restaurants = await Restaurant.find();

            res.render("editfood", {
                food,
                restaurants
            });

        } catch (err) {

            console.log(err);

            res.status(500).send("Server Error");

        }

    }
);
// ==================================================
// RESET PASSWORD PAGE
// ==================================================

app.get(
    "/reset-password/:token",
    (req, res) => {

        res.render(
            "reset-password",
            {
                token:
                    req.params.token
            }
        );

    }
);
app.post(
    "/foods/:id/edit",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const {
                name,
                price,
                category,
                restaurant
            } = req.body;


            await Food.findByIdAndUpdate(
                req.params.id,
                {
                    name,
                    price,
                    category,
                    restaurant
                },
                {
                    new: true,
                    runValidators: true
                }
            );
    

            res.redirect("/foods");

        } catch (err) {

            console.log(err);

            res.status(500).send("Server Error");

        }

    }
);
app.post(
    "/foods/:id/delete",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            await Food.findByIdAndDelete(req.params.id);

            res.redirect("/foods");

        } catch (err) {

            console.log(err);

            res.status(500).send("Server Error");

        }

    }
);
// ==================================================
// RESET PASSWORD
// ==================================================

app.post(
    "/reset-password/:token",
    async (req, res) => {

        try {

            const {
                password,
                confirmPassword
            } = req.body;


            if (
                password !==
                confirmPassword
            ) {

                return res.send(
                    "Passwords do not match"
                );

            }


            const decoded =
                jwt.verify(
                    req.params.token,
                    process.env.JWT_SECRET
                );


            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );


            await User.findByIdAndUpdate(

                decoded.id,

                {
                    password:
                        hashedPassword
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


// ==================================================
// CART - ADD
// ==================================================

app.post(
    "/cart/add",
    verifyToken,
    async (req, res) => {

        try {

            const {
                foodId
            } = req.body;


            const food =
                await Food.findById(
                    foodId
                );


            if (!food) {

                return res
                    .status(404)
                    .send(
                        "Food not found"
                    );

            }


            let cart =
                await Cart.findOne({
                    user:
                        req.user.id
                });


            if (!cart) {

                cart =
                    new Cart({

                        user:
                            req.user.id,

                        items: [

                            {
                                food:
                                    foodId,

                                quantity:
                                    1

                            }

                        ]

                    });

            } else {

                const existingItem =
                    cart.items.find(

                        item =>
                            item.food.toString() ===
                            foodId

                    );


                if (existingItem) {

                    existingItem.quantity +=
                        1;

                } else {

                    cart.items.push({

                        food:
                            foodId,

                        quantity:
                            1

                    });

                }

            }


            await cart.save();


            res.redirect(
                "/cart"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error adding to cart"
            );

        }

    }
);

app.get("/restaurant-dashboard", verifyToken, async (req, res) => {
    try {

        const restaurant = await Restaurant.findOne({
            owner: req.user.id
        });

        const orders = await Order.find({
            restaurant: restaurant._id
        });

        const foods = await Food.find({
            restaurant: restaurant._id
        });

        res.render("restaurantDashboard", {
            restaurant,
            orders,
            foods
        });

    } catch (err) {

        console.log(err);
        res.status(500).send("Server Error");

    }
});
// ==================================================
// CART - VIEW
// ==================================================

app.get(
    "/cart",
    verifyToken,
    async (req, res) => {

        try {

            const cart =
                await Cart.findOne({
                    user:
                        req.user.id
                })
                .populate(
                    "items.food"
                );


            res.render(
                "cart",
                {
                    cart
                }
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error loading cart"
            );

        }

    }
);


// ==================================================
// CART - UPDATE
// ==================================================

app.post(
    "/cart/update",
    verifyToken,
    async (req, res) => {

        try {

            const {
                foodId,
                quantity
            } = req.body;


            const newQuantity =
                Number(quantity);


            if (
                !Number.isInteger(
                    newQuantity
                ) ||
                newQuantity < 1
            ) {

                return res
                    .status(400)
                    .send(
                        "Invalid quantity"
                    );

            }


            const cart =
                await Cart.findOne({
                    user:
                        req.user.id
                });


            if (!cart) {

                return res
                    .status(404)
                    .send(
                        "Cart not found"
                    );

            }


            const item =
                cart.items.find(

                    item =>
                        item.food.toString() ===
                        foodId

                );


            if (!item) {

                return res
                    .status(404)
                    .send(
                        "Food not found in cart"
                    );

            }


            item.quantity =
                newQuantity;


            await cart.save();


            res.redirect(
                "/cart"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error updating cart"
            );

        }

    }
);


// ==================================================
// CART - REMOVE
// ==================================================

app.post(
    "/cart/remove",
    verifyToken,
    async (req, res) => {

        try {

            const {
                foodId
            } = req.body;


            const cart =
                await Cart.findOne({
                    user:
                        req.user.id
                });


            if (!cart) {

                return res
                    .status(404)
                    .send(
                        "Cart not found"
                    );

            }


            cart.items =
                cart.items.filter(

                    item =>
                        item.food.toString() !==
                        foodId

                );


            await cart.save();


            res.redirect(
                "/cart"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error removing item"
            );

        }

    }
);


// ==================================================
// CHECKOUT
// ==================================================

app.post(
    "/checkout",
    verifyToken,
    async (req, res) => {

        try {

            const cart =
                await Cart.findOne({
                    user:
                        req.user.id
                })
                .populate(
                    "items.food"
                );


            if (
                !cart ||
                cart.items.length === 0
            ) {

                return res
                    .status(400)
                    .send(
                        "Cart is empty"
                    );

            }


            for (
                const item of cart.items
            ) {

                if (!item.food) {

                    continue;

                }


                const totalPrice =
                    item.food.price *
                    item.quantity;


                await Order.create({

                    user:
                        req.user.id,

                    food:
                        item.food._id,

                    restaurant:
                        item.food.restaurant,

                    quantity:
                        item.quantity,

                    price:
                        item.food.price,

                    total:
                        totalPrice,

                    status:
                        "pending"

                });

            }


            cart.items =
                [];


            await cart.save();


            res.redirect(
                "/my-orders"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Checkout failed"
            );

        }

    }
);


// ==================================================
// RESTAURANT ORDER STATUS - FORM
// ==================================================

app.post(
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


            if (
                !allowedStatuses.includes(
                    status
                )
            ) {

                return res
                    .status(400)
                    .send(
                        "Invalid status"
                    );

            }


            const restaurant =
                await Restaurant.findOne({
                    owner:
                        req.user.id
                });


            if (!restaurant) {

                return res
                    .status(403)
                    .send(
                        "Restaurant not linked to this admin"
                    );

            }


            const order =
                await Order.findOne({

                    _id:
                        req.params.orderId,

                    restaurant:
                        restaurant._id

                });


            if (!order) {

                return res
                    .status(404)
                    .send(
                        "Order not found"
                    );

            }


            if (
                !allowedTransitions[
                    order.status
                ].includes(status)
            ) {

                return res
                    .status(400)
                    .send(
                        `Cannot change order from ${order.status} to ${status}`
                    );

            }


            order.status =
                status;


            await order.save();


            res.redirect(
                "/restaurant-orders"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error updating order status"
            );

        }

    }
);


// ==================================================
// FOOD EDIT
// ==================================================

app.get(
    "/foods/:id/edit",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const food =
                await Food.findById(
                    req.params.id
                );


            const restaurants =
                await Restaurant.find();


            if (!food) {

                return res
                    .status(404)
                    .send(
                        "Food not found"
                    );

            }


            res.render(
                "editfood",
                {
                    food,
                    restaurants
                }
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error loading food"
            );

        }

    }
);


// ==================================================
// FOOD EDIT - POST
// ==================================================

app.post(
    "/foods/:id/edit",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const {
                name,
                price,
                category,
                restaurant
            } = req.body;


            await Food.findByIdAndUpdate(

                req.params.id,

                {
                    name,
                    price,
                    category,
                    restaurant
                }

            );


            res.redirect(
                "/foods"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error updating food"
            );

        }

    }
);


// ==================================================
// FOOD DELETE
// ==================================================

app.post(
    "/foods/:id/delete",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const food =
                await Food.findByIdAndDelete(
                    req.params.id
                );


            if (!food) {

                return res
                    .status(404)
                    .send(
                        "Food not found"
                    );

            }


            res.redirect(
                "/foods"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error deleting food"
            );

        }

    }
);


// ==================================================
// RESTAURANT EDIT
// ==================================================

app.post(
    "/restaurants/:id/edit",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const restaurant =
                await Restaurant.findById(
                    req.params.id
                );


            if (!restaurant) {

                return res
                    .status(404)
                    .send(
                        "Restaurant not found"
                    );

            }


            restaurant.name =
                req.body.name;


            restaurant.city =
                req.body.city;


            await restaurant.save();


            res.redirect(
                "/restaurants"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error updating restaurant"
            );

        }

    }
);


// ==================================================
// RESTAURANT DELETE
// ==================================================

app.post(
    "/restaurants/:id/delete",
    verifyToken,
    isAdmin,
    async (req, res) => {

        try {

            const restaurant =
                await Restaurant.findByIdAndDelete(
                    req.params.id
                );


            if (!restaurant) {

                return res
                    .status(404)
                    .send(
                        "Restaurant not found"
                    );

            }


            res.redirect(
                "/restaurants"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error deleting restaurant"
            );

        }

    }
);


// ==================================================
// PROFILE
// ==================================================

app.get(
    "/profile",
    verifyToken,
    async (req, res) => {

        try {

            const user =
                await User.findById(
                    req.user.id
                );


            if (!user) {

                return res
                    .status(404)
                    .send(
                        "User not found"
                    );

            }


            res.render(
                "profile",
                {
                    user
                }
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error loading profile"
            );

        }

    }
);


// ==================================================
// UPDATE PROFILE
// ==================================================

app.post(
    "/profile",
    verifyToken,
    async (req, res) => {

        try {

            await User.findByIdAndUpdate(

                req.user.id,

                {
                    name:
                        req.body.name,

                    email:
                        req.body.email,

                    address:
                        req.body.address

                }

            );


            res.redirect(
                "/profile"
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error updating profile"
            );

        }

    }
);


// ==================================================
// LOGOUT
// ==================================================

app.get(
    "/logout",
    (req, res) => {

        res.clearCookie(
            "token"
        );


        res.redirect(
            "/login"
        );

    }
);


// ==================================================
// MY ORDERS
// ==================================================

app.get(
    "/my-orders",
    verifyToken,
    async (req, res) => {

        try {

            const orders =
                await Order.find({
                    user:
                        req.user.id
                })
                .populate("food")
                .populate("restaurant")
                .sort({
                    createdAt: -1
                });


            res.render(
                "myorders",
                {
                    orders
                }
            );

        } catch (err) {

            console.log(err);

            res.status(500).send(
                "Error fetching orders"
            );

        }

    }
);


// ==================================================
// CHAT PAGE
// ==================================================

app.get(
    "/orders/:orderId/chat",
    verifyToken,
    async (req, res) => {

        try {

            const order =
                await Order.findById(
                    req.params.orderId
                );


            if (!order) {

                return res
                    .status(404)
                    .send(
                        "Order not found"
                    );

            }


            const user =
                await User.findById(
                    req.user.id
                );


            let isAllowed =
                false;


            const isCustomer =
                order.user.toString() ===
                req.user.id.toString();


            if (isCustomer) {

                isAllowed =
                    true;

            }


            if (user) {

                const restaurant =
                    await Restaurant.findOne({
                        owner:
                            req.user.id
                    });


                if (
                    restaurant &&
                    order.restaurant.toString() ===
                    restaurant._id.toString()
                ) {

                    isAllowed =
                        true;

                }

            }


            if (!isAllowed) {

                return res
                    .status(403)
                    .send(
                        "You cannot access this chat"
                    );

            }


            res.render(
                "chat",
                {
                    order,

                    token:
                        req.cookies.token

                }
            );

        } catch (error) {

            console.log(error);

            res.status(500).send(
                "Unable to open chat"
            );

        }

    }
);


// ==================================================
// CHAT MESSAGES
// ==================================================

app.get(
    "/orders/:orderId/messages",
    verifyToken,
    async (req, res) => {

        try {

            const order =
                await Order.findById(
                    req.params.orderId
                )
                .populate("food");


            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found"

                });

            }


            const user =
                await User.findById(
                    req.user.id
                );


            const isCustomer =
                order.user.toString() ===
                req.user.id.toString();


            const restaurant =
                user
                    ? await Restaurant.findOne({
                        owner:
                            req.user.id
                    })
                    : null;


            const isRestaurant =
                restaurant &&
                order.restaurant.toString() ===
                restaurant._id.toString();


            if (
                !isCustomer &&
                !isRestaurant
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You cannot access this chat"

                });

            }


            const messages =
                await Message.find({

                    order:
                        req.params.orderId

                })
                .populate(
                    "sender",
                    "name"
                )
                .sort({
                    createdAt: 1
                });


            res.status(200).json({

                success: true,

                messages

            });

        } catch (error) {

            console.log(error);

            res.status(500).json({

                success: false,

                message:
                    "Could not fetch messages"

            });

        }

    }
);


// ==================================================
// RAZORPAY PAYMENT INITIALIZATION
// ==================================================

app.post(
    "/orders/:orderId/payment",
    verifyToken,
    async (req, res) => {

        try {

            const order =
                await Order.findById(
                    req.params.orderId
                );


            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found"

                });

            }


            if (
                order.user.toString() !==
                req.user.id.toString()
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You cannot pay for this order"

                });

            }


            if (
                order.paymentStatus ===
                "paid"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order is already paid"

                });

            }


            if (
                order.status ===
                "cancelled"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Cannot pay for a cancelled order"

                });

            }


            const paymentOrder =
                await razorpay.orders.create({

                    amount:
                        order.total * 100,

                    currency:
                        "INR",

                    receipt:
                        order._id.toString()

                });


            order.razorpayOrderId =
                paymentOrder.id;


            await order.save();


            res.status(200).json({

                success: true,

                paymentOrder

            });

        } catch (error) {

            console.log(error);

            res.status(500).json({

                success: false,

                message:
                    "Payment initialization failed"

            });

        }

    }
);


// ==================================================
// START SERVER
// ==================================================

const PORT =
    process.env.PORT || 3000;


server.listen(
    PORT,
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);