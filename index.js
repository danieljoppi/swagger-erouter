'use strict';
//const $methods = require('methods');
const $methods = [
    'get',
    'post',
    'put',
    'head',
    'delete',
    'patch'
];
const express = require('express');
const pathToRegexp = require('path-to-regexp');

const corsMw = require('./lib/cors-middleware');
const validatorMw = require('./lib/validator-middleware');
/**
 * Proxy for `express().router()`.
 *
 * @param swagger {{paths: {}}}
 * @returns {*}
 */
module.exports = (swagger = {}) => {
    const app = express.Router;

    const paths = Object.keys(swagger.paths || {});
    const apiCaches = [];

    for (let i= 0, total=paths.length; i<total; i++) {
        let path = paths[i],
            s_path = path.replace(/\{(\w+)\}/g, ':$1'),
            s_methods = swagger.paths[path];

        let swMethods = {};
        Object.keys(s_methods).forEach(method => {
            swMethods[method.toLowerCase()] = s_methods[method];
        });
        apiCaches.push({
            path: s_path,
            swMethods,
            re: pathToRegexp(s_path)
        });
    }

    // override Express Router Methods
    const allMethods = $methods.concat('all');
    for (let m= 0, len=allMethods.length; m<len; m++) {
        let method = allMethods[m];

        app[method] = function(path) {
            let route = this.route(path),
                swMethod = validateSwaggerMethod(path, method, route);
            let middlewares = [
                    corsMw(path, swMethod),
                    validatorMw(swMethod),
                    ...Array.prototype.slice.call(arguments, 1)
                ];
            route[method].apply(route, middlewares);
            return this;
        };
    }

    app.__route = app.route;
    app.route = function(path) {
        let route = this.__route(path);
        for (let m = 0, len = allMethods.length; m < len; m++) {
            let method = allMethods[m],
                origMethod = `__${method}`;
            route[origMethod] = route[method];
            route[method] = function () {
                let swMethod = validateSwaggerMethod(path, method, this);
                let middlewares = [
                    corsMw(path, swMethod),
                    validatorMw(swMethod),
                    ...Array.prototype.slice.call(arguments)
                ];

                return this[origMethod](middlewares);
            };
        }
        return route;
    };

    return app();

    function validateSwaggerMethod(path, method, route) {
        let swMethod = false;
        for (let i=0, total=apiCaches.length; i<total; i++) {
            let {re, swMethods} = apiCaches[i],
                l_method = method.toLowerCase();

            if (re.exec(path) && swMethods[l_method]) {
                swMethod = swMethods[l_method];
                setDefaultCors({route, path, swMethod}, apiCaches[i]);
                break;
            }
        }

        if (!swMethod) {
            throw new Error(`[Method: "${method.toUpperCase()}"] API not defined in Swagger: "${path}"`);
        }
        return swMethod;
    }

    function setDefaultCors({route, path, swMethod}, apiCache) {
        if (!apiCache || apiCache.defineCors) return;

        apiCache.defineCors = true;

        route.options.apply(route, [corsMw(path, swMethod)]);
        let allowedList = Object.keys(swMethod).join(', '),
            defineMethods = Object.keys(apiCache.swMethods);

        for (let m= 0, len=allMethods.length; m<len; m++) {
            let method = allMethods[m],
                origMethod = `__${method}`,
                l_method = method.toLowerCase();
            if (~defineMethods.indexOf(l_method) || 'options' === l_method) continue;

            if (route[origMethod]) {
                route[method] = route[origMethod];
                delete route[origMethod];
            }

            route[method].apply(route, [
                corsMw(path, swMethod),
                (req, res) => {
                    res.status(405).send(`${req.path} does not allow ${req.method}.\nAllowed methods: ${allowedList}`);
                }
            ]);
        }
    }
};