'use strict';

var swParameters = require('swagger-parameters');

module.exports = ({parameters = []}) => {
    const swParams = swParameters(parameters.filter(param => param.in && param.in !== 'body'));

    return (req, res, next) => {
        let obj = {
            path: req.params,
            query: req.query,
            headers: req.headers
        };
        swParams(obj, (err, data) => {
            if (err) {
                err.status = 400;
                next(err);
            } else {
                req.$query = data.query;
                req.$params = data.path;
                req.$headers = data.headers;
                return next();
            }
        });
    };
};
