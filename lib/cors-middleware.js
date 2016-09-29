'use strict';
const cors = require('cors');

const cache = {};
module.exports = (path, swMethods = {}) => {
    if (!cache[path]) {
        cache[path] = Object.keys(swMethods).join(',').toUpperCase();
    }
    let methods = cache[path];

    return cors({methods});
};
