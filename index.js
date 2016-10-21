'use strict';
const $methods = require('./commons/methods');
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
            re: pathToRegexp(cleanPath(s_path))
        });
    }

    // override Express Router Methods
    const allMethods = $methods.concat('all');
    for (let m= 0, len=allMethods.length; m<len; m++) {
        let method = allMethods[m];

        app[method] = function(path) {
            let route = this.route(path),
                validations = validateSwaggerMethod(path, method, route);

            let middlewares = [
                corsMw(path, validations[0].swMethod),
                routerValidation(validations),
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
                let validations = validateSwaggerMethod(path, method, this);
                let middlewares = [
                    corsMw(path, validations[0].swMethod),
                    routerValidation(validations),
                    ...Array.prototype.slice.call(arguments)
                ];

                return this[origMethod](middlewares);
            };
        }
        return route;
    };

    return app();

    function resolveParameters(obj, msg) {
        for (let i=0, len=obj.parameters.length; i<len; i++) {
            let param = obj.parameters[i];
            if (!param.$ref) continue;
            let match = /#\/(\w*)\/(\w*)/.exec(param.$ref);
            if (!match || match.length < 3) {
                throw new Error(`[${msg}] Invalid parameter $ref: "${param.$ref}"`);
            }
            obj.parameters[i] = swagger[match[1]][match[2]];
        }
    }

    function routerValidation(validations) {
        for (let h= 0, total=validations.length; h<total; h++) {
            let valid = validations[h];
            valid.validatorMw = validatorMw(valid.swMethod, swagger);
        }
        if (validations.length === 1) {
            return validations[0].validatorMw;
        }

        let validationsRules = swagger['x-swagger-erouter-validation-rules'] || {},
            pathsRules = Object.keys(validationsRules),
            path = cleanPath(validations[0].path);
        //console.log('$###>>>', validations[0].path, '---', path, pathsRules);
        for (let i= 0, len=pathsRules.length; i<len; i++) {
            let pathRule = pathsRules[i],
                re = pathToRegexp(pathRule.replace(/\{(\w+)\}/g, ':$1'));

            //console.log(path, '==>>', pathRule, re.test(path), validations[0].path);
            if (re.test(path)) {
                let validRules = validationsRules[pathRule],
                    $in = validRules.in,
                    $name = validRules.name,
                    $rules = validRules.rules;

                const getObjValue = (obj, prop) => {
                    if (!obj || !prop) return null;

                    let ss = prop.split('.');
                    if (ss.length === 1) {
                        return obj[prop];
                    }
                    return ss.reduce((a, b) => {
                        if ('string' === typeof a) {
                            a = obj[a]
                        }
                        return a && a[b];
                    });
                };
                return (req, res, next) => {
                    let value = ($in === 'header') ? req.get($name) :
                        (~['param', 'path'].indexOf($in)) ? req.params[$name]:
                        getObjValue(req[$in], $name);

                    let refPath = $rules[value] || $rules._default,
                        refRe = pathToRegexp(refPath.replace(/\{(\w+)\}/g, ':$1'));
                    for (let h= 0, total=validations.length; h<total; h++) {
                        let valid = validations[h];
                        //console.log(':::>>>>', value, '>>', valid.path, '-->', refPath, refRe.test(valid.path.replace(/\/?\?/, '/?')));
                        if (refRe.test(valid.path.replace(/\/?\?/, '/?'))) {
                            return valid.validatorMw(req, res, next);
                        }
                    }

                    return next(new Error(`"Swagger Router Validation Rules" not found of "${path}"`));
                };
            }
        }
        return (req, res, next) => next(new Error('"Swagger Router Validation Rules" not found'));
    }

    function validateSwaggerMethod(path, method, route) {
        const results = [];
        for (let i=0, total=apiCaches.length; i<total; i++) {
            let apiCache = apiCaches[i],
                {re, swMethods} = apiCache,
                l_method = method.toLowerCase(),
                l_path = cleanPath(path);

            if (re.test(l_path) && swMethods[l_method]) {
                let swMethod = swMethods[l_method];
                if (!swMethod.parameters) {
                    swMethod.parameters = [];
                }

                if (swMethods.parameters) {
                    swMethod.parameters.push(...swMethods.parameters);
                }
                setDefaultCors({route, path}, apiCaches[i]);
                results.push({path: apiCache.path, swMethod});
            }
        }

        if (!results.length) {
            throw new Error(`[Method: "${method.toUpperCase()}"] API not defined in Swagger: "${path}"`);
        }

        for (let i= 0, len=results.length; i<len; i++) {
            let result = results[i];
            // resolve parameters
            resolveParameters(result.swMethod, `Method: "${method.toUpperCase()}"`);
        }

        return results;
    }

    function cleanPath(path) {
        return path.replace(/\?\w*/, '').replace(/\/?$/, '/');
    }

    function setDefaultCors({route, path}, apiCache) {
        if (!apiCache || apiCache.defineCors) return;

        const swMethods = apiCache.swMethods;
        apiCache.defineCors = true;

        route.options.apply(route, [corsMw(path, swMethods)]);
        let allowedList = Object.keys(swMethods),
            defineMethods = allowedList.concat(['all', 'options']);

        for (let m= 0, len=allMethods.length; m<len; m++) {
            let method = allMethods[m],
                origMethod = `__${method}`,
                l_method = method.toLowerCase();
            if (~defineMethods.indexOf(l_method)) continue;

            if (route[origMethod]) {
                route[method] = route[origMethod];
                delete route[origMethod];
            }

            route[method].apply(route, [
                corsMw(path, swMethods),
                (req, res) => {
                    res.status(405).send(`${req.path} does not allow ${req.method}.\nAllowed methods: ${allowedList.join().toUpperCase()}`);
                }
            ]);
        }
    }
};