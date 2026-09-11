const jwt = require("jsonwebtoken");

function auth(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.send("Please Login");
    }
    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );
        req.user = decoded;
        next();

    } catch (error) {

        res.send("Invalid Token");

    }

}

module.exports = auth;