'use strict';
const cors = require('cors');

const $methods = require('../commons/methods');
const cache = {};
module.exports = (path, swMethods = {}) => {
    if (!cache[path]) {
        let methods = Object.keys(swMethods).filter(method => {
            return ~$methods.indexOf(method);
        });
        cache[path] = methods.join(',').toUpperCase();
    }
    let methods = cache[path];

    return cors({methods});
};
