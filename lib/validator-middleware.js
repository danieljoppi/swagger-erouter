'use strict';
const Ajv = require('ajv');
const extend = require('xtend');
const SwaggerParameters = require('swagger-parameters');


function Body (parameters = [], definitions = {}) {
    const ajv = new Ajv({
        allErrors: true,
        coerceTypes: true,
        jsonPointers: true,
        useDefaults: true
    });
    const parameter = (parameters || []).find((p) => p.in === 'body');
    if (!parameter) return () => Promise.resolve();

    const validate = ajv.compile(extend(parameter.schema, {definitions}));

    return (req) => new Promise((resolve, reject) => {
        if (validate(req.body)) {
            return resolve();
        } else {
            let errors = validate.errors || [];
            for (let i = 0, len = errors.length; i < len; i++) {
                let error = errors[i],
                    params = error.params;
                if (params.missingProperty) {
                    error.dataPath = `/body/${params.missingProperty}`;
                    delete error.params.missingProperty;
                } else if (error.schemaPath) {
                    let m = /\/properties\/(\w*)/.exec(error.schemaPath);
                    if (m) {
                        error.dataPath = `/body/${m[1]}`;
                    }
                } else {
                    error.dataPath = '/body/x'
                }
            }
            return reject(new Ajv.ValidationError(errors));
        }
    });
}

function Parameters (parameters = []) {
    const parse = SwaggerParameters(parameters);

    return (req) => new Promise((resolve, reject) => {
        let obj = {
            path: req.params,
            query: req.query,
            headers: req.headers
        };
        parse(obj, (err, data) => {
            if (err) {
                reject(err);
            } else {
                req.$query = data.query;
                req.$params = data.path;
                req.$headers = data.headers;
                return resolve();
            }
        });
    });
}

module.exports = ({parameters = []}, {definitions = {}}) => {
    const params = [];
    let cache = {};
    for (let i = 0, len = parameters.length; i < len; i++) {
        let param = parameters[i],
            key = `${param.in}_${param.name}`;
        if (!cache[key]) {
            cache[key] = true;
            params.push(param);
        }
    }

    const validateBody = Body(params, definitions);
    const validateParams = Parameters(params);

    return (req, res, next) => {
        Promise.all([
            validateParams(req),
            validateBody(req)
        ]).then(() => {
            return next();
        }).catch(err => {
            err.status = 400;
            return next(err);
        });
    };
};
